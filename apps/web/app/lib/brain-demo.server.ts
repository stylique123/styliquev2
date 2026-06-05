// Demo-side wiring for the Stylique Brain (Mira) inside apps/web.
//
// ─── How apps/web and apps/shopify-app connect ──────────────────────────────
// apps/web  = marketing/demo site. Shows potential brands what Stylique looks
//             like on a real store. Uses the same @stylique/ai Brain and Gemini
//             provider as production, so demos are genuine.
// apps/shopify-app = the actual Shopify app brands install. Widget custom
//             elements (<stylique-widget>, <stylique-stylist>) run on the brand's
//             storefront via Shopify's App Proxy + theme app embed.
//
// When a brand installs Stylique, their storefront gets the compiled widget JS
// (apps/shopify-app/extensions/stylique-widget/assets/widget.js). The demo site
// could embed that same script once it's published to a CDN — for now, the
// demo's React surfaces (MiraDock, TryOnPanel, StudioModal) mirror the widget's
// UX with the same dark editorial design tokens.
//
// Connection points:
//   1. Both share @stylique/ai Brain (same orchestrator, same tools, same Gemini
//      provider). Brain actions (open_tryon, open_studio, navigate) fire the
//      same way — the demo's Tour.tsx handles them by opening the right surface.
//   2. Both share @stylique/core/plans/features.ts (tier feature matrix).
//   3. Both share @stylique/types (EventName enum, PlanTier, etc.).
//   4. BrainClientAction type is imported directly in MiraDock.tsx — no duplicate.
// ─────────────────────────────────────────────────────────────────────────────
//
// Same orchestrator + provider + prompts as the production storefront in
// apps/shopify-app — but the tool handlers read from this app's static
// catalog (`lib/catalog.ts`) instead of Prisma. No DB, no Shopify session,
// no entitlement gate. The demo just needs Mira to talk to a real LLM,
// reference real products from this store, and emit `navigate` actions
// the demo router can act on.
//
// Three tools are registered: `search_catalog`, `propose_combo`, `navigate`.
// Everything else (try-on, studio, signup, capture-profile) is left out —
// the demo surfaces mock those flows visually via the tour script.

// (server-only guard intentionally omitted — file is only imported from the
// route handler at apps/web/app/api/chat/route.ts, which keeps it server-side.)
import {
  Brain,
  ToolRegistry,
  createGeminiProvider,
  defaultStylistVariant,
  searchCatalogToolSchema,
  proposeComboToolSchema,
  navigateToolSchema,
  type BrainContext,
  type BrainProduct,
  type BrainCombo,
  type BrainClientAction,
  type ModelProvider,
  type ProviderTurnInput,
  type ProviderTurnOutput,
} from "@stylique/ai";
// Import the plan matrix directly instead of from @stylique/core's barrel.
// The barrel exports native image-processing modules used by workers, which
// makes Next try to bundle onnxruntime-node into apps/web's production build.
import { PLAN_FEATURES } from "@stylique/core/src/plans/features";
import { products as catalog, type Product } from "./catalog";

// ─── Demo tool handlers ────────────────────────────────────────────────

function toBrainProduct(p: Product): BrainProduct {
  return {
    id: p.handle,
    handle: p.handle,
    title: p.name,
    imageUrl: p.images[0] ?? null,
    primaryColor: p.colors[0] ?? null,
    colorFamily: null,
    category: p.category,
    sizes: p.sizes,
  };
}

async function handleSearchCatalog(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "data"; data: { products: BrainProduct[] } }> {
  const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
  const limit =
    typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 8) : 4;

  const tokens = query.split(/\s+/).filter(Boolean);
  const scored = catalog.map((p) => {
    const hay = [
      p.name,
      p.description,
      p.category,
      p.collection,
      ...p.colors,
    ]
      .join(" ")
      .toLowerCase();
    const score = tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
    return { p, score };
  });

  // If query produced no matches, fall back to a curated sample so the
  // model always has something to talk about — same instinct as the
  // production handler's "soft fallback" on empty result.
  let hits = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.p);

  if (hits.length === 0) hits = catalog.slice(0, limit);

  ctx.log({
    name: "CHAT_SEARCH_RUN",
    payload: { query, resultCount: hits.length },
  });

  return { kind: "data", data: { products: hits.map(toBrainProduct) } };
}

