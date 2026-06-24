/**
 * Active Look Memory
 * ─────────────────────────────────────────────────────────────────────────────
 * Tracks the current outfit context across the entire conversation — not just
 * from explicit look cards, but from voice recommendations, product mentions,
 * and accepted pairings. This is what makes bundle add-to-cart robust: it
 * doesn't depend on a specific card having rendered; it knows what's in "the
 * look" from every signal the conversation produced.
 *
 * Pure TypeScript — no DOM, no async, no imports beyond catalog types.
 * Lives as a ref in MiraWidget and is updated on every message.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type LookPiece = {
  handle: string;
  name: string;
  priceUsd: number;
  addedVia: "look_card" | "voice_mention" | "explicit_recommendation" | "accepted";
  accepted: boolean;   // shopper said yes / added to bag
  rejected: boolean;   // shopper said no / dismissed
};

export type LookProductMeta = {
  handle: string;
  name: string;
  priceUsd?: number | null;
};

export type AestheticDirection =
  | "minimal"
  | "tailored"
  | "relaxed"
  | "evening"
  | "casual"
  | "luxe"
  | "monochrome"
  | "contrast"
  | "unknown";

export type ActiveLook = {
  focalHandle: string | null;     // the anchor product the look is built around
  pieces: LookPiece[];
  aestheticDirection: AestheticDirection;
  lastUpdatedAt: number;          // Date.now() — for stale-look detection
  bundleConfirmed: boolean;       // shopper explicitly accepted the full look
};

export type ActiveLookMemory = {
  current: ActiveLook | null;
  history: ActiveLook[];          // previous looks this session (for reference)
};

// ── Catalog reference (mirror of catalog.ts for pure-module use) ──────────────
// Keeps this module dependency-free from the Next.js import graph.
const DEMO_PRODUCT_NAMES: Record<string, { name: string; priceUsd: number }> = {
  "onyx-silk-slip":           { name: "Onyx Silk Slip",                  priceUsd: 690 },
  "ivory-silk-camisole":      { name: "Ivory Silk Camisole",             priceUsd: 320 },
  "atelier-wide-leg-trouser": { name: "Atelier Wide-Leg Trouser",        priceUsd: 540 },
  "linen-relaxed-shirt":      { name: "Linen Relaxed Shirt",             priceUsd: 280 },
  "wrap-coat-camel":          { name: "Camel Wrap Coat",                 priceUsd: 1280 },
  "cashmere-v-neck":          { name: "Cashmere V-Neck",                 priceUsd: 420 },
  "midnight-silk-gown":       { name: "Midnight Silk Gown",              priceUsd: 1450 },
  "tailored-blazer-double":   { name: "Tailored Double-Breasted Blazer", priceUsd: 890 },
  "pleated-midi-skirt":       { name: "Pleated Satin Midi Skirt",        priceUsd: 480 },
  "merino-ribbed-turtleneck": { name: "Merino Ribbed Turtleneck",        priceUsd: 290 },
  "leather-trench":           { name: "Leather Trench",                  priceUsd: 2400 },
  "wide-leg-denim":           { name: "Wide-Leg Heritage Denim",         priceUsd: 320 },
};

const productRegistry = new Map<string, { name: string; priceUsd: number }>(
  Object.entries(DEMO_PRODUCT_NAMES),
);

export function registerActiveLookProducts(products: LookProductMeta[]): void {
  for (const p of products) {
    const handle = p.handle?.trim().toLowerCase();
    if (!handle) continue;
    productRegistry.set(handle, {
      name: p.name || handle,
      priceUsd: Math.max(0, Math.round(Number(p.priceUsd ?? 0) || 0)),
    });
  }
}

function hasProduct(handle: string): boolean {
  return productRegistry.has(handle.trim().toLowerCase());
}

// ── Voice mention extraction ──────────────────────────────────────────────────
// Scan a Mira voice line for product handles mentioned by name.
// Handles cases like "the wide-leg trouser" matching "atelier-wide-leg-trouser".

const HANDLE_KEYWORDS: Array<[string, string]> = [
  ["silk slip",        "onyx-silk-slip"],
  ["slip dress",       "onyx-silk-slip"],
  ["silk camisole",    "ivory-silk-camisole"],
  ["camisole",         "ivory-silk-camisole"],
  ["wide.leg trouser", "atelier-wide-leg-trouser"],
  ["atelier trouser",  "atelier-wide-leg-trouser"],
  ["linen shirt",      "linen-relaxed-shirt"],
  ["relaxed shirt",    "linen-relaxed-shirt"],
  ["wrap coat",        "wrap-coat-camel"],
  ["camel coat",       "wrap-coat-camel"],
  ["cashmere",         "cashmere-v-neck"],
  ["v.neck",           "cashmere-v-neck"],
  ["silk gown",        "midnight-silk-gown"],
  ["gown",             "midnight-silk-gown"],
  ["blazer",           "tailored-blazer-double"],
  ["pleated skirt",    "pleated-midi-skirt"],
  ["midi skirt",       "pleated-midi-skirt"],
  ["turtleneck",       "merino-ribbed-turtleneck"],
  ["merino",           "merino-ribbed-turtleneck"],
  ["leather trench",   "leather-trench"],
  ["trench",           "leather-trench"],
  ["denim",            "wide-leg-denim"],
  ["jeans",            "wide-leg-denim"],
  ["wide.leg denim",   "wide-leg-denim"],
];

const GENERIC_PRODUCT_WORDS = new Set([
  "the", "a", "an", "and", "of", "for", "with", "new", "classic",
  "shirt", "top", "dress", "trouser", "trousers", "pants", "skirt",
  "coat", "jacket", "blazer", "knit", "sweater", "shoe", "bag",
]);

function normalizeMentionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dynamicMentionPhrases(handle: string, name: string): string[] {
  const normalizedName = normalizeMentionText(name);
  const normalizedHandle = normalizeMentionText(handle.replace(/-/g, " "));
  const tokens = normalizedName.split(" ").filter(Boolean);
  const meaningful = tokens.filter((t) => !GENERIC_PRODUCT_WORDS.has(t));
  const phrases = new Set<string>();
  if (normalizedName.split(" ").length >= 2) phrases.add(normalizedName);
  if (normalizedHandle.split(" ").length >= 2) phrases.add(normalizedHandle);
  if (meaningful.length >= 2) phrases.add(meaningful.join(" "));
  return [...phrases].filter((p) => p.length >= 6);
}

export function extractHandlesFromVoice(voice: string): string[] {
  const lower = voice.toLowerCase();
  const normalized = normalizeMentionText(voice);
  const found = new Set<string>();
  for (const [keyword, handle] of HANDLE_KEYWORDS) {
    const re = new RegExp(keyword, "i");
    if (re.test(lower)) found.add(handle);
  }
  for (const [handle, meta] of productRegistry) {
    for (const phrase of dynamicMentionPhrases(handle, meta.name)) {
      if (normalized.includes(phrase)) {
        found.add(handle);
        break;
      }
    }
  }
  return Array.from(found);
}

// ── Aesthetic direction inference ─────────────────────────────────────────────
function inferAesthetic(handles: string[]): AestheticDirection {
  const hasEvening = handles.some((h) => ["onyx-silk-slip", "midnight-silk-gown", "pleated-midi-skirt"].includes(h));
  const hasTailored = handles.some((h) => ["tailored-blazer-double", "atelier-wide-leg-trouser"].includes(h));
  const hasRelaxed = handles.some((h) => ["linen-relaxed-shirt", "wide-leg-denim"].includes(h));
  const hasLuxe = handles.some((h) => ["leather-trench", "wrap-coat-camel", "midnight-silk-gown"].includes(h));
  if (hasEvening && hasTailored) return "luxe";
  if (hasEvening) return "evening";
  if (hasTailored && !hasRelaxed) return "tailored";
  if (hasRelaxed && !hasTailored) return "relaxed";
  if (hasLuxe) return "luxe";
  return "unknown";
}

// ── Factory ───────────────────────────────────────────────────────────────────

function makePiece(handle: string, via: LookPiece["addedVia"]): LookPiece | null {
  const key = handle.trim().toLowerCase();
  const meta = productRegistry.get(key);
  if (!meta) return null;
  return { handle: key, name: meta.name, priceUsd: meta.priceUsd, addedVia: via, accepted: false, rejected: false };
}

function emptyMemory(): ActiveLookMemory {
  return { current: null, history: [] };
}

// ── Memory updater — called by MiraWidget on every Mira message ───────────────

/**
 * Update the active look memory from a new Mira message.
 *
 * Call sites in MiraWidget:
 *   • When a `look` card renders: updateFromLookCard(anchor.handle, pieces.map(p => p.handle))
 *   • When a `reco` card renders: updateFromReco(product.handle, currentProductHandle)
 *   • When a `say` message arrives with a recommendation: updateFromVoice(voice, currentProductHandle)
 *   • When a cart message fires: markAccepted(handle)
 */
