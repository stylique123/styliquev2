// Replenishment notification worker job.
//
// Triggered by:
//   • Nightly repeating job (one per active shop), default 10:00 AM UTC.
//     Morning send time fits "restock before I run out today" behaviour.
//   • Manual trigger via POST /api/admin/replenishment/notify
//
// What it does:
//   1. Finds shoppers with claimed, opted-in email accounts whose beauty/care
//      products are due within `daysAhead` days (default 7).
//   2. Builds a branded HTML + plain-text email per shopper.
//   3. Sends via Resend API → SMTP (nodemailer) → console-log (dev fallback).
//   4. Logs one BEAUTY_REPLENISHMENT_TRIGGERED analytics event per email sent.
//
// Note: the replenishment-notify.server.ts in apps/shopify-app contains the
// same orchestration logic surfaced via the admin route. The worker holds its
// own copy of the DB queries so it stays within the @stylique/db dependency
// boundary — the worker does NOT import Remix/shopify-app modules.
//
// Security: all Prisma queries are shopId-scoped (§3.1 architectural invariant).

import { prisma } from "@stylique/db";
import { estimateReplenishmentWindow } from "@stylique/core";

export type ReplenishmentNotifyJobData = {
  shopId: string;
  /** How many days ahead to look for due items. Defaults to 7. */
  daysAhead?: number;
};

type DueItem = {
  title: string;
  handle: string;
  shopifyVariantId: string | null;
  priceCents: number | null;
  urgency: "now" | "soon";
  daysUntilDue: number;
};

// ─── processReplenishmentNotify ───────────────────────────────────────────────

