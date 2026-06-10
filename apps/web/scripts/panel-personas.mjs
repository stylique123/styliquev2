#!/usr/bin/env node
/**
 * panel-personas.mjs
 *
 * Critical-evaluation panel runner for the Mira brain.
 *
 * Runs 8 shopper personas × 4 turns each against /api/mira and dumps:
 *   - /tmp/panel-current.csv   (one row per turn)
 *   - /tmp/panel-current.json  (raw transcripts)
 *
 * Scoring (1-10 per aspect) is left for the model/human reviewer to fill
 * in afterwards — this script captures the raw conversations so the four
 * critic archetypes (Shopper / Brand owner / CRO / VC) can score them
 * against the aspects matrix.
 *
 * Endpoint:
 *   MIRA_URL env var, or defaults to localhost then Railway.
 *
 * Usage:
 *   node apps/web/scripts/panel-personas.mjs
 *   MIRA_URL=https://stylique-web.up.railway.app/api/mira node apps/web/scripts/panel-personas.mjs
 */

import fs from "node:fs";
import path from "node:path";

const CANDIDATES = [
  process.env.MIRA_URL,
  "http://localhost:3000/api/mira",
  "https://stylique-web.up.railway.app/api/mira",
].filter(Boolean);

const PERSONAS = [
  {
    id: "cold-opener",
    label: "Cold opener (browsing, no context)",
    turns: [
      "hey",
      "just looking honestly, not sure what I need",
      "I guess something for date nights",
      "what would you actually recommend",
    ],
  },
  {
    id: "warm-pdp",
    label: "Warm PDP (on a product, leaning in)",
    productHandle: "wrap-coat-camel",
    turns: [
      "does it run small?",
      "I'm 5'9, usually a M",
      "ok how does it fit in the shoulders",
      "alright add the M",
    ],
  },
  {
    id: "price-objection",
    label: "Price objection",
    turns: [
      "I like it but this is way too expensive",
      "I was hoping more like $200",
      "is there anything in that range that looks similar",
      "hmm not sure, let me think",
    ],
  },
  {
    id: "wedding-occasion",
    label: "Wedding occasion",
    turns: [
      "I need an outfit for a wedding in Lake Como in July",
      "outdoor, late afternoon ceremony",
      "I'd want something tailored but breathable",
      "can I see the look on me",
    ],
  },
  {
    id: "climate",
    label: "Climate (Mumbai monsoon)",
    turns: [
      "I'm in Mumbai and it's monsoon, what works",
      "I sweat a lot, nothing clingy",
      "do you have linen?",
      "ok show me the best one",
    ],
  },
  {
    id: "fabric-question",
    label: "Fabric question (informed shopper)",
    productHandle: "wrap-coat-camel",
    turns: [
      "is this wool or wool-blend",
      "how does it handle rain",
      "and dry-clean only?",
      "fine, I'll take the L",
    ],
  },
  {
    id: "complete-look",
    label: "Complete-the-look (AOV)",
    productHandle: "atelier-wide-leg-trouser",
    turns: [
      "what goes with this",
      "I like the white shirt option",
      "what about a layer for evening",
      "add all three",
    ],
  },
  {
    id: "size-question",
    label: "Size question (post-baby)",
    productHandle: "tailored-blazer-double",
    turns: [
      "I'm post-baby and not sure what size to get for this",
      "I was a M before, probably L now, ribcage wider",
      "will this be forgiving around the waist",
      "ok size me",
    ],
  },
];

async function pickEndpoint() {
  for (const url of CANDIDATES) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status < 500 && res.status !== 404) {
        return { url, ok: true };
      }
    } catch (_) {}
  }
  return { url: null, ok: false };
}

async function callMira(url, messages, currentProductHandle) {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: messages[messages.length - 1]?.content || "",
      history: messages.slice(0, -1).map(m => ({ from: m.role === "user" ? "user" : "mira", text: m.content })),
      ...(currentProductHandle ? { currentProductHandle } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  const latencyMs = Date.now() - t0;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  const voice =
    json?.voice ?? json?.message ?? json?.text ?? json?.reply ?? text.slice(0, 400);
  return {
    status: res.status,
    latencyMs,
    voice,
    route: json?.route ?? null,
    intent: json?.intent ?? null,
    quickReplies: json?.quickReplies ?? null,
    raw: json,
  };
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v).replace(/\r?\n/g, " ").replace(/"/g, '""');
  return `"${s}"`;
}

async function main() {
  const { url, ok } = await pickEndpoint();
  if (!ok) {
    console.error(
      "[panel] No reachable Mira endpoint. Tried:\n  " +
        CANDIDATES.join("\n  "),
    );
    console.error(
      "[panel] Set MIRA_URL to override, or boot the dev server.",
    );
    process.exit(2);
  }
  console.log(`[panel] using endpoint: ${url}`);

  const out = [];
  const rows = [
    [
      "persona",
      "turn",
      "shopperMsg",
      "status",
      "latencyMs",
      "route",
      "intent",
      "voice",
      "quickReplies",
    ].join(","),
  ];

  for (const p of PERSONAS) {
    const messages = [];
    const convo = { persona: p.id, label: p.label, turns: [] };
    for (let i = 0; i < p.turns.length; i++) {
      const msg = p.turns[i];
      messages.push({ role: "user", content: msg });
      let r;
      try {
        r = await callMira(url, messages, p.productHandle);
      } catch (e) {
        r = {
          status: 0,
          latencyMs: -1,
          voice: `ERROR: ${e.message}`,
          route: null,
          intent: null,
          quickReplies: null,
        };
      }
      messages.push({ role: "assistant", content: r.voice ?? "" });
      convo.turns.push({ shopper: msg, ...r });
      rows.push(
        [
          p.id,
          i + 1,
          csvEscape(msg),
          r.status,
          r.latencyMs,
          csvEscape(r.route),
          csvEscape(r.intent),
          csvEscape(r.voice),
          csvEscape(
            Array.isArray(r.quickReplies) ? r.quickReplies.join(" | ") : "",
          ),
        ].join(","),
      );
      process.stdout.write(
        `  ${p.id} turn ${i + 1}/${p.turns.length} → ${r.status} ${r.latencyMs}ms\n`,
      );
    }
    out.push(convo);
  }

  fs.writeFileSync("/tmp/panel-current.csv", rows.join("\n"));
  fs.writeFileSync(
    "/tmp/panel-current.json",
    JSON.stringify({ url, ranAt: new Date().toISOString(), out }, null, 2),
  );
  const lat = out
    .flatMap((c) => c.turns.map((t) => t.latencyMs))
    .filter((n) => n > 0);
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0;
  console.log(
    `\n[panel] done. ${out.length} personas, ${lat.length} measured turns, avg ${avg}ms.`,
  );
  console.log("[panel] wrote /tmp/panel-current.csv and /tmp/panel-current.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
