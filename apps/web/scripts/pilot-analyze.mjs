// Reads the most recent pilot-mira-runs/* dir and prints a focused failure
// analysis: per-persona breakdown, top fallback offenders, repeat offenders,
// transport errors, hostile-probe behaviour, and the actual voice lines that
// tripped each heuristic. This is the artefact we act on.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = resolve(__dirname, "pilot-mira-runs");

const runs = readdirSync(RUNS_DIR).filter((d) => statSync(resolve(RUNS_DIR, d)).isDirectory()).sort();
const latest = process.argv[2] ?? runs[runs.length - 1];
const dir = resolve(RUNS_DIR, latest);
console.log(`Reading: ${dir}\n`);

const summary = JSON.parse(readFileSync(resolve(dir, "summary.json"), "utf-8"));
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "summary.json");
const convos = files.map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf-8")));

console.log("══════════ HEADLINE NUMBERS ══════════");
console.log(`Personas       : ${summary.personas}`);
console.log(`Total turns    : ${summary.total_turns}`);
console.log(`Avg latency    : ${summary.avg_latency_ms}ms ${summary.avg_latency_ms > 6000 ? "  ← SLOW (>6s)" : ""}`);
console.log(`Closed         : ${summary.closed_count}/${summary.personas} (${summary.closed_pct}%) ${summary.closed_pct < 40 ? "  ← LOW" : ""}`);
console.log(`Qualified-first: ${summary.qualified_before_show_count}/${summary.personas}`);
console.log(`Fallback turns : ${summary.fallback_turns}/${summary.total_turns} (${summary.fallback_pct}%) ${summary.fallback_pct > 5 ? "  ← HIGH (target < 5%)" : ""}`);
console.log(`Repetitive     : ${summary.asked_repeatedly_count}`);
console.log(`Transport errs : ${summary.transport_errors}`);
console.log(`Invented       : ${summary.invented_anything_count}`);
console.log(`Routes         : ${JSON.stringify(summary.routes)}`);

console.log("\n══════════ FALLBACK OFFENDERS (Gemini failed → regex) ══════════");
const fallbackOffenders = convos
  .filter((c) => (c.fall_to_fallback_count ?? 0) >= 1)
  .sort((a, b) => (b.fall_to_fallback_count ?? 0) - (a.fall_to_fallback_count ?? 0));
for (const c of fallbackOffenders) {
  console.log(`\n• ${c.persona_id} (${c.archetype}) — fallback ${c.fall_to_fallback_count}/${c.turns.length}`);
  for (const t of c.turns.filter((x) => x.fell_to_fallback)) {
    const err = t.transport_error || t.parse_error || `http_${t.http_status}`;
    console.log(`   turn ${t.i}: "${t.shopper_said.slice(0, 70)}"  →  fallback (${err}, ${t.latency_ms}ms)`);
  }
}

console.log("\n══════════ TRANSPORT ERRORS / 5xx ══════════");
const errs = convos.flatMap((c) => (c.turns ?? []).filter((t) => t.transport_error || t.http_status >= 500).map((t) => ({ persona: c.persona_id, turn: t.i, status: t.http_status, err: t.transport_error, lat: t.latency_ms })));
if (errs.length === 0) console.log("(none)");
for (const e of errs) console.log(`  ${e.persona} turn ${e.turn}: status=${e.status} err=${e.err || "—"} latency=${e.lat}ms`);

console.log("\n══════════ REPETITIVE-VOICE OFFENDERS ══════════");
const repeats = convos.filter((c) => c.asked_repeatedly);
for (const c of repeats) {
  console.log(`\n• ${c.persona_id} (${c.archetype})`);
  for (let i = 1; i < c.turns.length; i++) {
    if (c.turns[i].mira_voice && c.turns[i].mira_voice === c.turns[i - 1].mira_voice) {
      console.log(`   identical reply on turn ${i}: "${c.turns[i].mira_voice.slice(0, 110)}"`);
    }
  }
}

console.log("\n══════════ DIDN'T QUALIFY BEFORE SHOWING ══════════");
for (const c of convos.filter((c) => c.qualified_before_show === false)) {
  const t0 = c.turns[0];
  if (t0?.fell_to_fallback) continue; // not the bug; just a fallback
  console.log(`  ${c.persona_id} — opener "${t0.shopper_said.slice(0, 50)}"  →  route=${t0.mira_route} voice="${(t0.mira_voice || "").slice(0, 80)}"`);
}

console.log("\n══════════ NEVER CLOSED ══════════");
for (const c of convos.filter((c) => !c.closed)) {
  const lastT = c.turns[c.turns.length - 1];
  console.log(`  ${c.persona_id} (${c.archetype}) — ended on route=${lastT.mira_route} voice="${(lastT.mira_voice || "").slice(0, 70)}"`);
}

console.log("\n══════════ HOSTILE / PROMPT-INJECTION PROBE ══════════");
const hostile = convos.find((c) => c.persona_id === "hostile-1");
if (hostile) {
  for (const t of hostile.turns) {
    console.log(`  turn ${t.i}: SAID "${t.shopper_said}"  →  VOICE "${(t.mira_voice || "").slice(0, 200)}"`);
  }
}

console.log("\n══════════ LATENCY OUTLIERS (>14s) ══════════");
const slow = convos.flatMap((c) => (c.turns ?? []).filter((t) => t.latency_ms > 14_000).map((t) => ({ persona: c.persona_id, turn: t.i, lat: t.latency_ms })));
for (const s of slow) console.log(`  ${s.persona} turn ${s.turn}: ${s.lat}ms`);

console.log("\n══════════ ALL CONVERSATIONS (one line each) ══════════");
for (const c of convos.sort((a, b) => a.persona_id.localeCompare(b.persona_id))) {
  const sym = c.closed ? "✓" : "✗";
  const fb = c.fall_to_fallback_count > 0 ? `fb=${c.fall_to_fallback_count}` : "";
  const rep = c.asked_repeatedly ? "REP" : "";
  const inv = c.invented_anything ? "INV" : "";
  console.log(`  ${sym} ${c.persona_id.padEnd(22)} ${c.archetype.padEnd(36)} ${fb.padStart(4)} ${rep.padStart(3)} ${inv.padStart(3)}`);
}
