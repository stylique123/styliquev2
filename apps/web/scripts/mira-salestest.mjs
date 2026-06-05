// Mira sales-funnel stress test + learning-loop push.
//   node apps/web/scripts/mira-salestest.mjs [port]
// Runs multi-turn shopper journeys through the 10-stage funnel, scores funnel
// adherence + grounding, then reads /api/mira/insights to show what the
// learning loop captured. Each scenario carries history forward turn-to-turn.

const PORT = process.argv[2] || "3000";
const BASE = `http://localhost:${PORT}`;

const HANDLES = new Set([
  "onyx-silk-slip","ivory-silk-camisole","atelier-wide-leg-trouser","linen-relaxed-shirt",
  "wrap-coat-camel","cashmere-v-neck","midnight-silk-gown","tailored-blazer-double",
  "pleated-midi-skirt","merino-ribbed-turtleneck","leather-trench","wide-leg-denim",
]);

const DEMAND = new Set(["discover","occasion","specific","price","look","try_on","suitability"]);

async function turn({ message, history, currentProductHandle, knownSize, shownHandles }) {
  const t0 = Date.now();
  let res, json;
  try {
    res = await fetch(`${BASE}/api/mira`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, currentProductHandle, knownSize, shownHandles }),
    });
    json = await res.json();
  } catch (e) {
    return { ok: false, err: String(e), ms: Date.now() - t0 };
  }
  // API shape is { source, decision:{...} }. Unwrap to the decision and keep `source`
  // so fallback detection is exact (source === "fallback") instead of heuristic.
  const decision = json && json.decision ? { ...json.decision, source: json.source } : json;
  return { ok: true, status: res.status, d: decision, ms: Date.now() - t0 };
}

// Each scenario = ordered turns. `expect` = soft assertions for funnel adherence.
const SCENARIOS = [
  { name: "Wedding-guest journey (discover→present→size→try→close)", pdp: null, turns: [
    { msg: "hi", expectRoute: ["talk_only"], expectIntent: ["greeting"] },
    { msg: "I've got an evening wedding next month and nothing to wear", expectRoute: ["navigate","reco_category","reco_handle","look"], wantNav: true, wantHandle: true },
    { msg: "is it too much for a guest?", expectRoute: ["suitability","talk_only","reco_filter"] },
    { msg: "ok what size am I, I'm usually a medium", expectRoute: ["size_form","fit","suitability"] },
    { msg: "can I see it on me?", expectRoute: ["try_on"], wantTryOn: true },
    { msg: "I'll take it", expectRoute: ["add_to_cart"] },
  ]},
  { name: "Objection + complete-the-look (price→reframe→look→addall)", pdp: "wrap-coat-camel", turns: [
    { msg: "this coat is gorgeous but pricey", expectRoute: ["suitability","talk_only","reco_filter","fabric"] },
    { msg: "what would I wear it with?", expectRoute: ["look"], wantLook: true },
    { msg: "love it, size me for the coat", expectRoute: ["size_form","fit"] },
    { msg: "add the whole look", expectRoute: ["add_to_cart","look"] },
  ]},
  { name: "Per-product re-size memory (size one piece, then another)", pdp: "linen-relaxed-shirt", turns: [
    { msg: "size this exact shirt for me", expectRoute: ["size_form","fit"] },
    { msg: "now I want the wide-leg trouser too", currentProductHandle: "atelier-wide-leg-trouser", expectRoute: ["size_form","navigate","reco_handle","fit"] },
  ]},
  { name: "Known-size recall → straight to close", pdp: "cashmere-v-neck", knownSize: "M", turns: [
    { msg: "should I get this?", expectRoute: ["suitability","add_to_cart","try_on","talk_only"] },
  ]},
  { name: "Fabric + fit deep-dive", pdp: "merino-ribbed-turtleneck", turns: [
    { msg: "is this itchy? what's it made of", expectRoute: ["fabric"] },
    { msg: "does it run small?", expectRoute: ["fit","size_form"] },
  ]},
  // ── Learning-loop pushers — real gaps + near-misses ──
  { name: "GAP footwear", pdp: null, turns: [
    { msg: "do you have any heels to go with a gown?", expectGap: "footwear" },
  ]},
  { name: "GAP price floor", pdp: null, turns: [
    { msg: "anything under $90?", expectGap: "price" },
  ]},
  { name: "GAP bags", pdp: null, turns: [
    { msg: "I need a clutch or a bag for the evening", expectGap: "bag" },
  ]},
  { name: "GAP activewear", pdp: null, turns: [
    { msg: "got any gym leggings or a sports bra?", expectGap: "active" },
  ]},
  { name: "NEAR-MISS cropped", pdp: "linen-relaxed-shirt", turns: [
    { msg: "do you have this shirt but cropped?", expectNearMiss: true },
  ]},
  { name: "NEAR-MISS petite sizing", pdp: "atelier-wide-leg-trouser", turns: [
    { msg: "these are great but do they come in petite / shorter inseam?", expectNearMiss: true },
  ]},
  { name: "CONVERSION add_to_cart", pdp: "onyx-silk-slip", turns: [
    { msg: "perfect, add it to my bag", expectRoute: ["add_to_cart"] },
  ]},
];

