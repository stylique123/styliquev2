// Mira's learning loop — the moat, not the chatbot.
//
// Every shopper turn produces ONE signal: what they asked, the intent we read,
// the product we landed them on, and — critically — whether we COULD serve it
// (a met demand) or NOT (an unmet demand = a catalog gap the brand should act
// on). Aggregated, these signals are the brand-facing intelligence Stylique is
// actually selling: "12 shoppers asked for shoes this week, you carry none" →
// reorder decision. "9 asked for something under $100, your floor is $180" →
// price-point gap. This is the demo analogue of production's CatalogGap +
// taste-vector + sentiment pipeline (CLAUDE.md §1/§9/§11).
//
// 10x pass — four sharper signals layered on top of binary met/unmet:
//   1. NEAR-MISS  — we served a close match missing ONE named attribute
//                   ("linen but not cropped"). Sharper reorder hint than a hard
//                   gap because the brand already half-stocks it.
//   2. INTENSITY  — gaps ranked by recency-weighted demand (7-day half-life),
//                   not raw count: 4 asks this week outrank 6 from last month.
//   3. CONVERSION — served demand paired with add-to-bag, so the hit-rate can
//                   answer "did discovery actually convert?", not just "did Mira
//                   find something?".
//   4. CANONICAL  — gap categories folded into stable buckets so "Price<100",
//                   "price<100" and "under $100" count as ONE gap.
//
// Storage mirrors mira-knowledge.server.ts exactly: a JSON file under
// apps/web/data/ when the FS is writable (local demo), backed by an in-memory
// cache so it also works on a read-only serverless FS. No DB — flat file is the
// right weight for a demo.
//
// PRIVACY (D23 / PB17 / §3.5): we store the shopper's TYPED QUERY TEXT (needed
// to show the brand the literal demand) and the routing decision — never images,
// never PII, never a cookie/identity. The query is the demand; that's the point.

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export type MiraIntent =
  | "discover" // open-ended "help me find something"
  | "occasion" // dressing for an event
  | "specific" // named/clearly-sold-on a piece
  | "size" // sizing / fit
  | "suitability" // "is this right for me?" — honest-opinion seeking
  | "fabric" // material / care
  | "price" // budget / "cheaper"
  | "look" // complete-the-look / pairing
  | "try_on" // see it on
  | "support" // returns / policy / logistics
  | "greeting" // hello / smalltalk
  | "other";

// A turn is a shopper utterance; a conversion is a later add-to-bag tied to a
// product. Splitting the kind lets aggregation pair served demand with revenue
// without double-counting turns.
export type MiraSignalKind = "turn" | "conversion";

export type MiraSignal = {
  id: string;
  ts: string; // ISO timestamp
  kind?: MiraSignalKind; // undefined = legacy "turn" (back-compat)
  query: string; // the shopper's literal message (the demand)
  route: string; // the route the brain resolved to
  intent: MiraIntent;
  productHandle: string | null; // what we landed them on, if anything
  unmet: boolean; // TRUE = we could not serve this at all = hard catalog gap
  unmetCategory: string | null; // brand-readable bucket: "footwear", "price<100", "leather skirt"…
  unmetReason: string | null; // one short human line for the dashboard
  // ── Near-miss: served a close match but ONE attribute was off ─────────────
  nearMiss?: boolean; // TRUE = served, but not exactly what they wanted
  nearMissCategory?: string | null; // the broader bucket we DO stock ("linen shirts")
  nearMissAttribute?: string | null; // the single missing attribute ("cropped", "in black", "petite")
  nearMissReason?: string | null; // one short human line for the dashboard
  source: "gemini" | "fallback"; // which brain produced it (quality signal)
};

const SIGNALS_PATH =
  process.env.MIRA_SIGNALS_PATH ??
  path.join(process.cwd(), "data", "mira-signals.json");

const CAP = 2000; // keep the last N signals; plenty for a demo, bounds file size
const HALF_LIFE_DAYS = 7; // demand intensity halves every week

let cache: MiraSignal[] | null = null;

