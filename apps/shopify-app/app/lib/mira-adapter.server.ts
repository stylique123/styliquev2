// ─── SaaS migration · Stage 1 — the Mira adapter ────────────────────────────
//
// Lets the REAL per-tenant brain (runChatTurn → recommends ONLY from each shop's
// synced Prisma catalog, never a hardcoded product list) speak the `MiraDecision`
// shape the storefront UI already understands. Crucially it ALSO returns the real,
// per-shop product data attached to the turn, so the widget renders genuine cards
// for THAT merchant — the whole point of "it's a SaaS, not a whitelabel".
//
// This is additive: it does not touch the demo path. Once the widget is repointed
// at the App Proxy (Stage 2) and consumes `products`/`look` (Stage 3), the
// storefront runs entirely on per-tenant data with zero hardcoded catalog.

import { postChat } from "./chat.server";
import type { BrainClientAction, BrainCombo, BrainProduct } from "@stylique/ai";

type MiraRoute =
  | "reco_handle" | "navigate" | "look" | "size_form" | "try_on"
  | "add_to_cart" | "studio" | "talk_only";

export type AdaptedProduct = {
  handle: string;
  name: string;
  category: string | null;
  priceUsd: number | null;
  image: string | null;
  sizes: string[];
  colors: string[];
};

export type MiraAdapterResult = {
  source: "brain";
  decision: {
    voice: string;
    route: MiraRoute;
    productHandle: string | null;
    quickReplies: string[];
    intent: string;
  };
  // Real per-shop products surfaced this turn (from the brain's combo). The UI
  // renders these instead of looking a handle up in a hardcoded catalog.
  products: AdaptedProduct[];
  look: { title: string; reasoning: string; pieces: AdaptedProduct[] } | null;
};

function toProduct(p: BrainProduct): AdaptedProduct {
  // BrainProduct (as carried on a combo) is the lean serialized shape: handle,
  // title, category, primaryColor, imageUrl, sizes. Price is resolved by the UI
  // via GET api/product?handle= when it needs the exact number (Stage 3) — we do
  // NOT invent it here.
  const anyP = p as unknown as { priceRange?: { min: number } | null };
  return {
    handle: p.handle,
    name: p.title,
    category: p.category ?? null,
    priceUsd: anyP.priceRange ? Math.round(anyP.priceRange.min / 100) : null,
    image: p.imageUrl ?? null,
    sizes: p.sizes ?? [],
    colors: p.primaryColor ? [p.primaryColor] : [],
  };
}

// Map the brain's post-turn client actions to the single grounded route the UI
// executes. Order matters: the most "committing" action wins.
function routeFromActions(actions: BrainClientAction[], hasCombo: boolean): { route: MiraRoute; handle: string | null } {
  for (const a of actions) {
    switch (a.kind) {
      case "navigate":      return { route: "navigate", handle: a.handle };
      case "lead_browse":   return { route: "navigate", handle: a.handle };
      case "open_tryon":    return { route: "try_on", handle: null };
      case "show_size_recommendation":
      case "collect_fit_for_sizing":  return { route: "size_form", handle: null };
      case "add_to_cart_request":
      case "add_outfit_to_cart":      return { route: "add_to_cart", handle: null };
      case "open_studio":             return { route: "studio", handle: null };
      case "guide_combo_walkthrough": return { route: "look", handle: null };
      default: break;
    }
  }
  return { route: hasCombo ? "look" : "talk_only", handle: null };
}

// The brain doesn't emit quick-reply chips; synthesise sensible ones per route so
// the UI's chip affordance keeps working.
function chipsFor(route: MiraRoute): string[] {
  switch (route) {
    case "navigate":
    case "reco_handle": return ["Size this one", "What goes with it?", "See it on me"];
    case "look":        return ["Add the look", "Swap a piece", "Size me"];
    case "size_form":   return ["Size me", "What's my size?"];
    case "try_on":      return ["See it on me", "Pick a model"];
    case "add_to_cart": return ["Go to checkout", "Complete the look"];
    default:            return ["For an occasion", "Everyday", "Just looking"];
  }
}

export async function runMiraAdapter(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
  acceptLanguage: string | null;
}): Promise<{ result: MiraAdapterResult; setCookie?: string | null }> {
  const chat = await postChat(args);
  const data = chat.ok ? chat.data : null;

  if (!data) {
    return {
      result: {
        source: "brain",
        decision: { voice: "", route: "talk_only", productHandle: null, quickReplies: [], intent: "other" },
        products: [],
        look: null,
      },
      setCookie: chat.setCookie,
    };
  }

  const combo: BrainCombo | undefined = data.combos[0];
  const products = (combo?.products ?? []).map(toProduct);
  const { route, handle } = routeFromActions(data.actions, !!combo);
  const productHandle = handle ?? products[0]?.handle ?? null;
  const look = combo
    ? { title: combo.name, reasoning: combo.reasoning, pieces: products }
    : null;

  return {
    result: {
      source: "brain",
      decision: {
        voice: data.reply,
        route,
        productHandle,
        quickReplies: chipsFor(route),
        intent: "other",
      },
      products,
      look,
    },
    setCookie: chat.setCookie,
  };
}