function fmt(d) {
  if (!d) return "(none)";
  const bits = [`route=${d.route}`, `intent=${d.intent ?? "-"}`];
  if (d.productHandle) bits.push(`handle=${d.productHandle}`);
  if (d.filter) bits.push(`filter=${d.filter}`);
  if (d.unmet) bits.push(`UNMET[${d.unmetCategory}]`);
  if (d.nearMiss) bits.push(`NEARMISS[${d.nearMissCategory}/${d.nearMissAttribute}]`);
  return bits.join(" ");
}

const agg = {
  turns: 0, gemini: 0, fallback: 0, askedBack: 0, navigated: 0, navWhenAsked: 0, navAskedTotal: 0,
  recommended: 0, sizedNotGuessed: 0, gapsFlagged: 0, gapsExpected: 0, nearMissFlagged: 0, nearMissExpected: 0,
  routeHit: 0, routeChecked: 0, hallucinated: 0, lat: [],
};

function looksFallback(d) {
  // Exact: the API tags every response with source ("gemini" | "fallback").
  // Heuristic backup: the regex fallback never sets `intent`.
  if (d && d.source) return d.source !== "gemini";
  return !d || d.intent === undefined || d.intent === null;
}
function isAsk(voice) {
  if (!voice) return false;
  const q = voice.trim().endsWith("?");
  const asky = /how can i help|what can i (do|help)|how may i/i.test(voice);
  return q || asky;
}

console.log(`\n=== MIRA SALES-FUNNEL STRESS TEST @ ${BASE} ===\n`);

for (const sc of SCENARIOS) {
  console.log(`\n▸ ${sc.name}`);
  const history = [];
  let curPdp = sc.pdp ?? null;
  for (const step of sc.turns) {
    const cph = step.currentProductHandle ?? curPdp;
    const r = await turn({
      message: step.msg, history,
      currentProductHandle: cph,
      knownSize: sc.knownSize ?? null,
      shownHandles: [],
    });
    agg.turns++;
    if (!r.ok) { console.log(`   ✗ "${step.msg}" → ERROR ${r.err}`); continue; }
    agg.lat.push(r.ms);
    const d = r.d;
    const fb = looksFallback(d);
    if (fb) agg.fallback++; else agg.gemini++;
    if (isAsk(d?.voice)) agg.askedBack++;
    if (d?.route === "navigate") agg.navigated++;
    if (d?.productHandle && (d.route === "reco_handle" || d.route === "reco_category" || d.route === "look" || d.route === "search")) agg.recommended++;
    if (d?.productHandle && !HANDLES.has(d.productHandle)) agg.hallucinated++;

    if (step.wantNav) { agg.navAskedTotal++; if (d?.route === "navigate") agg.navWhenAsked++; }
    if (step.wantHandle && d?.productHandle && HANDLES.has(d.productHandle)) {/* ok */}
    if (step.expectRoute) { agg.routeChecked++; if (step.expectRoute.includes(d?.route)) agg.routeHit++; }
    if (step.expectGap) { agg.gapsExpected++; if (d?.unmet) agg.gapsFlagged++; }
    if (step.expectNearMiss) { agg.nearMissExpected++; if (d?.nearMiss) agg.nearMissFlagged++; }
    // sizing honesty: a size_form/fit turn must NOT assert a size that wasn't given
    if (d?.route === "size_form") agg.sizedNotGuessed++;

    const flags = [];
    if (fb) flags.push("FALLBACK");
    if (step.expectRoute && !step.expectRoute.includes(d?.route)) flags.push(`route✗(want ${step.expectRoute.join("|")})`);
    if (step.wantNav && d?.route !== "navigate") flags.push("noNav✗");
    if (step.wantTryOn && d?.route !== "try_on") flags.push("noTryOn✗");
    if (step.wantLook && d?.route !== "look") flags.push("noLook✗");
    if (step.expectGap && !d?.unmet) flags.push("gapMissed✗");
    if (step.expectNearMiss && !d?.nearMiss) flags.push("nearMissMissed✗");
    if (d?.productHandle && !HANDLES.has(d.productHandle)) flags.push("HALLUCINATED✗");
    console.log(`   "${step.msg}"\n      → ${fmt(d)} ${r.ms}ms ${flags.length ? "  ⚠ " + flags.join(", ") : "✓"}`);

    history.push({ from: "user", text: step.msg });
    history.push({ from: "mira", text: d?.voice ?? "" });
    if (d?.productHandle && HANDLES.has(d.productHandle)) curPdp = d.productHandle;
  }
}