async function load(): Promise<MiraSignal[]> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(SIGNALS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? (parsed as MiraSignal[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist(entries: MiraSignal[]): Promise<void> {
  cache = entries;
  try {
    await fs.mkdir(path.dirname(SIGNALS_PATH), { recursive: true });
    await fs.writeFile(SIGNALS_PATH, JSON.stringify(entries, null, 2), "utf8");
  } catch (err) {
    // Read-only FS (serverless) — in-memory cache still serves this instance.
    console.warn(
      "[mira-signals] persist skipped:",
      err instanceof Error ? err.message : err,
    );
  }
}

export type RecordSignalInput = {
  query: string;
  route: string;
  intent?: MiraIntent;
  productHandle?: string | null;
  unmet?: boolean;
  unmetCategory?: string | null;
  unmetReason?: string | null;
  nearMiss?: boolean;
  nearMissCategory?: string | null;
  nearMissAttribute?: string | null;
  nearMissReason?: string | null;
  source: "gemini" | "fallback";
};

export async function recordSignal(input: RecordSignalInput): Promise<void> {
  const entries = await load();
  const sig: MiraSignal = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    kind: "turn",
    query: input.query.trim().slice(0, 300),
    route: input.route,
    intent: input.intent ?? "other",
    productHandle: input.productHandle ?? null,
    unmet: Boolean(input.unmet),
    unmetCategory: input.unmetCategory?.trim().slice(0, 60) ?? null,
    unmetReason: input.unmetReason?.trim().slice(0, 160) ?? null,
    nearMiss: Boolean(input.nearMiss),
    nearMissCategory: input.nearMissCategory?.trim().slice(0, 60) ?? null,
    nearMissAttribute: input.nearMissAttribute?.trim().slice(0, 40) ?? null,
    nearMissReason: input.nearMissReason?.trim().slice(0, 160) ?? null,
    source: input.source,
  };
  // newest first; cap
  await persist([sig, ...entries].slice(0, CAP));
}

// Records an add-to-bag as a conversion tied to a product. Loophole #3 — lets
// the dashboard answer "did discovery convert?", not just "did Mira find it?".
export async function recordConversion(
  productHandle: string | null | undefined,
): Promise<void> {
  if (!productHandle) return;
  const entries = await load();
  const sig: MiraSignal = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    kind: "conversion",
    query: "",
    route: "add_to_cart",
    intent: "specific",
    productHandle: productHandle.trim().slice(0, 120),
    unmet: false,
    unmetCategory: null,
    unmetReason: null,
    source: "gemini",
  };
  await persist([sig, ...entries].slice(0, CAP));
}

export async function readSignals(): Promise<MiraSignal[]> {
  return [...(await load())];
}

// ─── Canonical buckets — loophole #4 ────────────────────────────────────────
// The model writes free-form category labels ("Price<100", "under $100", "cheaper
// options"). Fold them into stable buckets so one demand isn't split across three
// rows. Conservative: anything unmatched keeps its lowercased label.
export function canonicalCategory(raw: string | null | undefined): string {
  const s = (raw ?? "unspecified").toLowerCase().trim();
  if (!s) return "unspecified";

  // Price-point gaps — any "under/below $N", "price<N", "cheaper", "budget".
  if (
    /(^|\b)(price|budget|cheap|affordable|under|below|less than)\b/.test(s) ||
    /[<≤]\s*\$?\d/.test(s) ||
    /\bunder\s*\$?\d/.test(s)
  ) {
    return "price point (budget)";
  }
  if (/\b(footwear|shoe|shoes|sneaker|heel|boot|sandal|loafer|flat)s?\b/.test(s))
    return "footwear";
  if (/\b(bag|bags|handbag|tote|clutch|purse|backpack)\b/.test(s))
    return "bags";
  if (/\b(jewel|jewelry|jewellery|necklace|earring|bracelet|ring)\b/.test(s))
    return "jewelry";
  if (/\b(accessor|belt|scarf|hat|sunglass|glove)\w*\b/.test(s))
    return "accessories";
  if (/\b(plus[\s-]?size|xl|xxl|2xl|3xl|extended siz)\w*\b/.test(s))
    return "extended sizing";
  if (/\b(petite|petites)\b/.test(s)) return "petite sizing";
  if (/\b(activewear|athleisure|gym|workout|sport)\w*\b/.test(s))
    return "activewear";
  if (/\b(swim|swimwear|bikini|swimsuit)\b/.test(s)) return "swimwear";
  if (/\b(lingerie|underwear|intimates)\b/.test(s)) return "intimates";
  if (/\b(leather)\b/.test(s)) return "leather pieces";
  if (/\b(denim|jean|jeans)\b/.test(s)) return "denim";
  if (/\b(knit|knitwear|sweater|cardigan|jumper)\b/.test(s)) return "knitwear";
  if (/\b(outerwear|coat|jacket|parka|blazer)\b/.test(s)) return "outerwear";
  if (/\b(dress|dresses|gown)\b/.test(s)) return "dresses";
  if (/\b(men|menswear|mens)\b/.test(s)) return "menswear";
  if (/\b(kids|children|child|toddler|baby)\w*\b/.test(s)) return "kidswear";

  return s.slice(0, 60);
}

// Recency weight: 1.0 today, 0.5 at one half-life, → 0 as it ages.
function recencyWeight(ts: string, now: number): number {
  const ageDays = Math.max(0, (now - new Date(ts).getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

// ─── Aggregation — turns raw signals into brand decisions ───────────────────
// Each output names the decision it informs (CLAUDE.md §11 data→decision law).

export type CatalogGap = {
  category: string; // the canonical unmet bucket
  count: number; // how many shoppers asked (raw)
  intensity: number; // recency-weighted demand (the ranking signal)
  reason: string; // a representative human line
  examples: string[]; // up to 3 literal queries (the demand, verbatim)
  lastAsked: string; // ISO of the most recent ask
};

export type NearMiss = {
  category: string; // the bucket we DO stock
  attribute: string; // the single missing attribute that lost the sale
  count: number;
  intensity: number; // recency-weighted
  reason: string;
  examples: string[];
  lastAsked: string;
};

export type IntentCount = { intent: MiraIntent; count: number };

export type InsightSummary = {
  totalConversations: number; // demand-bearing turns seen
  metCount: number; // turns we served from catalog
  unmetCount: number; // turns we could not serve at all
  discoveryHitRate: number; // met / (met+unmet) over demand-bearing turns, 0..1
  surfacedCount: number; // turns where we put a real product in front of them
  convertedCount: number; // add-to-bag conversions
  conversionRate: number; // converted / surfaced, 0..1 (capped)
  catalogGaps: CatalogGap[]; // ranked unmet demand → reorder/stock/price decisions
  nearMisses: NearMiss[]; // "almost had it" → the sharpest reorder hints
  topIntents: IntentCount[]; // what shoppers come to Mira for
  recentUnmet: { query: string; reason: string; ts: string }[]; // raw feed
  generatedAt: string;
};

// Turns that carry real product demand (exclude greetings/support/size/fabric
// chit-chat) so the hit-rate measures DISCOVERY, not every utterance.
const DEMAND_INTENTS = new Set<MiraIntent>([
  "discover",
  "occasion",
  "specific",
  "price",
  "look",
  "try_on",
  "suitability",
]);

export async function aggregateInsights(): Promise<InsightSummary> {
  const all = await load();
  const now = Date.now();

  // Split turns from conversions. Legacy signals (no kind) are turns.
  const turns = all.filter((s) => (s.kind ?? "turn") === "turn");
  const conversions = all.filter((s) => s.kind === "conversion");

  const demandSignals = turns.filter((s) => DEMAND_INTENTS.has(s.intent));
  const unmet = turns.filter((s) => s.unmet);
  const metDemand = demandSignals.filter((s) => !s.unmet).length;
  const unmetDemand = demandSignals.filter((s) => s.unmet).length;
  const denom = metDemand + unmetDemand;

  // Surfaced = demand turns where we actually put a real product forward and it
  // wasn't a hard gap. That's the honest denominator for conversion.
  const surfacedCount = demandSignals.filter(
    (s) => !s.unmet && Boolean(s.productHandle),
  ).length;
  const convertedCount = conversions.length;
  const conversionRate =
    surfacedCount === 0 ? 0 : Math.min(1, convertedCount / surfacedCount);

  // Group hard unmet demand by its CANONICAL category bucket (loophole #4).
  const gapMap = new Map<
    string,
    {
      count: number;
      intensity: number;
      reasons: string[];
      examples: string[];
      last: string;
    }
  >();
  for (const s of unmet) {
    const key = canonicalCategory(s.unmetCategory);
    const g = gapMap.get(key) ?? {
      count: 0,
      intensity: 0,
      reasons: [],
      examples: [],
      last: s.ts,
    };
    g.count += 1;
    g.intensity += recencyWeight(s.ts, now);
    if (s.unmetReason && g.reasons.length < 5) g.reasons.push(s.unmetReason);
    if (s.query && g.examples.length < 3) g.examples.push(s.query);
    if (s.ts > g.last) g.last = s.ts;
    gapMap.set(key, g);
  }
  const catalogGaps: CatalogGap[] = [...gapMap.entries()]
    .map(([category, g]) => ({
      category,
      count: g.count,
      intensity: Math.round(g.intensity * 100) / 100,
      reason:
        g.reasons[0] ?? "Shoppers asked for this; nothing in catalog matched.",
      examples: g.examples,
      lastAsked: g.last,
    }))
    // Loophole #2 — rank by recency-weighted intensity, not raw count.
    .sort((a, b) => b.intensity - a.intensity);

  // Group near-misses by category + the specific missing attribute (loophole #1).
  const nmMap = new Map<
    string,
    {
      category: string;
      attribute: string;
      count: number;
      intensity: number;
      reasons: string[];
      examples: string[];
      last: string;
    }
  >();
  for (const s of turns) {
    if (!s.nearMiss) continue;
    const category = canonicalCategory(s.nearMissCategory);
    const attribute = (s.nearMissAttribute ?? "unspecified")
      .toLowerCase()
      .trim();
    const key = `${category}::${attribute}`;
    const g = nmMap.get(key) ?? {
      category,
      attribute,
      count: 0,
      intensity: 0,
      reasons: [],
      examples: [],
      last: s.ts,
    };
    g.count += 1;
    g.intensity += recencyWeight(s.ts, now);
    if (s.nearMissReason && g.reasons.length < 5) g.reasons.push(s.nearMissReason);
    if (s.query && g.examples.length < 3) g.examples.push(s.query);
    if (s.ts > g.last) g.last = s.ts;
    nmMap.set(key, g);
  }
  const nearMisses: NearMiss[] = [...nmMap.values()]
    .map((g) => ({
      category: g.category,
      attribute: g.attribute,
      count: g.count,
      intensity: Math.round(g.intensity * 100) / 100,
      reason:
        g.reasons[0] ??
        `Stocked the category but not "${g.attribute}".`,
      examples: g.examples,
      lastAsked: g.last,
    }))
    .sort((a, b) => b.intensity - a.intensity);

  // Intent histogram (turns only).
  const intentMap = new Map<MiraIntent, number>();
  for (const s of turns)
    intentMap.set(s.intent, (intentMap.get(s.intent) ?? 0) + 1);
  const topIntents: IntentCount[] = [...intentMap.entries()]
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);

  const recentUnmet = unmet
    .slice(0, 12)
    .map((s) => ({
      query: s.query,
      reason: s.unmetReason ?? "Not in catalog.",
      ts: s.ts,
    }));

  return {
    totalConversations: turns.length,
    metCount: turns.filter((s) => !s.unmet).length,
    unmetCount: unmet.length,
    discoveryHitRate: denom === 0 ? 0 : metDemand / denom,
    surfacedCount,
    convertedCount,
    conversionRate,
    catalogGaps,
    nearMisses,
    topIntents,
    recentUnmet,
    generatedAt: new Date().toISOString(),
  };
}
