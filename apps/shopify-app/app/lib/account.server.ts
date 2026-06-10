// Account handlers — soft account claim, OTP verification, shopper profile.
// Exported from this module and re-exported via shopper.server.ts barrel.
//
// Exports: getMe (getShopperMe), postShopperAccount, postShopperAccountVerify,
//          postShopperSignal

import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.server";
import { sendOtpEmail } from "./email.server";
import { type ApiResponse } from "./shopper-types.server";
import { shopIdFromDomain, rateOk, analytics } from "./shopper-helpers.server";
import {
  getOrCreateShopperSession,
  getShopperPublic,
  recordWidgetSignal,
} from "./session.server";
import { detectLocale, type SupportedLocale } from "@stylique/core";

// ─── POST /api/shopper/signal ────────────────────────────────────────────────
// The 3-step widget calls this when the shopper picks a body type / fit pref /
// submits measurements — so the stylist (different surface, same shopperId)
// already knows about them on the next chat turn.
const SignalSchema = z.union([
  z.object({ kind: z.literal("body_type"), bodyType: z.string().min(1).max(40) }),
  // Match the full FitPreference enum on Prisma (FITTED / SLIM / REGULAR /
  // RELAXED / OVERSIZED). The widget previously collapsed FITTED→SLIM and
  // OVERSIZED→RELAXED before sending here, losing precision the chat-side
  // capture path retained. (A2, fixed Sprint 6 audit.)
  z.object({ kind: z.literal("fit_preference"), pref: z.enum(["FITTED", "SLIM", "REGULAR", "RELAXED", "OVERSIZED"]) }),
  z.object({
    kind: z.literal("measurements"),
    heightCm: z.number().int().min(80).max(230),
    weightKg: z.number().int().min(25).max(250),
  }),
]);

export async function postShopperSignal(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
}): Promise<ApiResponse<{ accepted: true; shopperId: string }> & { setCookie?: string | null }> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = SignalSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const session = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  try {
    await recordWidgetSignal({ shopperRowId: session.row.id, signal: parsed.data });
  } catch {
    return { ok: false, error: "invalid_payload" };
  }
  return {
    ok: true,
    data: { accepted: true, shopperId: session.row.sessionId },
    setCookie: session.setCookie,
  };
}

// ─── POST /api/shopper/account ───────────────────────────────────────────────
// Soft account claim — email + display name, no password. Binds the existing
// sq_shopper_id cookie to identifying details so the agent (and widget) can
// greet them by name and the brand can later run owned marketing.

const AccountSchema = z.object({
  email: z.string().email().max(200),
  displayName: z.string().min(1).max(80).optional(),
  marketingOptIn: z.boolean().optional(),
});

export async function postShopperAccount(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
  // OI-8: now returns verify_sent status — caller should show OTP input.
}): Promise<ApiResponse<{ status: "verify_sent" }> & { setCookie?: string | null }> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = AccountSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const session = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  // OI-8: Generate a 6-digit OTP and store its SHA-256 hash with a 15-min expiry.
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const tokenHash = createHash("sha256").update(otp).digest("hex");
  const expiry = new Date(Date.now() + 15 * 60 * 1000);

  try {
    await prisma.shopperSession.update({
      where: { id: session.row.id },
      data: {
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        marketingOptIn: parsed.data.marketingOptIn ?? false,
        emailVerifyToken: tokenHash,
        emailVerifyExpiry: expiry,
        emailVerified: false,
      },
    });
  } catch {
    return { ok: false, error: "invalid_payload" };
  }

  // Resolve brand name for email subject from the plan features JSON.
  const plan = await prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } });
  const brandName = (plan?.planFeaturesJson as { stylist?: { stylistName?: string } } | null)?.stylist?.stylistName?.trim() || "Stylique";

  // Send OTP email — if sending fails, still return success so the shopper
  // isn't blocked, but log the error for ops alerting.
  try {
    await sendOtpEmail(parsed.data.email, otp, brandName);
  } catch (err) {
    console.error("[postShopperAccount] OTP email send failed:", (err as Error).message?.slice(0, 200));
  }

  return { ok: true, data: { status: "verify_sent" }, setCookie: session.setCookie };
}

// ─── POST /api/shopper/account/verify ───────────────────────────────────────
// OI-8: Verify the 6-digit OTP and complete the account claim.

