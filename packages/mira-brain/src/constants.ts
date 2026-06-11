// ─── Mira brain — grounded vocabulary + currency helpers ────────────────────
// Extracted verbatim from apps/web/app/api/mira/route.ts (the one brain) as the
// first slice of the brain-relocation refactor. These are pure, dependency-free
// (zod-only) values shared by the demo route and — in a later slice — the
// Shopify app's in-process caller. Behaviour is byte-identical to the inline
// originals; nothing here was changed during extraction.

// Every value maps to a deterministic builder on the client. The LLM picks one;
// it cannot make up its own. `entities` ground it to real data.
export const ROUTES = [
  "reco_category",  // entities.category → hero of that category + offer
  "reco_handle",    // entities.productHandle → that specific piece
  "reco_filter",    // entities.filter → hero of a curated subset
  "navigate",       // entities.productHandle → walk the shopper to that PDP now
  "look",           // complete-the-look board (AOV) around handle/current
  "fit",            // fit insight + size offer
  "fabric",         // fabric & care insight
  "suitability",    // candid "honest read" + size offer
  "size_form",      // open the measurement form (per-product sizing)
  "try_on",         // open the fitting room (try-on) for a piece, the closing zone
  "returns",        // returns policy insight
  "add_to_cart",    // add current/handle to bag + complete-look offer
  "search",         // keyword search → single hero
  "compare",        // side-by-side comparison of 2-3 pieces (Council item 4)
  "talk_only",      // just Mira's voice line + quick replies (no card)
] as const;

export const FILTERS = [
  "cheapest", "premium", "new", "dark", "no_dark", "edgy", "minimal",
  "winter", "summer", "everyday", "gift", "evening", "wedding",
] as const;

export const CATEGORIES = ["top", "bottom", "knitwear", "outerwear", "evening", "dress"] as const;

// What the shopper came to Mira FOR — the learning loop's intent histogram.
export const INTENTS = [
  "discover", "occasion", "specific", "size", "suitability", "fabric",
  "price", "look", "try_on", "support", "greeting", "other",
] as const;

// ─── Currency presentation ──────────────────────────────────────────────────
// catalogDigest prefixes the actual symbol / ISO code so a PKR/INR/JPY store
// has its real amounts presented correctly (no fictitious `$`).
export const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹",
  PKR: "Rs ", AED: "AED ", SAR: "SAR ", AUD: "A$", CAD: "C$",
  NZD: "NZ$", SGD: "S$", HKD: "HK$", MYR: "RM ", THB: "฿",
  KRW: "₩", VND: "₫", IDR: "Rp ", PHP: "₱", BRL: "R$", MXN: "Mex$",
  ZAR: "R ", TRY: "₺", RUB: "₽", PLN: "zł ", CHF: "CHF ",
  SEK: "SEK ", NOK: "NOK ", DKK: "DKK ", ILS: "₪", EGP: "E£",
};

export function currencyPrefix(code?: string): string {
  if (!code) return "$";
  return CURRENCY_SYMBOL[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}