async function handleProposeCombo(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "combo"; combo: BrainCombo }> {
  const name = typeof args.name === "string" ? args.name : "A look";
  const reasoning =
    typeof args.reasoning === "string" ? args.reasoning : "Pieces that move well together.";
  const ids = Array.isArray(args.productIds) ? args.productIds : [];

  const products: BrainProduct[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const found = catalog.find((p) => p.handle === id);
    if (found) products.push(toBrainProduct(found));
  }

  ctx.log({
    name: "CHAT_COMBO_PROPOSED",
    payload: { name, productIds: products.map((p) => p.id) },
  });

  return { kind: "combo", combo: { name, reasoning, products } };
}

async function handleNavigate(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "action"; action: BrainClientAction }> {
  const handle = typeof args.handle === "string" ? args.handle : "";
  const exists = catalog.find((p) => p.handle === handle);

  if (exists) {
    ctx.log({
      name: "CHAT_NAV_REQUESTED",
      productId: exists.handle,
      payload: { productHandle: handle },
    });
    return { kind: "action", action: { kind: "navigate", handle } };
  }
  return { kind: "action", action: { kind: "navigate", handle: "" } };
}

// ─── Stub provider — falls back to a canned reply if GEMINI_API_KEY missing ─

function createStubProvider(): ModelProvider {
  return {
    key: "stub",
    defaultModel: "stub",
    async turn(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
      void input;
      return {
        text:
          "I'm Mira — the live Brain isn't wired in this environment, but I'm here. Add GEMINI_API_KEY to enable real conversation.",
        toolCalls: [],
      };
    },
  };
}

// ─── Singleton ─────────────────────────────────────────────────────────

let __demoBrain: Brain | null = null;

export function getDemoBrain(): Brain {
  if (__demoBrain) return __demoBrain;

  const registry = new ToolRegistry();
  registry.register({ ...searchCatalogToolSchema, handler: handleSearchCatalog });
  registry.register({ ...proposeComboToolSchema, handler: handleProposeCombo });
  registry.register({ ...navigateToolSchema, handler: handleNavigate });

  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  const provider: ModelProvider = hasGeminiKey
    ? createGeminiProvider({
        apiKey: process.env.GEMINI_API_KEY ?? "",
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      })
    : createStubProvider();

  __demoBrain = new Brain({
    tools: registry,
    providers: { [provider.key]: provider },
    defaultProviderKey: provider.key,
    promptVariants: { default: defaultStylistVariant },
  });

  return __demoBrain;
}

// ─── Demo BrainContext builder ─────────────────────────────────────────

export function buildDemoBrainContext(sessionId: string): BrainContext {
  return {
    shopId: "demo-shop",
    shopDomain: "stylique-maison.demo",
    shopperRowId: `demo-${sessionId}`,
    shopperSessionId: sessionId,
    tier: "STARTER",
    features: PLAN_FEATURES.STARTER,
    brief:
      "Demo shopper browsing Stylique Maison — an editorial fashion house. Catalog is small (~12 pieces) spanning evening, tailoring, knitwear, outerwear, and the atelier line.",
    accountClaimed: false,
    signupAlreadyOffered: true, // never offer signup in the demo
    recentHistory: [],
    signalCount: 0,
    surface: "stylist_chat",
    // Required BrainContext fields — empty in the demo (no real DB, no shopper signals).
    currentProduct: null,
    catalogOverview: [],
    totalProducts: catalog.length,
    recentRecs: [],
    recentBehavior: [],
    cache: new Map(),
    log: (event) => {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[mira-demo]", event.name, event.payload ?? {});
      }
    },
  };
}