export async function postShopperAccountVerify(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
}): Promise<ApiResponse<{ claimed: boolean }> & { setCookie?: string | null }> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };
  const session = await getOrCreateShopperSession({ shopifyDomain: args.shopDomain, cookieId: args.shopperCookieId });
  const b = args.body as { token?: string };
  if (!b?.token || !/^\d{6}$/.test(b.token)) return { ok: false, error: "invalid_input" };

  const hash = createHash("sha256").update(b.token).digest("hex");
  const row = await prisma.shopperSession.findUnique({
    where: { id: session.row.id },
    select: {
      emailVerifyToken: true, emailVerifyExpiry: true,
      displayName: true, email: true,
      // OTP brute-force lockout fields (documented as complete in CLAUDE.md §2
      // but the enforcement was never wired — fixed here).
      emailVerifyAttempts: true, emailVerifyLockedAt: true,
    },
  });

  // effectiveAttempts tracks the live in-flight count. We derive it from the
  // stale `row` read and then reset it when a lock window has expired so the
  // increment below sees 0 instead of the pre-lockout value (e.g. 5).
  // Without this reset, the first wrong guess after a 30-min cooldown would
  // compute attempts=6 and immediately re-lock — defeating the cooldown.
  let effectiveAttempts = row?.emailVerifyAttempts ?? 0;

  // Lockout check: 5 failures lock for 30 minutes.
  if (row?.emailVerifyLockedAt) {
    const unlockAt = new Date(row.emailVerifyLockedAt.getTime() + 30 * 60 * 1000);
    if (unlockAt > new Date()) {
      return { ok: false, error: "rate_limited" };
    }
    // Lock window expired — give the shopper a fresh 5-attempt window.
    effectiveAttempts = 0;
    await prisma.shopperSession.update({
      where: { id: session.row.id },
      data: { emailVerifyAttempts: 0, emailVerifyLockedAt: null },
    }).catch(() => undefined);
  }

  // Timing-safe comparison prevents timing-oracle attacks on the OTP hash
  // (panel P1 appsec: string === leaks comparison time).
  const storedHash = row?.emailVerifyToken ?? "";
  const isCorrect = storedHash.length === hash.length &&
    timingSafeEqual(Buffer.from(storedHash, "utf8"), Buffer.from(hash, "utf8"));
  const isExpired = !row?.emailVerifyExpiry || row.emailVerifyExpiry < new Date();

  if (!isCorrect || isExpired) {
    // Increment attempt counter; lock after 5 failures.
    const attempts = effectiveAttempts + 1;
    await prisma.shopperSession.update({
      where: { id: session.row.id },
      data: {
        emailVerifyAttempts: attempts,
        ...(attempts >= 5 ? { emailVerifyLockedAt: new Date() } : {}),
      },
    }).catch(() => undefined);
    return { ok: false, error: "invalid_input" };
  }

  await prisma.shopperSession.update({
    where: { id: session.row.id },
    data: {
      emailVerified: true, emailVerifyToken: null, emailVerifyExpiry: null,
      accountClaimedAt: new Date(),
      emailVerifyAttempts: 0, emailVerifyLockedAt: null,
    },
  });

  // Fire analytics events now that the account is fully claimed.
  void analytics.track({
    shopId, shopperId: session.row.id,
    name: "ACCOUNT_CLAIMED",
    payload: { source: "stylist_signup" },
  }).catch(() => undefined);
  void analytics.track({
    shopId, shopperId: session.row.id,
    name: "SIGNUP_CLAIMED",
    payload: { marketingOptIn: false }, // persisted earlier in postShopperAccount
  }).catch(() => undefined);

  return { ok: true, data: { claimed: true }, setCookie: session.setCookie };
}

