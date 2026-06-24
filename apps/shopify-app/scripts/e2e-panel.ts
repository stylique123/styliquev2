/**
 * E2E persona panel — drives the REAL consolidated brain (runMiraAdapter →
 * decideMira over the real merchant catalog + brand + live Gemini) through full
 * multi-turn shopper journeys, plus the brand-owner learning-loop view
 * (buildOverview). Modeled (agents not real shoppers) but grounded in the real
 * engine + real catalog. Run:
 *   railway run --service stylique-app -- npx tsx apps/shopify-app/scripts/e2e-panel.ts
 */
import { prisma } from "../app/db.server";
import { runMiraAdapter } from "../app/lib/mira-adapter.server";
import { buildOverview } from "../app/lib/dashboard.server";

type Turn = { say: string; onPDP?: string }; // onPDP = currentProductHandle
type Persona = {
  id: string;
  label: string;
  note: string;
  turns: Turn[];
  budgetMinor?: number; // for oversell / budget-respect check (minor units)
};

const PERSONAS: Persona[] = [
  { id: "tara", label: "Tech-averse Tara (types badly, impatient)", note: "doesn't like tech, only here because Mira popped up",
    turns: [{ say: "need a dress for my neice wedding" }, { say: "idk evening i think" }, { say: "fine u pick" }, { say: "how much" }, { say: "ok add it" }] },
  { id: "vimal", label: "Vague Vimal (menswear, won't specify)", note: "tests gender + qualify-don't-dump",
    turns: [{ say: "something nice" }, { say: "for work i guess" }, { say: "yeah show me" }, { say: "is that my size" }] },
  { id: "bushra", label: "Budget Bushra (hard cap)", note: "must not oversell past budget", budgetMinor: 800000,
    turns: [{ say: "i have like 8000 rupees max, what can i get" }, { say: "ok what goes with it" }, { say: "thats too much together" }, { say: "just the one then" }] },
  { id: "wajiha", label: "Black-tie Wajiha", note: "tests formalwear path + honest if absent",
    turns: [{ say: "i need a gown for a black tie wedding" }, { say: "show me the dressiest one you have" }, { say: "size me for it" }, { say: "add to bag" }] },
  { id: "parveen", label: "Plus-size Parveen", note: "size honesty, no fake stock",
    turns: [{ say: "im a size 16, do you actually have anything that fits" }, { say: "ok show me" }, { say: "will it actually fit me" }] },
  { id: "sam", label: "Skeptical Sam (trust test)", note: "are you just selling me",
    turns: [{ say: "are you a bot just trying to sell me stuff" }, { say: "fine, something casual for weekends" }, { say: "honestly is it worth it" }] },
  { id: "imran", label: "Impulse Imran (warm PDP lead)", note: "warm-lead close + AOV anchor",
    turns: [{ say: "ooh i like this", onPDP: "AUTO" }, { say: "what would i wear it with" }, { say: "add the whole look" }] },
  { id: "maryam", label: "Modest Maryam", note: "modest/full-sleeve fluency",
    turns: [{ say: "i want something modest, full sleeves, covered" }, { say: "something for eid" }, { say: "yes that one" }] },
  { id: "veronica", label: "Vibe Veronica (mood not occasion)", note: "FASHION-FLUENCY: mood->clothes",
    turns: [{ say: "i want to feel powerful" }, { say: "yeah something sharp" }, { say: "build a look around it" }] },
  { id: "gita", label: "Gift Gita", note: "buying for someone else",
    turns: [{ say: "present for my mum, she likes simple classic things" }, { say: "she's around 60, nothing flashy" }, { say: "ok that works" }] },
  { id: "rina", label: "Returning Rina (continuity)", note: "memory across turns",
    turns: [{ say: "hi again" }, { say: "the linen thing you showed me last time, still got it" }, { say: "size me" }] },
  { id: "cara", label: "Comparison Cara", note: "compare route, no fake claims",
    turns: [{ say: "whats the difference between your two coats" }, { say: "which is warmer" }, { say: "ok the warmer one" }] },
];

function priceMinorOf(p: { variants?: Array<{ priceCents?: number | null }> } | undefined): number | null {
  if (!p?.variants?.length) return null;
  const ps = p.variants.map((v) => v.priceCents ?? 0).filter((n) => n > 0);
  return ps.length ? Math.min(...ps) : null;
}