export async function processReplenishmentNotify(
  data: ReplenishmentNotifyJobData,
): Promise<{ sent: number; skipped: number; errors: number }> {
  const { shopId, daysAhead = 7 } = data;

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopifyDomain: true,
      uninstalledAt: true,
      plan: { select: { planFeaturesJson: true } },
    },
  });

  if (!shop || shop.uninstalledAt) {
    console.warn(`[replenishment-notify] shop not found or uninstalled: ${shopId}`);
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const storeDomain = shop.shopifyDomain;
  const featuresJson = shop.plan?.planFeaturesJson as Record<string, unknown> | null;
  const brandName =
    (featuresJson?.brandName as string | undefined) ??
    storeDomain.replace(".myshopify.com", "");

  // ─── Find eligible shoppers ───────────────────────────────────────────────
  const sessions = await prisma.shopperSession.findMany({
    where: {
      shopifyDomain: storeDomain,
      accountClaimedAt: { not: null },
      email: { not: null },
      emailVerified: true,
      marketingOptIn: true,
    },
    select: { id: true, email: true, displayName: true },
    take: 500,
  });

  if (!sessions.length) {
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const shopperIds = sessions.map((s) => s.id);
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  const purchaseEvents = await prisma.analyticsEvent.findMany({
    where: {
      shopId,
      shopperId: { in: shopperIds },
      name: "CART_CONFIRMED",
      createdAt: { gte: cutoff },
    },
    select: { shopperId: true, payload: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });

  // Group purchases by (shopper, product) — keep first purchase date per product.
  const purchasesByShopperProduct = new Map<
    string,
    Map<string, { date: Date; category: string }>
  >();
  for (const e of purchaseEvents) {
    if (!e.shopperId) continue; // shopperId is nullable in the schema
    const p = e.payload as { productId?: string; category?: string } | null;
    const pid = p?.productId;
    if (!pid) continue;
    if (!purchasesByShopperProduct.has(e.shopperId)) {
      purchasesByShopperProduct.set(e.shopperId, new Map());
    }
    const m = purchasesByShopperProduct.get(e.shopperId)!;
    if (!m.has(pid)) m.set(pid, { date: e.createdAt, category: p?.category ?? "serum" });
  }

  const allProductIds = new Set<string>();
  for (const m of purchasesByShopperProduct.values())
    for (const pid of m.keys()) allProductIds.add(pid);

  if (!allProductIds.size) return { sent: 0, skipped: 0, errors: 0 };

  const products = await prisma.product.findMany({
    where: { id: { in: [...allProductIds] }, shopId },
    select: {
      id: true,
      handle: true,
      title: true,
      category: true,
      variants: {
        where: { availableForSale: true },
        orderBy: { priceCents: "asc" },
        take: 1,
        select: { shopifyId: true, priceCents: true },
      },
    },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const now = Date.now();
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const SMTP_HOST = process.env.SMTP_HOST;
  const FROM = process.env.EMAIL_FROM ?? `noreply@${storeDomain}`;

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const session of sessions) {
    const email = session.email;
    if (!email) { skipped++; continue; }

    const shopperPurchases = purchasesByShopperProduct.get(session.id);
    if (!shopperPurchases) { skipped++; continue; }

    // Build due-item list for this shopper.
    const items: DueItem[] = [];
    for (const [productId, purchase] of shopperPurchases.entries()) {
      const product = productMap.get(productId);
      if (!product) continue;
      const purchasedDaysAgo = Math.floor(
        (now - purchase.date.getTime()) / (1000 * 60 * 60 * 24),
      );
      const category = product.category ?? purchase.category;
      const window = estimateReplenishmentWindow(category, purchasedDaysAgo);
      if (window.urgency === "later") continue;
      if (window.urgency === "soon" && window.daysUntilDue > daysAhead) continue;
      const variant = product.variants[0];
      items.push({
        title: product.title,
        handle: product.handle,
        shopifyVariantId: variant?.shopifyId ?? null,
        priceCents: variant?.priceCents ?? null,
        urgency: window.urgency as "now" | "soon",
        daysUntilDue: window.daysUntilDue,
      });
    }

    if (!items.length) { skipped++; continue; }
    items.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

    const emailContent = buildReplenishmentEmail(
      { displayName: session.displayName, items },
      storeDomain,
      brandName,
    );

    try {
      if (RESEND_KEY) {
        await sendViaResend(RESEND_KEY, FROM, email, emailContent);
      } else if (SMTP_HOST) {
        await sendViaSMTP(
          {
            host: SMTP_HOST,
            port: Number(process.env.SMTP_PORT ?? 587),
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
          FROM,
          email,
          emailContent,
        );
      } else {
        console.log(
          `[replenishment-notify-dev] Would email shopperSession=${session.id} (${items.length} item(s)): ${emailContent.subject}`,
        );
      }

      await prisma.analyticsEvent.create({
        data: {
          shopId,
          shopperId: session.id,
          name: "BEAUTY_REPLENISHMENT_TRIGGERED",
          payload: {
            source: "email",
            itemCount: items.length,
            itemHandles: items.map((i) => i.handle),
            urgencyBreakdown: {
              now: items.filter((i) => i.urgency === "now").length,
              soon: items.filter((i) => i.urgency === "soon").length,
            },
          },
        },
      });

      sent++;
    } catch (err) {
      // Do NOT log the email address at error level.
      console.error(
        `[replenishment-notify] send failed for shopperId=${session.id}:`,
        (err as Error)?.message,
      );
      errors++;
    }
  }

  console.log(
    `[replenishment-notify] shop=${shopId} sent=${sent} skipped=${skipped} errors=${errors}`,
  );
  return { sent, skipped, errors };
}

// ─── Email builders ───────────────────────────────────────────────────────────

function buildReplenishmentEmail(
  shopper: { displayName: string | null; items: DueItem[] },
  storeDomain: string,
  brandName: string,
): { subject: string; htmlBody: string; textBody: string } {
  const firstName = shopper.displayName?.split(" ")[0] ?? "there";
  const overdueItems = shopper.items.filter((i) => i.urgency === "now");
  const soonItems = shopper.items.filter((i) => i.urgency === "soon");

  const subject =
    overdueItems.length > 0
      ? `Your ${overdueItems[0].title} is ready for a refill`
      : `Time to restock — ${shopper.items[0].title}`;

  const htmlRows = shopper.items
    .map((item) => {
      const cartUrl = item.shopifyVariantId
        ? `https://${storeDomain}/cart/${item.shopifyVariantId}:1`
        : `https://${storeDomain}/products/${item.handle}`;
      const dueLabel =
        item.urgency === "now"
          ? "Ready to restock now"
          : item.daysUntilDue <= 1
          ? "Due tomorrow"
          : `Due in ${item.daysUntilDue} days`;
      const priceLabel =
        item.priceCents != null ? ` · $${(item.priceCents / 100).toFixed(2)}` : "";
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #f0ede8;">
            <strong style="font-size:15px;color:#1a1510;">${item.title}</strong>
            <span style="font-size:13px;color:#6b6460;">${priceLabel}</span><br/>
            <span style="font-size:13px;color:${item.urgency === "now" ? "#c04c2e" : "#8a6d3b"};">
              ${dueLabel}
            </span>
          </td>
          <td style="padding:12px 0 12px 16px;text-align:right;border-bottom:1px solid #f0ede8;vertical-align:middle;">
            <a href="${cartUrl}"
               style="display:inline-block;padding:8px 18px;background:#1a1510;color:#fff;
                      text-decoration:none;font-size:13px;border-radius:4px;font-weight:600;">
              Add to cart
            </a>
          </td>
        </tr>`;
    })
    .join("");

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
             style="background:#fff;border-radius:8px;overflow:hidden;
                    box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <tr>
          <td style="padding:28px 32px 20px;border-bottom:1px solid #f0ede8;">
            <span style="font-size:18px;font-weight:700;color:#1a1510;letter-spacing:-0.3px;">${brandName}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1510;line-height:1.2;letter-spacing:-0.4px;">
              Hey ${firstName}, time to restock.
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#6b6460;line-height:1.6;">
              ${
                overdueItems.length > 0
                  ? `You're running low on ${overdueItems.length === 1 ? "something" : "a few things"} — based on when you last ordered.`
                  : `A few of your favourites are coming up for a refill in the next ${soonItems.length === 1 ? `${soonItems[0].daysUntilDue} days` : "few days"}.`
              }
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">${htmlRows}</table>
            <p style="margin:24px 0 0;font-size:13px;color:#9a9490;line-height:1.5;">
              Timings are estimated from your last order.
              <a href="https://${storeDomain}" style="color:#6b6460;">Visit the store</a> to browse the full range.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#faf8f5;border-top:1px solid #f0ede8;">
            <p style="margin:0;font-size:12px;color:#9a9490;line-height:1.5;">
              You're receiving this because you opted in to restock reminders on ${storeDomain}.
              Powered by <a href="https://stylique.app" style="color:#9a9490;">Stylique</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines: string[] = [
    `Hey ${firstName},`,
    "",
    overdueItems.length > 0
      ? "Time to restock — you're running low based on when you last ordered."
      : `A few of your favourites are coming up for a refill in the next few days.`,
    "",
  ];
  for (const item of shopper.items) {
    const cartUrl = item.shopifyVariantId
      ? `https://${storeDomain}/cart/${item.shopifyVariantId}:1`
      : `https://${storeDomain}/products/${item.handle}`;
    const dueLabel =
      item.urgency === "now" ? "Ready to restock" : `Due in ${item.daysUntilDue} day${item.daysUntilDue === 1 ? "" : "s"}`;
    textLines.push(`• ${item.title} — ${dueLabel}`);
    textLines.push(`  Add to cart: ${cartUrl}`);
    textLines.push("");
  }
  textLines.push(
    "Timings are estimated from your last order.",
    `Browse the store: https://${storeDomain}`,
    "",
    `You received this because you opted in to restock reminders on ${storeDomain}.`,
  );

  return { subject, htmlBody, textBody: textLines.join("\n") };
}

// ─── Transport helpers ────────────────────────────────────────────────────────

async function sendViaResend(
  apiKey: string,
  from: string,
  to: string,
  email: { subject: string; htmlBody: string; textBody: string },
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: email.subject, html: email.htmlBody, text: email.textBody }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend failed: ${res.status} ${body}`);
  }
}

async function sendViaSMTP(
  config: { host: string; port: number; user?: string; pass?: string },
  from: string,
  to: string,
  email: { subject: string; htmlBody: string; textBody: string },
): Promise<void> {
  // @ts-expect-error — nodemailer is an optional peer dep
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = await import("nodemailer") as typeof import("nodemailer");
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });
  await transport.sendMail({ from, to, subject: email.subject, html: email.htmlBody, text: email.textBody });
}