export function updateFromLookCard(
  mem: ActiveLookMemory,
  anchorHandle: string,
  pieceHandles: string[],
): ActiveLookMemory {
  const allHandles = [anchorHandle, ...pieceHandles].map((h) => h.trim().toLowerCase()).filter(hasProduct);
  const pieces: LookPiece[] = allHandles.map((h, i) =>
    makePiece(h, i === 0 ? "look_card" : "look_card")!
  ).filter(Boolean);

  const look: ActiveLook = {
    focalHandle: anchorHandle,
    pieces,
    aestheticDirection: inferAesthetic(allHandles),
    lastUpdatedAt: Date.now(),
    bundleConfirmed: false,
  };

  return {
    current: look,
    history: mem.current ? [...mem.history.slice(-4), mem.current] : mem.history,
  };
}

export function updateFromVoice(
  mem: ActiveLookMemory,
  voice: string,
  currentFocalHandle: string | null,
): ActiveLookMemory {
  const mentioned = extractHandlesFromVoice(voice).filter(hasProduct);
  if (mentioned.length === 0) return mem;

  const existingPieces = mem.current?.pieces ?? [];
  const existingHandles = new Set(existingPieces.map((p) => p.handle));

  const newPieces = mentioned
    .filter((h) => !existingHandles.has(h))
    .map((h) => makePiece(h, "voice_mention"))
    .filter((p): p is LookPiece => p !== null);

  if (newPieces.length === 0) return mem;

  const allPieces = [...existingPieces, ...newPieces];
  const allHandles = allPieces.map((p) => p.handle);
  const focal = mem.current?.focalHandle ?? currentFocalHandle ?? mentioned[0];

  const updated: ActiveLook = {
    focalHandle: focal,
    pieces: allPieces,
    aestheticDirection: inferAesthetic(allHandles),
    lastUpdatedAt: Date.now(),
    bundleConfirmed: mem.current?.bundleConfirmed ?? false,
  };

  return {
    current: updated,
    history: mem.history,
  };
}

