// Hit the LIVE /api/mira with the known reasoning-heavy turns, many times, tally source.
const BASE = "http://localhost:50268";
const CASES = [
  { pdp: "linen-relaxed-shirt", msg: "is this good for me?" },
  { pdp: "pleated-midi-skirt", msg: "would you wear it" },
  { pdp: "cashmere-v-neck", msg: "does this run small?" },
  { pdp: null, msg: "she's a medium usually" },
  { pdp: "linen-relaxed-shirt", msg: "im not sure about the fit and whether the color suits my skin tone, what do you think honestly" },
];
const N = 6;
for (const c of CASES) {
  const tally = { gemini: 0, fallback: 0, error: 0 };
  const routes = [];
  for (let i = 0; i < N; i++) {
    try {
      const res = await fetch(`${BASE}/api/mira`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: c.msg, currentProductHandle: c.pdp || undefined, history: [] }),
      });
      const d = await res.json();
      tally[d.source] = (tally[d.source] || 0) + 1;
      routes.push(d.decision?.route || "-");
    } catch (e) { tally.error++; routes.push("ERR"); }
  }
  console.log(`"${c.msg.slice(0,42)}" [${c.pdp||"landing"}]  gemini ${tally.gemini}/${N} fallback ${tally.fallback}/${N}  routes=${routes.join(",")}`);
}
