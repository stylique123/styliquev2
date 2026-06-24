// Shopper-session bridge.
//
// One `ShopperSession` row per shopper-per-store, identified by a cookie value
// (`sq_shopper_id`) the widget/dock send up. Every widget signal (body type,
// fit result, mood pick) and every chat exchange writes to it. The agent reads
// it back as a short brief so it sounds like it already knows the shopper.
//
// Chat turn history is kept in a process-local LRU for v1 — small, fast, and
// good enough until we add a ChatTurn table (1-line migration, do later).

import { prisma } from "../db.server";
import { Prisma } from "@stylique/db";
import type { ChatMessage } from "@stylique/ai";

// ─── Cookie helpers ─────────────────────────────────────────────────────
const COOKIE_NAME = "sq_shopper_id";
// 180 days — GDPR Art. 5(1)(e) data minimisation: anonymous sessions purged
// after 24 months via retention-cleanup worker. Cookie lifetime shorter than
// retention to balance UX continuity with data minimisation.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export function readShopperCookie(request: Request): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === COOKIE_NAME && v && /^[a-z0-9_-]{8,64}$/i.test(v)) return v;
  }
  return null;
}

export function buildShopperSetCookie(value: string): string {
  // Security:
  //   HttpOnly  — JS can't read it; XSS can't steal it. The client never needs
  //               to read the value (it rides on `credentials: "include"`).
  //   Secure    — HTTPS only. Localhost dev is treated as secure context.
  //   SameSite=None — required because Shopify App Proxy is a cross-site iframe
  //               flow. The cookie must be sent on cross-site POSTs. Without
  //               None+Secure, Chrome silently drops the cookie.
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=None; Secure; HttpOnly`;
}

function randomId(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
}

// ─── ShopperSession row resolution ──────────────────────────────────────
export async function getOrCreateShopperSession(args: {
  shopifyDomain: string;
  cookieId: string | null;
}): Promise<{ row: { id: string; sessionId: string }; setCookie: string | null }> {
  if (args.cookieId) {
    const existing = await prisma.shopperSession.findUnique({
      where: { sessionId: args.cookieId },
      select: { id: true, sessionId: true, shopifyDomain: true },
    });
    // Cross-store cookie reuse is fine — same person, different store visit. We
    // create a fresh row scoped to the new store.
    if (existing && existing.shopifyDomain === args.shopifyDomain) {
      // Touch lastSeenAt fire-and-forget.
      void prisma.shopperSession.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      }).catch(() => undefined);
      return { row: existing, setCookie: null };
    }
  }
  // `sessionId` is globally unique in the schema. If a valid cookie belongs to
  // another shop, reusing it here would violate that constraint and make the
  // first request on the second merchant fail. Mint a shop-local identity and
  // replace the cookie instead.
  const sessionId = randomId();
  const created = await prisma.shopperSession.create({
    data: { sessionId, shopifyDomain: args.shopifyDomain },
    select: { id: true, sessionId: true },
  });
  return { row: created, setCookie: buildShopperSetCookie(sessionId) };
}

// ─── Shopper brief (the "what we know about you" block) ─────────────────
export async function buildShopperBrief(shopperRowId: string): Promise<{
  brief: string | null;
  accountClaimed: boolean;
  signupOffered: boolean;
  signalCount: number;          // E5 fix — was always 0 upstream
}> {
  // Lazy import to avoid a circular dep when this module is loaded before
  // taste.server is initialised.
  const { describeTasteForPrompt } = await import("./taste.server");

  const s = await prisma.shopperSession.findUnique({
    where: { id: shopperRowId },
    select: {
      bodyType: true, heightCm: true, weightKg: true, fitPreference: true,
      email: true, displayName: true, accountClaimedAt: true, signupOfferedAt: true,
      tasteVectorJson: true, signalCount: true,
      budgetMin: true, budgetMax: true, budgetCurrency: true,
      fits: { take: 3, orderBy: { createdAt: "desc" }, select: { recommendedSize: true, product: { select: { title: true, category: true } } } },
      styles: { take: 2, orderBy: { createdAt: "desc" }, select: { product: { select: { title: true } } } },
    },
  });
  if (!s) return { brief: null, accountClaimed: false, signupOffered: false, signalCount: 0 };

  const lines: string[] = [];
  if (s.displayName) lines.push(`- Their name is ${s.displayName}. Use it sparingly — once or twice, not every reply.`);
  if (s.bodyType) lines.push(`- Body type they identify with: ${s.bodyType.toLowerCase()}`);
  if (s.fitPreference) lines.push(`- Fit preference: ${s.fitPreference.toLowerCase()}`);
  if (s.heightCm && s.weightKg) lines.push(`- Build: ${s.heightCm}cm / ${s.weightKg}kg (use only for size suggestions, never mention numbers)`);

  // Budget — the most important purchase constraint. When set, every
  // search_catalog call MUST pass maxPriceUsd so results stay in range.
  // Format is human-readable so Mira can reference it conversationally.
  if (s.budgetMax) {
    const cur = s.budgetCurrency ?? "USD";
    const budgetLine = s.budgetMin
      ? `- Budget: ${cur} ${s.budgetMin}–${s.budgetMax}. ALWAYS pass maxPriceUsd=${s.budgetMax} on search_catalog. Never recommend above ${cur} ${s.budgetMax}.`
      : `- Budget ceiling: ${cur} ${s.budgetMax}. ALWAYS pass maxPriceUsd=${s.budgetMax} on every search_catalog call. Never recommend above this.`;
    lines.push(budgetLine);
  } else if (s.budgetMin) {
    lines.push(`- Minimum budget: ${s.budgetCurrency ?? "USD"} ${s.budgetMin}. They're happy to spend at least this.`);
  }
  if (s.fits.length) {
    const f = s.fits[0]!;
    lines.push(`- Their last fit result: size ${f.recommendedSize} on ${f.product.title}`);
  }
  if (s.styles.length) {
    lines.push(`- Recently styled around: ${s.styles.map((x) => x.product.title).join(", ")}`);
  }
  // Layer 2 taste profile — only include once we have a few signals so we
  // don't anchor the agent on noise.
  if (s.tasteVectorJson && (s.signalCount ?? 0) >= 3) {
    const taste = describeTasteForPrompt(s.tasteVectorJson as unknown as Parameters<typeof describeTasteForPrompt>[0]);
    if (taste) {
      lines.push("- Their taste profile (derived from past interactions):");
      lines.push(taste.split("\n").map((l) => "  " + l).join("\n"));
      lines.push("  Use these as soft preferences when picking from search results — don't mention them as facts about the shopper.");
    }
  }
  if (s.accountClaimedAt) {
    lines.push("- They already have a saved Stylique profile — do NOT call offer_account_signup again.");
  } else if (s.signupOfferedAt) {
    lines.push("- You've already offered to save their taste in a prior session and they didn't take it. Don't offer again unless they explicitly ask.");
  }
  return {
    brief: lines.length ? lines.join("\n") : null,
    accountClaimed: !!s.accountClaimedAt,
    signupOffered: !!s.signupOfferedAt,
    signalCount: s.signalCount ?? 0,
  };
}

