// GDPR Art. 5(1)(e) data-retention cleanup — ShopperSession rows.
//
// Retention schedule:
//   Anonymous sessions  (accountClaimedAt IS NULL)    → purge after 24 months
//   Claimed accounts    (accountClaimedAt IS NOT NULL) → purge after 36 months
//
// The clock runs from lastSeenAt (the last time the shopper interacted with
// any widget or chat endpoint).  lastSeenAt is touched fire-and-forget on every
// getOrCreateShopperSession() hit, so it reflects real engagement recency.
//
// This job runs weekly (Monday 03:00 UTC — after the nightly Gemini sweeps at
// 02:30/02:45 have cleared) via the platform scheduler.  It is idempotent:
// re-running has no effect on rows that already satisfy the retention window.
//
// Related:  session.server.ts COOKIE_MAX_AGE is 180 days — deliberately shorter
// than the 24-month retention window.  The cookie expires naturally to reduce
// active tracking; the DB row is kept longer to support cross-session continuity
// for returning shoppers who re-accept the cookie within the retention window.

import type { PrismaClient } from "@stylique/db";

// ─── Retention windows ───────────────────────────────────────────────────────

const MONTHS_ANONYMOUS = 24;  // Art. 5(1)(e) — anonymous sessions
const MONTHS_CLAIMED   = 36;  // Art. 5(1)(e) — claimed accounts (longer justified
                               // by legitimate interest in continuity)

function monthsAgo(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

// ─── Return type ─────────────────────────────────────────────────────────────

export type RetentionCleanupResult = {
  anonymousDeleted: number;
  claimedDeleted: number;
};

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * runRetentionCleanup — deletes ShopperSession rows that exceed the GDPR
 * Art. 5(1)(e) storage limitation schedule.
 *
 * @param prisma  Prisma client instance (injected so the worker can pass its
 *                singleton; avoids a second connection pool from this module).
 * @returns       Counts of deleted rows per retention category.
 */
export async function runRetentionCleanup(
  prisma: PrismaClient,
): Promise<RetentionCleanupResult> {
  const anonymousCutoff = monthsAgo(MONTHS_ANONYMOUS);
  const claimedCutoff   = monthsAgo(MONTHS_CLAIMED);

  // ── Anonymous sessions (no account claim) ────────────────────────────────
  // deleteMany is a single SQL DELETE — no ORM round-trips per row.
  const anonymousResult = await prisma.shopperSession.deleteMany({
    where: {
      accountClaimedAt: null,
      lastSeenAt: { lt: anonymousCutoff },
    },
  });

  // ── Claimed accounts ─────────────────────────────────────────────────────
  const claimedResult = await prisma.shopperSession.deleteMany({
    where: {
      accountClaimedAt: { not: null },
      lastSeenAt: { lt: claimedCutoff },
    },
  });

  const { count: anonymousDeleted } = anonymousResult;
  const { count: claimedDeleted }   = claimedResult;

  console.log(
    `[retention-cleanup] purged ${anonymousDeleted} anonymous session(s) ` +
    `(lastSeenAt < ${anonymousCutoff.toISOString()})`,
  );
  console.log(
    `[retention-cleanup] purged ${claimedDeleted} claimed-account session(s) ` +
    `(lastSeenAt < ${claimedCutoff.toISOString()})`,
  );

  return { anonymousDeleted, claimedDeleted };
}