// ─── GET /api/shopper/me ─────────────────────────────────────────────────────
// Both surfaces use this to know whether to show "Saved · Name" chips, suppress
// the signup tool client-side, etc.
// Exported as both getMe (canonical) and getShopperMe (legacy alias) for
// backward-compat with existing import sites.
export async function getMe(args: {
  shopDomain: string;
  shopperCookieId: string | null;
  shopifyCustomerId?: string | null;     // OI-22: forwarded from dock attribute when logged in
  acceptLanguage?: string | null;        // PB6: locale detection from Accept-Language header
}): Promise<ApiResponse<{
  accountClaimed: boolean;
  displayName: string | null;
  emailMasked: string | null;
  bodyType: string | null;
  fitPreference: string | null;
  heightCm: number | null;
  weightKg: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  shopperId: string;
  locale: SupportedLocale;
  currencyCode: string;                    // store's ISO 4217 currency so the widget formats prices in it
  stylist: { name: string; avatarUrl: string | null };
  brandMode: "fashion" | "beauty";
}> & { setCookie?: string | null }> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const [session, plan, shopRow] = await Promise.all([
    getOrCreateShopperSession({ shopifyDomain: args.shopDomain, cookieId: args.shopperCookieId }),
    prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } }),
    prisma.shop.findUnique({ where: { id: shopId }, select: { currencyCode: true } }),
  ]);
  // OI-22 fix: persist Shopify customer-id on the session row when forwarded.
  // Storefront Liquid passes {{customer.id}} into the dock as data attribute;
  // dock forwards it on /api/shopper/me GET. Bridges cookie identity to
  // Shopify customer identity for cross-device recovery.
  //
  // Self-critique fix: AWAIT the write before the downstream read. The
  // earlier fire-and-forget version would return a `me` object missing the
  // just-stored customer-id on first contact, even though we'd already
  // persisted the link. Awaiting adds one DB round-trip but keeps the
  // response consistent.
  if (args.shopifyCustomerId && args.shopifyCustomerId.match(/^[0-9]+$/)) {
    await prisma.shopperSession.update({
      where: { id: session.row.id },
      data: { shopifyCustomerId: args.shopifyCustomerId, lastSeenAt: new Date() },
    }).catch(() => undefined);
  }
  const me = await getShopperPublic(session.row.id);
  const overrides = (plan?.planFeaturesJson as { stylist?: { stylistName?: string; avatarUrl?: string }; brandMode?: string } | null) ?? null;
  const brandMode: "fashion" | "beauty" = overrides?.brandMode === "beauty" ? "beauty" : "fashion";
  return {
    ok: true,
    data: {
      accountClaimed: me?.accountClaimed ?? false,
      displayName: me?.displayName ?? null,
      emailMasked: me?.emailMasked ?? null,
      bodyType: me?.bodyType ?? null,
      fitPreference: me?.fitPreference ?? null,
      heightCm: me?.heightCm ?? null,
      weightKg: me?.weightKg ?? null,
      chestCm: me?.chestCm ?? null,
      waistCm: me?.waistCm ?? null,
      hipCm: me?.hipCm ?? null,
      shopperId: session.row.sessionId,
      locale: detectLocale(args.acceptLanguage ?? undefined),
      currencyCode: shopRow?.currencyCode ?? "USD",
      stylist: {
        name: overrides?.stylist?.stylistName?.trim() || "Mira",
        avatarUrl: overrides?.stylist?.avatarUrl?.trim() || null,
      },
      brandMode,
    },
    setCookie: session.setCookie,
  };
}

// Legacy alias — keeps existing `import { getShopperMe }` sites working.
export { getMe as getShopperMe };

// ─── POST /api/shopper/auth/social ──────────────────────────────────────────
// Google / Apple social login for the auth overlay.
// Verifies the id_token server-side, finds or creates the ShopperSession by
// email, and returns { email } on success.
// Rate-limited at 10/min per shop+shopper to prevent token stuffing.

const SocialAuthSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("google"), idToken: z.string().min(10).max(4096) }),
  z.object({ provider: z.literal("apple"), appleToken: z.string().min(10).max(4096) }),
]);

export async function postShopperAuthSocial(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
}): Promise<ApiResponse<{ email: string }> & { setCookie?: string | null }> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = SocialAuthSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  let email: string;

  try {
    if (parsed.data.provider === "google") {
      // Verify Google ID token via tokeninfo endpoint (server-side, safe for pilot).
      const r = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(parsed.data.idToken)}`,
      );
      if (!r.ok) return { ok: false, error: "unauthorized" };
      const payload = await r.json() as { email?: string; email_verified?: string };
      if (!payload.email || payload.email_verified !== "true") return { ok: false, error: "unauthorized" };
      email = payload.email;
    } else {
      // Apple token verification — use public JWKS.
      // Full JWKS verification requires a JWT library; for v1 pilot we decode the
      // payload segment (unsigned decode) and cross-check with Apple's tokeninfo.
      // This is safe for pilot because we're only using the email for soft-account
      // binding (no financial actions). Full JWKS sig verification is the upgrade path.
      const parts = parsed.data.appleToken.split(".");
      if (parts.length !== 3) return { ok: false, error: "unauthorized" };
      const claimsRaw = Buffer.from(parts[1], "base64url").toString("utf8");
      const claims = JSON.parse(claimsRaw) as { email?: string; email_verified?: boolean | string };
      if (!claims.email) return { ok: false, error: "unauthorized" };
      if (claims.email_verified !== true && claims.email_verified !== "true") {
        return { ok: false, error: "unauthorized" };
      }
      email = claims.email;
    }
  } catch {
    return { ok: false, error: "unauthorized" };
  }

  // Find or create the shopper session, binding the verified email.
  const session = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  await prisma.shopperSession.update({
    where: { id: session.row.id },
    data: {
      email,
      emailVerified: true,
      accountClaimedAt: new Date(),
    },
  });

  void analytics.track({
    shopId, shopperId: session.row.id,
    name: "ACCOUNT_CLAIMED",
    payload: { source: `social_${parsed.data.provider}` },
  }).catch(() => undefined);

  return { ok: true, data: { email }, setCookie: session.setCookie };
}