// Marks the offer as made (called when the agent successfully fires
// offer_account_signup) so the tool gates itself on the next turn.
export async function markSignupOffered(shopperRowId: string): Promise<void> {
  await prisma.shopperSession.update({
    where: { id: shopperRowId },
    data: { signupOfferedAt: new Date() },
  }).catch(() => undefined);
}

// ─── Account claim ──────────────────────────────────────────────────────
export async function claimShopperAccount(args: {
  shopperRowId: string;
  email: string;
  displayName?: string;
  marketingOptIn?: boolean;
}): Promise<void> {
  await prisma.shopperSession.update({
    where: { id: args.shopperRowId },
    data: {
      email: args.email.toLowerCase(),
      displayName: args.displayName?.trim() || null,
      marketingOptIn: !!args.marketingOptIn,
      accountClaimedAt: new Date(),
    },
  });
}

// Read-side for GET /api/shopper/me (widget chip, dock greeting, etc.)
export async function getShopperPublic(shopperRowId: string) {
  const s = await prisma.shopperSession.findUnique({
    where: { id: shopperRowId },
    select: {
      displayName: true, email: true, accountClaimedAt: true,
      bodyType: true, fitPreference: true,
      heightCm: true, weightKg: true,
      chestCm: true, waistCm: true, hipCm: true,
    },
  });
  if (!s) return null;
  return {
    accountClaimed: !!s.accountClaimedAt,
    displayName: s.displayName,
    emailMasked: s.email ? `${s.email[0]}***@${s.email.split("@")[1] ?? ""}` : null,
    bodyType: s.bodyType,
    fitPreference: s.fitPreference,
    heightCm: s.heightCm,                // Mira can collect these in chat;
    weightKg: s.weightKg,                // Widget Fit step pre-fills from them.
    chestCm: s.chestCm,                  // Body measurements — unlock highest
    waistCm: s.waistCm,                  // confidence tier in recommendFit().
    hipCm: s.hipCm,
  };
}

