// ─── Mira brain — pure text helpers ─────────────────────────────────────────
// Extracted verbatim from apps/web/app/api/mira/route.ts. No external deps.

// Surface height/weight/size from prior turns so Mira never re-asks for
// measurements the shopper already gave.
export function extractBodyContext(history: { from: string; text: string }[]): string {
  const HW_RE = /(\d{3})\s*cm.*?(\d{2,3})\s*kg|(\d{1,2})['"′]\s*(\d{1,2})[″"].*?(\d{2,3})\s*(kg|lbs?)|(\d{2,3})\s*(kg|lbs?).*?(\d{3})\s*cm/i;
  const SIZE_RE = /(?:I[''`]?m|wear|usually|normally|typically)\s+(?:a\s+)?(?:size\s+)?([XS]{0,2}[ML]|XXL|XL|[0-9]{1,2})\b/i;
  for (const turn of [...history].reverse()) {
    if (turn.from !== "user") continue;
    const hw = turn.text.match(HW_RE);
    if (hw) return `BODY DATA (from earlier this session, use this instead of asking again): ${turn.text.trim()}.`;
    const sz = turn.text.match(SIZE_RE);
    if (sz) return `SIZE STATED (shopper said their usual size earlier this session): "${sz[1]}", acknowledge this before asking for measurements.`;
  }
  return "";
}