const avg = agg.lat.length ? Math.round(agg.lat.reduce((a,b)=>a+b,0)/agg.lat.length) : 0;
const p95 = agg.lat.length ? agg.lat.slice().sort((a,b)=>a-b)[Math.floor(agg.lat.length*0.95)] : 0;
console.log(`\n\n=== RESULTS ===`);
console.log(`turns                 ${agg.turns}`);
console.log(`gemini / fallback     ${agg.gemini} / ${agg.fallback}  (${Math.round(agg.gemini/agg.turns*100)}% gemini)`);
console.log(`route match           ${agg.routeHit}/${agg.routeChecked}  (${agg.routeChecked?Math.round(agg.routeHit/agg.routeChecked*100):0}%)`);
console.log(`navigate-when-asked   ${agg.navWhenAsked}/${agg.navAskedTotal}`);
console.log(`asked-back (any turn) ${agg.askedBack}/${agg.turns}  (${Math.round(agg.askedBack/agg.turns*100)}%)`);
console.log(`recommended a product ${agg.recommended} turns`);
console.log(`hallucinated handle   ${agg.hallucinated}  (must be 0)`);
console.log(`gaps flagged          ${agg.gapsFlagged}/${agg.gapsExpected}`);
console.log(`near-miss flagged     ${agg.nearMissFlagged}/${agg.nearMissExpected}`);
console.log(`latency avg / p95     ${avg}ms / ${p95}ms`);

// ── Learning loop ──
console.log(`\n=== LEARNING LOOP (/api/mira/insights) ===`);
try {
  const ir = await fetch(`${BASE}/api/mira/insights`);
  const ins = await ir.json();
  const o = ins.insights ?? ins;
  console.log(`conversations learned ${o.totalConversations}`);
  console.log(`discovery hit-rate    ${o.discoveryHitRate}`);
  console.log(`surfaced / converted  ${o.surfacedCount ?? "-"} / ${o.convertedCount ?? "-"}  rate ${o.conversionRate ?? "-"}`);
  console.log(`unmet count           ${o.unmetCount}`);
  console.log(`\ncatalog gaps (ranked by demand intensity):`);
  (o.catalogGaps ?? []).slice(0, 8).forEach((g, i) =>
    console.log(`  ${i+1}. ${g.category}  ×${g.count}  intensity=${(g.intensity ?? 0).toFixed?.(2) ?? g.intensity}  e.g. "${(g.examples||[])[0] ?? ""}"`));
  console.log(`\nnear-misses (one attribute from a sale):`);
  (o.nearMisses ?? []).slice(0, 6).forEach((g, i) =>
    console.log(`  ${i+1}. ${g.category} → missing "${g.attribute}"  ×${g.count}  e.g. "${(g.examples||[])[0] ?? ""}"`));
  console.log(`\ntop intents:`);
  (o.topIntents ?? []).slice(0, 8).forEach((t) => console.log(`  ${t.intent}: ${t.count}`));
} catch (e) {
  console.log(`insights fetch failed: ${e}`);
}
console.log(`\n=== DONE ===\n`);