// ─── Persisted chat history (Layer 1.5) ─────────────────────────────────
// Stored as a JSON array on ShopperSession.chatHistoryJson. Capped to the
// last 60 turns on write so the column stays bounded.
const PER_SHOPPER_CAP = 60;

export async function readChatHistory(shopperRowId: string): Promise<ChatMessage[]> {
  const s = await prisma.shopperSession.findUnique({
    where: { id: shopperRowId },
    select: { chatHistoryJson: true },
  });
  const raw = s?.chatHistoryJson;
  if (!Array.isArray(raw)) return [];
  // Defensive shape check — old rows may have a different schema.
  return (raw as unknown[]).filter((m): m is ChatMessage => {
    if (!m || typeof m !== "object") return false;
    const o = m as Record<string, unknown>;
    return (o.role === "user" || o.role === "model") && typeof o.text === "string";
  });
}

export async function appendChatTurns(shopperRowId: string, turns: ChatMessage[]) {
  // Row-locked via SELECT FOR UPDATE inside a transaction — safe for concurrent
  // multi-tab writes.
  await prisma.$transaction(async (tx) => {
    // Acquire a row-level lock so concurrent writers block here until we commit.
    const rows = await tx.$queryRaw<Array<{ chatHistoryJson: unknown }>>`
      SELECT "chatHistoryJson" FROM "ShopperSession" WHERE id = ${shopperRowId} FOR UPDATE
    `;
    const raw = rows[0]?.chatHistoryJson;
    const current: ChatMessage[] = Array.isArray(raw)
      ? (raw as unknown[]).filter((m): m is ChatMessage => {
          if (!m || typeof m !== "object") return false;
          const o = m as Record<string, unknown>;
          return (o.role === "user" || o.role === "model") && typeof o.text === "string";
        })
      : [];
    const next = [...current, ...turns].slice(-PER_SHOPPER_CAP);
    await tx.shopperSession.update({
      where: { id: shopperRowId },
      data: { chatHistoryJson: next as unknown as object },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ─── Canonical Mira objective memory ─────────────────────────────────────
// The browser still sends its sessionStorage copy as a hint, but production
// continuity must be server-owned. Otherwise a tab refresh/storage miss makes
// the brain forget rejected products, budget state, and the current mission.
export async function readMiraObjective(shopperRowId: string): Promise<Record<string, unknown> | null> {
  const rows = await prisma.$queryRaw<Array<{ miraObjectiveJson: unknown }>>`
    SELECT "miraObjectiveJson" FROM "ShopperSession" WHERE id = ${shopperRowId}
  `;
  const raw = rows[0]?.miraObjectiveJson;
  return isJsonObject(raw) ? raw : null;
}

export async function persistMiraObjective(shopperRowId: string, objective: unknown): Promise<void> {
  if (!isJsonObject(objective)) return;
  await prisma.$executeRaw`
    UPDATE "ShopperSession"
    SET "miraObjectiveJson" = CAST(${JSON.stringify(objective)} AS jsonb),
        "miraObjectiveUpdatedAt" = NOW()
    WHERE id = ${shopperRowId}
  `;
}

// ─── Widget signal write-back (called by /api/shopper/signal) ───────────
// Lets the 3-step widget tell the stylist "this shopper just picked body=Curvy
// with model Maya" — so when they open the dock 30 seconds later, the stylist
// already knows.
export async function recordWidgetSignal(args: {
  shopperRowId: string;
  signal:
    | { kind: "body_type"; bodyType: string }
    | { kind: "fit_preference"; pref: "FITTED" | "SLIM" | "REGULAR" | "RELAXED" | "OVERSIZED" }
    | { kind: "measurements"; heightCm: number; weightKg: number };
}): Promise<void> {
  const { shopperRowId, signal } = args;
  if (signal.kind === "body_type") {
    await prisma.shopperSession.update({
      where: { id: shopperRowId },
      data: { bodyType: signal.bodyType, lastSeenAt: new Date() },
    });
  } else if (signal.kind === "fit_preference") {
    await prisma.shopperSession.update({
      where: { id: shopperRowId },
      data: { fitPreference: signal.pref, lastSeenAt: new Date() },
    });
  } else {
    await prisma.shopperSession.update({
      where: { id: shopperRowId },
      data: { heightCm: signal.heightCm, weightKg: signal.weightKg, lastSeenAt: new Date() },
    });
  }
}