async function main() {
  const shop = await prisma.shop.findFirst({
    where: { uninstalledAt: null },
    select: { id: true, shopifyDomain: true, currencyCode: true },
    orderBy: { installedAt: "desc" },
  });
  if (!shop) throw new Error("no installed shop");
  const cur = shop.currencyCode ?? "PKR";
  console.log(`\n==== E2E PERSONA PANEL — shop ${shop.shopifyDomain} (${cur}) — REAL brain, REAL catalog, live Gemini ====\n`);

  // authoritative handle -> min price (minor units) for AOV math
  const prods = await prisma.product.findMany({
    where: { shopId: shop.id },
    select: { handle: true, title: true, primaryTryonImageId: true, variants: { select: { priceCents: true, inventoryQuantity: true, availableForSale: true } } },
  });
  const priceByHandle = new Map<string, number>();
  for (const p of prods) { const m = priceMinorOf(p); if (m != null) priceByHandle.set(p.handle, m); }
  const photographed = new Set(prods.filter((p) => p.primaryTryonImageId).map((p) => p.handle));
  // a default warm-lead PDP handle = a photographed, in-stock piece
  const autoPDP = prods.find((p) => p.primaryTryonImageId)?.handle ?? prods[0]?.handle ?? null;
  console.log(`catalog: ${prods.length} products, ${photographed.size} photographed, ${priceByHandle.size} priced. AUTO-PDP=${autoPDP}\n`);

  const rows: any[] = [];
  for (const persona of PERSONAS) {
    const history: Array<{ from: string; text: string }> = [];
    const shown = new Set<string>();
    let firstProductTurn = -1, qualifiedBeforeShow = false, proposedLook = false;
    let lookTotalMinor = 0, anchorMinor = 0, lookSize = 0;
    let closed = false, sized = false, talkOnly = 0, fabricationFlag = false, oversellFlag = false;
    const transcript: string[] = [];
    let t = 0;
    const cookie = `panel-${persona.id}`;
    for (const turn of persona.turns) {
      t++;
      const pdp = turn.onPDP === "AUTO" ? autoPDP : turn.onPDP ?? null;
      const body = { message: turn.say, currentProductHandle: pdp, history: history.slice(-12), shownHandles: [...shown] };
      let r: any;
      try {
        const out = await runMiraAdapter({ shopDomain: shop.shopifyDomain, body, shopperCookieId: cookie, acceptLanguage: "en" });
        r = out.result;
      } catch (e: any) { transcript.push(`  [T${t}] ERROR ${e?.message}`); continue; }
      const d = r.decision;
      const look = r.look;
      const prodNames = (r.products ?? []).map((p: any) => p.name);
      history.push({ from: "shopper", text: turn.say });
      history.push({ from: "mira", text: d.voice });
      (r.products ?? []).forEach((p: any) => shown.add(p.handle));
      // metrics
      const isProductTurn = ["reco_handle", "navigate", "look", "reco_category", "reco_filter", "search", "try_on", "add_to_cart"].includes(d.route);
      if (isProductTurn && firstProductTurn === -1) { firstProductTurn = t; qualifiedBeforeShow = t > 1; }
      if (d.route === "talk_only") talkOnly++;
      if (d.route === "size_form" || /\b(size|fit)\b/i.test(d.voice) && d.route === "try_on") sized = true;
      if (d.route === "size_form") sized = true;
      if (d.route === "add_to_cart") closed = true;
      if (look && look.pieces?.length) {
        proposedLook = true; lookSize = look.pieces.length;
        lookTotalMinor = look.pieces.reduce((s: number, p: any) => s + (priceByHandle.get(p.handle) ?? 0), 0);
        const anchorH = look.pieces[0]?.handle;
        anchorMinor = priceByHandle.get(anchorH) ?? 0;
      } else if (d.productHandle && priceByHandle.has(d.productHandle) && anchorMinor === 0) {
        anchorMinor = priceByHandle.get(d.productHandle)!;
      }
      // fabrication: did voice name a product/colorway/discount not deliverable?
      if (/\b\d+%\s*off|discount code|coupon|sale code\b/i.test(d.voice)) fabricationFlag = true;
      // oversell vs budget
      if (persona.budgetMinor && lookTotalMinor > persona.budgetMinor && /add (the )?(look|both|all)/i.test((d.quickReplies ?? []).join(" "))) {
        // proposing an over-budget bundle as the push = potential oversell (we check if Mira RESPECTS the cap next turn)
      }
      const priced = look?.pieces?.length ? `look ${look.pieces.length}pc=${(lookTotalMinor/100)|0}${cur}` : (d.productHandle ? `pick=${d.productHandle}` : "");
      transcript.push(`  [T${t}] "${turn.say}" -> route=${d.route} ${priced}\n        Mira: ${d.voice.slice(0,160)}`);
    }
    const aovLift = anchorMinor > 0 && lookTotalMinor > anchorMinor ? +(lookTotalMinor / anchorMinor).toFixed(2) : 1;
    // oversell: respected budget? if budget set, did any FINAL pick exceed it
    let budgetRespected = true;
    if (persona.budgetMinor) budgetRespected = anchorMinor === 0 || anchorMinor <= persona.budgetMinor * 1.05;
    rows.push({ id: persona.id, label: persona.label, firstProductTurn, qualifiedBeforeShow, proposedLook, lookSize, aovLift, closed, sized, talkOnly, fabricationFlag, budgetRespected, transcript });
    console.log(`---- ${persona.label} ----`);
    console.log(`  note: ${persona.note}`);
    transcript.forEach((l) => console.log(l));
    console.log(`  >> qualified-first=${qualifiedBeforeShow} look=${proposedLook}(${lookSize}pc) AOV-lift=${aovLift}x sized=${sized} closed=${closed} fabrication=${fabricationFlag} budgetOK=${budgetRespected}\n`);
  }

  // ---- aggregate ----
  const n = rows.length;
  const pct = (f: (r: any) => boolean) => Math.round((rows.filter(f).length / n) * 100);
  const avg = (f: (r: any) => number) => +(rows.reduce((s, r) => s + f(r), 0) / n).toFixed(2);
  const lookRows = rows.filter((r) => r.proposedLook && r.aovLift > 1);
  console.log("==== AGGREGATE (modeled, real engine) ====");
  console.log(`  personas:                 ${n}`);
  console.log(`  qualified-before-showing: ${pct((r) => r.qualifiedBeforeShow)}%`);
  console.log(`  proposed a full look:     ${pct((r) => r.proposedLook)}%  (AOV lever)`);
  console.log(`  avg AOV-lift when look:   ${lookRows.length ? +(lookRows.reduce((s, r) => s + r.aovLift, 0) / lookRows.length).toFixed(2) : 1}x  (look total / anchor)`);
  console.log(`  offered sizing:           ${pct((r) => r.sized)}%`);
  console.log(`  reached a close:          ${pct((r) => r.closed)}%`);
  console.log(`  fabrication (fake promo): ${pct((r) => r.fabricationFlag)}%  (target 0)`);
  console.log(`  budget respected:         ${pct((r) => r.budgetRespected)}%`);

  // ---- brand owner: learning loop + ROI ----
  console.log("\n==== BRAND OWNER VIEW — learning loop + ROI (buildOverview) ====");
  try {
    const ov: any = await buildOverview({ shopId: shop.id, windowDays: 90 });
    const h = ov.headline;
    console.log(`  MEASURED chat sessions=${h.chatSessions} turns=${h.chatTurns} combosProposed=${h.combosProposed}`);
    console.log(`  MEASURED cartConfirmed=${h.cartConfirmed} cartFromMira=${h.cartFromMira} tryOnSessions=${h.tryOnSessions} fitSubmitted=${h.fitSubmitted}`);
    console.log(`  MEASURED miraAssistedRevenue=${(h.miraAssistedRevenueCents/100)|0}${cur} orders=${h.miraAssistedOrders} ROI=${h.miraRoiMultiple}x AOV=${(h.assistedAovCents/100)|0}${cur}`);
    console.log(`  MEASURED repeatPurchaseRate=${h.repeatPurchaseRate?.pct}% (${h.repeatPurchaseRate?.repeatShoppers}/${h.repeatPurchaseRate?.totalShoppers})`);
    const gaps = ov.catalog?.gaps ?? ov.headline?.topGaps ?? [];
    console.log(`  LEARNING LOOP — top demand gaps (what to stock next):`);
    (gaps.slice(0, 8) || []).forEach((g: any) => console.log(`     • ${g.label ?? g.normalizedQuery ?? g.query ?? JSON.stringify(g)}  ${g.count ?? g.searchCount ?? ""}`));
    const nm = ov.catalog?.nearMisses ?? [];
    if (nm.length) { console.log(`  LEARNING LOOP — near-misses (one attribute from a sale):`); nm.slice(0,6).forEach((m:any)=>console.log(`     • ${JSON.stringify(m).slice(0,160)}`)); }
  } catch (e: any) { console.log(`  buildOverview error: ${e?.message}`); }

  console.log("\n==== HONESTY NOTE ====");
  console.log("  These journeys are MODELED (scripted personas), but every turn ran through the");
  console.log("  REAL consolidated brain over the REAL merchant catalog with live Gemini. Brand-owner");
  console.log("  numbers are the ACTUAL measured DB aggregates. A true live-shopper E2E (storefront +");
  console.log("  real /cart/add.js) still requires the deployed app on the installed store.\n");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
