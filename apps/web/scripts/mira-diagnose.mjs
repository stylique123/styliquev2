// Mira diagnostic driver — POSTs a turn to /api/mira and prints the raw decision
// so we can see whether the model path or the regex fallback handled it.
//
// Run (dev server up, MIRA_DEBUG=1 on the server for finishReason/rawLen logs):
//   node apps/web/scripts/mira-diagnose.mjs [port] "your message"
//   port — dev server port (default 3001)

const PORT = process.argv[2] || "3001";
const MSG = process.argv[3] || "is this good for me?";
const BASE = `http://localhost:${PORT}`;

const body = {
  message: MSG,
  history: [],
  currentProduct: { handle: "linen-relaxed-shirt" },
  shownHandles: [],
};

const res = await fetch(`${BASE}/api/mira`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

console.log(`status ${res.status}`);
const json = await res.json().catch(() => null);
console.log(JSON.stringify(json, null, 2));