export function updateFromReco(
  mem: ActiveLookMemory,
  recoHandle: string,
  focalHandle: string | null,
): ActiveLookMemory {
  if (!hasProduct(recoHandle)) return mem;
  const existingPieces = mem.current?.pieces ?? [];
  const alreadyHas = existingPieces.some((p) => p.handle === recoHandle);
  if (alreadyHas) return mem;

  const newPiece = makePiece(recoHandle, "explicit_recommendation");
  if (!newPiece) return mem;

  const allPieces = [...existingPieces, newPiece];
  const allHandles = allPieces.map((p) => p.handle);
  const focal = mem.current?.focalHandle ?? focalHandle ?? recoHandle;

  return {
    current: {
      focalHandle: focal,
      pieces: allPieces,
      aestheticDirection: inferAesthetic(allHandles),
      lastUpdatedAt: Date.now(),
      bundleConfirmed: mem.current?.bundleConfirmed ?? false,
    },
    history: mem.history,
  };
}

export function markAccepted(mem: ActiveLookMemory, handle: string): ActiveLookMemory {
  if (!mem.current) return mem;
  const pieces = mem.current.pieces.map((p) =>
    p.handle === handle ? { ...p, accepted: true } : p
  );
  const bundleConfirmed = pieces.length >= 2 && pieces.every((p) => p.accepted);
  return {
    ...mem,
    current: { ...mem.current, pieces, bundleConfirmed, lastUpdatedAt: Date.now() },
  };
}

export function markRejected(mem: ActiveLookMemory, handle: string): ActiveLookMemory {
  if (!mem.current) return mem;
  return {
    ...mem,
    current: {
      ...mem.current,
      pieces: mem.current.pieces.map((p) =>
        p.handle === handle ? { ...p, rejected: true } : p
      ),
      lastUpdatedAt: Date.now(),
    },
  };
}

// ── Bundle resolution ─────────────────────────────────────────────────────────
// The key output: given "add everything", what exactly gets added?

export type BundleResolution = {
  itemsToAdd: LookPiece[];
  itemsSkipped: LookPiece[];
  totalPrice: number;
  isFull: boolean;    // all non-rejected pieces
  isPartial: boolean; // some skipped
};

export function resolveBundle(mem: ActiveLookMemory): BundleResolution | null {
  const look = mem.current;
  if (!look || look.pieces.length === 0) return null;

  // A look is stale after 20 minutes — don't add a different session's outfit
  const STALE_MS = 20 * 60 * 1000;
  if (Date.now() - look.lastUpdatedAt > STALE_MS) return null;

  const eligible = look.pieces.filter((p) => !p.rejected);
  const itemsToAdd = eligible;
  const itemsSkipped = look.pieces.filter((p) => p.rejected);
  const totalPrice = itemsToAdd.reduce((s, p) => s + p.priceUsd, 0);

  return {
    itemsToAdd,
    itemsSkipped,
    totalPrice,
    isFull: itemsSkipped.length === 0,
    isPartial: itemsSkipped.length > 0,
  };
}

// ── Summary for prompt injection ──────────────────────────────────────────────

export function buildLookContextBlock(mem: ActiveLookMemory): string {
  const look = mem.current;
  if (!look || look.pieces.length < 2) return "";
  const STALE_MS = 20 * 60 * 1000;
  if (Date.now() - look.lastUpdatedAt > STALE_MS) return "";

  const names = look.pieces.filter((p) => !p.rejected).map((p) => p.name);
  const total = look.pieces.filter((p) => !p.rejected).reduce((s, p) => s + p.priceUsd, 0);

  return [
    `ACTIVE LOOK (from this conversation — use this when shopper says "add everything" or "the full look"):`,
    `  Focal: ${look.focalHandle ?? "unknown"}`,
    `  Pieces: ${names.join(", ")}`,
    `  Total: $${total.toLocaleString()}`,
    `  Direction: ${look.aestheticDirection}`,
    `  Bundle confirmed by shopper: ${look.bundleConfirmed}`,
  ].join("\n");
}

export { emptyMemory };
