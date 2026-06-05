// Try-on cache pre-warm driver (P1a).
//
// Walks the /api/tryon/prewarm route in slices until the full job list is warmed.
// Each POST renders a small batch (default 6) so no single request times out; the
// route returns nextOffset and we keep going until done.
//
// Run (dev server must be up):  node apps/web/scripts/prewarm-tryon.mjs [port] [limit]
//   port  — dev server port (default 3001)
//   limit — renders per slice (default 6, max 20)
//
// If MIRA_ADMIN_SECRET is set on the server, export it here too so the route
// authorizes the request:  MIRA_ADMIN_SECRET=... node apps/web/scripts/prewarm-tryon.mjs

const PORT = process.argv[2] || "3001";
const LIMIT = Math.min(20, Math.max(1, parseInt(process.argv[3] || "6", 10)));
const BASE = `http://localhost:${PORT}`;
const SECRET = process.env.MIRA_ADMIN_SECRET;

const headers = { "Content-Type": "application/json" };
if (SECRET) headers["x-mira-admin"] = SECRET;

async function main() {
  // Plan size first.
  const planRes = await fetch(`${BASE}/api/tryon/prewarm`, { headers });
  if (!planRes.ok) {
    console.error(`✗ plan request failed (${planRes.status}). Is the dev server on :${PORT}? Admin secret set?`);
    process.exit(1);
  }
  const plan = await planRes.json();
  console.log(`Pre-warming ${plan.total} muse renders  (${plan.muses} muses × ${plan.products} products + ±1 on ${plan.topProducts} top pieces)`);
  console.log(`Body: ${plan.body.heightCm}cm / ${plan.body.weightKg}kg · slice size ${LIMIT}\n`);

  let offset = 0;
  let warmed = 0;
  let cached = 0;
  let errors = 0;
  const t0 = Date.now();

  while (offset !== null) {
    const res = await fetch(`${BASE}/api/tryon/prewarm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ offset, limit: LIMIT }),
    });
    if (!res.ok) {
      console.error(`✗ slice @${offset} failed (${res.status})`);
      process.exit(1);
    }
    const r = await res.json();
    warmed += r.warmed;
    cached += r.cached;
    errors += r.errors;
    const pct = Math.round(((r.offset + r.processed) / r.total) * 100);
    console.log(
      `  [${String(pct).padStart(3)}%] @${String(r.offset).padStart(3)}  +${r.warmed} rendered · ${r.cached} already cached · ${r.errors} err · ${(r.ms / 1000).toFixed(1)}s`,
    );
    offset = r.nextOffset;
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(
    `\n✓ done — ${warmed} rendered, ${cached} already cached, ${errors} errors in ${mins} min.`,
  );
  console.log(`  Warm renders now serve instantly from public/tryon/. Everything else lazy-caches on first try.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
