// Audits the most recent 100-pilot run. Per conversation:
//   - Score each salesperson behavior the founder named (proactive ask, try-on,
//     sizing, occasion handling, intent guidance, close).
//   - Score whether Mira acted like a CHATBOT (passive) or a SALESPERSON
//     (proactive). The signal is concrete: did she END EVERY TURN with either
//     a confident proposal OR a sharp qualifier, or did she trail off?
//   - Group failures by route + persona archetype so the fix list is targeted.
// Then a CRM/flow consistency pass: ensure routes the model returns are
// consistent with what the dashboard consumes (no orphan routes, no missing
// downstream events).
//
// Run: node apps/web/scripts/pilot-mira-100-audit.mjs [<run-dir>]

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = resolve(__dirname, "pilot-mira-runs");

const dirs = readdirSync(RUNS_DIR).filter((d) => statSync(resolve(RUNS_DIR, d)).isDirectory()).sort();
const latest = process.argv[2] ?? dirs[dirs.length - 1];
const dir = resolve(RUNS_DIR, latest);
console.log(`Auditing: ${dir}\n`);

const summary = JSON.parse(readFileSync(resolve(dir, "summary.json"), "utf-8"));
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "summary.json");
const convos = files.map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf-8")));

// ── PER-CONVERSATION SALESPERSON SCORECARD ──────────────────────────────────
function scoreConvo(c) {
  const t = c.turns ?? [];
  if (t.length === 0) return null;
  const surface = (x) => [x.mira_voice ?? "", ...(x.mira_chips ?? [])].join(" ");

  // 1. PROACTIVE: did Mira lead on the FIRST turn? (ask 1 sharp question or take a confident POV — not chatbot small talk)
  const t0voice = t[0]?.mira_voice ?? "";
  const proactiveRoutes = new Set(["reco_category", "reco_handle", "reco_filter", "navigate", "look", "fit", "size_form", "try_on", "add_to_cart"]);
  const proactive =
    t[0]?.mira_route !== "fallback" &&
    (
      proactiveRoutes.has(t[0]?.mira_route) ||
      // Ended with a question that's NOT a generic "how can I help"
      (/[?]\s*$/.test(t0voice) && !/how can i help|what.*shopping.+today/i.test(t0voice)) ||
      // OR led with a concrete POV (named the product + a recommendation)
      /\b(your\s+(M|S|L|XS|XL)|i\W?d (put|pull|reach)|the (one|move|pick)|this is the one|let me|i'?ll add)/i.test(t0voice)
    );

  // 2. TRY-ON OFFER: at some point in the conversation, Mira invited try-on
  const offeredTryOn = t.some((x) => x.mira_route === "try_on" || /see it on you|fitting room|try.?on/i.test(surface(x)));

  // 3. SIZING OFFER: at some point, Mira offered to size or said a specific size
  const offeredSize = t.some((x) =>
    x.mira_route === "fit" || x.mira_route === "size_form" ||
    /\byou'?re (an? )?(XS|S|M|L|XL|XXL)|your size is|my size|size you|in the (XS|S|M|L|XL|XXL)\b/i.test(surface(x))
  );

  // 4. CLOSE: at some point, Mira explicitly proposed adding to bag / checkout
  const closed = t.some((x) =>
    x.mira_route === "add_to_cart" ||
    /\b(in the bag|add (it|that|the|all|both)?.*bag|locked in|checkout|let'?s do it|done.*want me to add)\b/i.test(surface(x))
  );

  // 5. LOOK BUILT: at some point, Mira proposed the look / multiple pieces
  const builtLook = t.some((x) =>
    x.mira_route === "look" ||
    /\b(build|complete|full)\b.{0,12}\b(look|outfit)\b|\b(the (knit|trouser|trench|jacket|coat) too|all three|two pieces|both)\b/i.test(surface(x))
  );

  // 6. OCCASION ACK: when the persona named an occasion, did Mira anchor on it
  const occasionMentioned = t.some((x) => /\b(wedding|funeral|graduation|date|dinner|interview|office|yacht|beach)\b/i.test(x.shopper_said ?? ""));
  const occasionAcked = occasionMentioned && t.some((x) =>
    /\b(for (?:a |the |that )?(wedding|funeral|graduation|date|dinner|interview|office|yacht|beach)|wedding|funeral|graduation|board meeting|client dinner|vow renewal)\b/i.test(x.mira_voice ?? "")
  );

  // 7. OBJECTION HANDLED: persona raised a price/policy/ethics objection → Mira responded with acknowledgement, not deflection
  const objection = t.some((x) => /\b(too expensive|cheaper|why so much|return|policy|ethical|sourced|trust|fake|chatbot|overpriced)\b/i.test(x.shopper_said ?? ""));
  const acknowledged = objection && t.some((x) =>
    /\b(i hear you|i get (that|it)|honestly|the truth|fair (point|question)|that'?s fair|you'?re right to ask)\b/i.test(x.mira_voice ?? "")
  );

  // 8. NEVER TRAILED OFF: every turn ended with a question OR a concrete action OR a chip set
  const everyTurnHasNext = t.every((x) =>
    x.fell_to_fallback ||
    /[?]\s*$/.test((x.mira_voice ?? "").trim()) ||
    (x.mira_chips?.length ?? 0) > 0 ||
    x.mira_route === "add_to_cart" || x.mira_route === "try_on" || x.mira_route === "navigate"
  );

  // 9. FABRICATION: invented a discount or a non-existent product
  const fabricated = t.some((x) => /\d{1,2}\s*%\s*off|discount code|promo:?\s*[A-Z]/i.test(x.mira_voice ?? "") && !/no.+(discount|promo|code)/i.test(x.mira_voice ?? ""));

  // 10. FALLBACK RATE
  const fallbackPct = Math.round((t.filter((x) => x.fell_to_fallback).length / t.length) * 100);
  const resilientFallbackPct = Math.round((t.filter((x) => x.mira_source === "fallback" && !x.fell_to_fallback).length / t.length) * 100);

  // OVERALL CHATBOT-VS-SALESPERSON SCORE (0-10)
  let score = 0;
  if (proactive) score += 2;
  if (offeredTryOn) score += 1;
  if (offeredSize) score += 1;
  if (closed) score += 2;
  if (builtLook) score += 1;
  if (occasionAcked || !occasionMentioned) score += 1;
  if (acknowledged || !objection) score += 1;
  if (everyTurnHasNext) score += 1;
  if (!fabricated) score += 1;
  if (fallbackPct === 0) score += 1;
  score = Math.min(10, score);

  return {
    id: c.persona_id,
    region: c.region,
    archetype: c.archetype,
    style: c.style,
    proactive,
    offeredTryOn,
    offeredSize,
    closed,
    builtLook,
    occasionMentioned,
    occasionAcked,
    objection,
    acknowledged,
    everyTurnHasNext,
    fabricated,
    fallbackPct,
    resilientFallbackPct,
    score,
  };
}

const scores = convos.map(scoreConvo).filter(Boolean);

// ── AGGREGATE ───────────────────────────────────────────────────────────────
const n = scores.length;
const pct = (yes) => `${yes}/${n} (${Math.round((yes / n) * 100)}%)`;
const avgScore = (scores.reduce((s, x) => s + x.score, 0) / n).toFixed(1);
const occasionEligible = scores.filter((x) => x.occasionMentioned);

console.log("═══════════════════ SALESPERSON SCORECARD ═══════════════════");
console.log(`Personas               : ${n}`);
console.log(`Avg salesperson score  : ${avgScore} / 10  (10 = real floor associate)`);
console.log(`Proactive on turn 1    : ${pct(scores.filter((x) => x.proactive).length)}`);
console.log(`Offered try-on         : ${pct(scores.filter((x) => x.offeredTryOn).length)}`);
console.log(`Offered/said a size    : ${pct(scores.filter((x) => x.offeredSize).length)}`);
console.log(`Closed (add-to-bag)    : ${pct(scores.filter((x) => x.closed).length)}`);
console.log(`Built complete look    : ${pct(scores.filter((x) => x.builtLook).length)}`);
console.log(
  `Acked stated occasion  : ${occasionEligible.filter((x) => x.occasionAcked).length}/${occasionEligible.length} ` +
  `(${occasionEligible.length ? Math.round((occasionEligible.filter((x) => x.occasionAcked).length / occasionEligible.length) * 100) : 100}%)`,
);
console.log(`Acknowledged objection : ${pct(scores.filter((x) => x.acknowledged || !x.objection).length)}`);
console.log(`Every turn had a next  : ${pct(scores.filter((x) => x.everyTurnHasNext).length)}`);
console.log(`Fabricated promo/code  : ${pct(scores.filter((x) => x.fabricated).length)} ← target 0`);
console.log(`Zero fallback in convo : ${pct(scores.filter((x) => x.fallbackPct === 0).length)}`);
console.log(`No model degradation   : ${pct(scores.filter((x) => x.resilientFallbackPct === 0).length)}`);

// ── CHATBOT-VS-SALESPERSON BREAKDOWN ────────────────────────────────────────
const real = scores.filter((s) => s.score >= 8).length;
const passing = scores.filter((s) => s.score >= 6 && s.score < 8).length;
const chatbot = scores.filter((s) => s.score < 6).length;
console.log(`\nReads as floor associate (≥8): ${pct(real)}`);
console.log(`Passing but inconsistent (6-7): ${pct(passing)}`);
console.log(`Reads as chatbot (<6)          : ${pct(chatbot)}`);

// ── WORST CONVERSATIONS ──────────────────────────────────────────────────────
console.log("\n═══════════════════ WORST 10 CONVERSATIONS ═══════════════════");
const sorted = [...scores].sort((a, b) => a.score - b.score).slice(0, 10);
for (const s of sorted) {
  const fail = [];
  if (!s.proactive) fail.push("not_proactive");
  if (!s.offeredTryOn) fail.push("no_tryon_offer");
  if (!s.offeredSize) fail.push("no_size_offer");
  if (!s.closed) fail.push("no_close");
  if (!s.builtLook) fail.push("no_look");
  if (s.objection && !s.acknowledged) fail.push("objection_unhandled");
  if (!s.everyTurnHasNext) fail.push("trailed_off");
  if (s.fabricated) fail.push("FABRICATED");
  if (s.fallbackPct > 0) fail.push(`fb${s.fallbackPct}%`);
  console.log(`  ${String(s.score).padStart(2)}/10  ${s.id.padEnd(15)}  ${s.region.padEnd(22)}  ${s.archetype.slice(0, 40).padEnd(40)}  → ${fail.join(", ") || "ok"}`);
}

// ── FAILURE-MODE CLUSTERS ───────────────────────────────────────────────────
console.log("\n═══════════════════ FAILURE CLUSTERS BY ARCHETYPE STYLE ═══════════════════");
const byStyle = {};
for (const s of scores) {
  if (!byStyle[s.style]) byStyle[s.style] = { total: 0, sum: 0 };
  byStyle[s.style].total++;
  byStyle[s.style].sum += s.score;
}
const styleEntries = Object.entries(byStyle).sort((a, b) => a[1].sum / a[1].total - b[1].sum / b[1].total);
for (const [style, v] of styleEntries.slice(0, 12)) {
  console.log(`  ${(v.sum / v.total).toFixed(1).padStart(4)} avg  ${style.padEnd(28)}  (${v.total} personas)`);
}

// ── CRM / FLOW CONSISTENCY ──────────────────────────────────────────────────
console.log("\n═══════════════════ CRM / FLOW CONSISTENCY ═══════════════════");

// Route consistency — every route the model returned must be in the canonical list
const CANONICAL_ROUTES = new Set([
  "reco_category", "reco_handle", "reco_filter", "navigate", "look", "fit", "fabric",
  "suitability", "size_form", "try_on", "returns", "add_to_cart", "studio", "search", "talk_only",
  "fallback", "transport_error",
]);
const seenRoutes = new Map();
for (const c of convos) for (const t of c.turns ?? []) {
  seenRoutes.set(t.mira_route, (seenRoutes.get(t.mira_route) ?? 0) + 1);
}
const orphan = [...seenRoutes].filter(([r]) => !CANONICAL_ROUTES.has(r));
console.log(`Routes observed        : ${[...seenRoutes].map(([r, n]) => `${r}:${n}`).join("  ")}`);
console.log(`Orphan routes (off-spec): ${orphan.length === 0 ? "(none)" : orphan.map(([r, n]) => `${r}:${n}`).join("  ")}`);

// HandleConsistency — when route is reco_handle/navigate/look/try_on/add_to_cart, productHandle should be present
let routeHandleMismatch = 0;
const HANDLE_REQUIRED = new Set(["reco_handle", "navigate", "look", "try_on", "add_to_cart", "fit", "size_form"]);
for (const c of convos) for (const t of c.turns ?? []) {
  if (HANDLE_REQUIRED.has(t.mira_route) && !t.mira_handle) routeHandleMismatch++;
}
console.log(`Route requires handle but missing : ${routeHandleMismatch} turns`);

// Voice non-empty when route isn't fallback
let routeVoiceMismatch = 0;
for (const c of convos) for (const t of c.turns ?? []) {
  if (t.mira_route !== "fallback" && t.mira_route !== "transport_error" && (!t.mira_voice || t.mira_voice.length === 0)) routeVoiceMismatch++;
}
console.log(`Non-fallback route with empty voice: ${routeVoiceMismatch} turns`);

// Chips present on talk_only (every interrogative turn should give the shopper one-tap answers)
let chipsMissing = 0;
for (const c of convos) for (const t of c.turns ?? []) {
  if (t.mira_route === "talk_only" && (!t.mira_chips || t.mira_chips.length === 0)) chipsMissing++;
}
console.log(`talk_only without chips           : ${chipsMissing} turns`);

// Repeated voice in same conversation
let repeats = 0;
for (const c of convos) {
  const t = c.turns ?? [];
  for (let i = 1; i < t.length; i++) if (t[i].mira_voice && t[i].mira_voice === t[i - 1].mira_voice) repeats++;
}
console.log(`Identical consecutive voices      : ${repeats} occurrences`);

// ── ONE-LINE VERDICT ─────────────────────────────────────────────────────────
console.log("\n═══════════════════ VERDICT ═══════════════════");
const verdict =
  avgScore >= 8 ? "Mira reads as a floor associate."
  : avgScore >= 6.5 ? "Mira is passing but inconsistent — closes some, describes others."
  : avgScore >= 5 ? "Mira reads as a smart chatbot, not a salesperson — describes, rarely closes."
  : "Mira is broken — too many fallbacks + missed proactive moves.";
console.log(`Avg ${avgScore}/10 — ${verdict}`);

const out = {
  ran_at: latest,
  endpoint: summary.endpoint,
  avg_score: Number(avgScore),
  rates: {
    proactive: scores.filter((x) => x.proactive).length / n,
    tryon: scores.filter((x) => x.offeredTryOn).length / n,
    sizing: scores.filter((x) => x.offeredSize).length / n,
    closed: scores.filter((x) => x.closed).length / n,
    look: scores.filter((x) => x.builtLook).length / n,
    occasion_acked: scores.filter((x) => x.occasionAcked || !x.objection).length / n,
    objection_acked: scores.filter((x) => x.acknowledged || !x.objection).length / n,
    every_turn_next: scores.filter((x) => x.everyTurnHasNext).length / n,
    fabricated: scores.filter((x) => x.fabricated).length / n,
    zero_fallback: scores.filter((x) => x.fallbackPct === 0).length / n,
  },
  worst_10: sorted.map((s) => ({ id: s.id, score: s.score, region: s.region, archetype: s.archetype })),
  crm: {
    orphan_routes: orphan.map(([r, n]) => ({ route: r, count: n })),
    route_requires_handle_missing: routeHandleMismatch,
    non_fallback_empty_voice: routeVoiceMismatch,
    talk_only_no_chips: chipsMissing,
    identical_consecutive_voices: repeats,
  },
  verdict,
};
writeFileSync(resolve(dir, "audit.json"), JSON.stringify(out, null, 2));
console.log(`\nAudit JSON: ${dir}/audit.json`);
