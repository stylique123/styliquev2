import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const KEY = env.match(/GEMINI_API_KEY=(.+)/)?.[1]?.trim();

// Long system prompt that forces heavy reasoning, approximating the real Mira prompt.
const LONGSYS = `You are Mira, an elite fashion sales associate for a luxury maison. Reason carefully about shopper intent, the product, the occasion, fit psychology, color theory against skin tone, and the 10-stage sales funnel (approach, convert window-shopper, discover via SPIN, present ONE anchored pick, handle objection, size the exact piece, complete the look, fitting-room close, assumptive close, add-on). Think through multiple angles before committing to ONE route. Respond ONLY with strict JSON {"voice":string,"route":string,"productHandle"?:string,"quickReplies"?:string[],"intent"?:string}. Lead, never ask permission. Be warm, concise, decisive.
${Array.from({ length: 40 }).map((_, i) => `Few-shot ${i}: Shopper says something ambiguous; Mira infers the need, names ONE confident product pick, and routes to navigate or reco — never hands the decision back.`).join("\n")}`;

const TURN = "is this good for me? im not sure about the fit and whether the color suits my skin tone, what do you think honestly";

async function probe(maxOutputTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: LONGSYS }] },
      contents: [{ role: "user", parts: [{ text: TURN }] }],
      generationConfig: {
        temperature: 0.65,
        thinkingConfig: { thinkingBudget: 512 },
        maxOutputTokens,
        responseMimeType: "application/json",
      },
    }),
  });
  const d = await res.json();
  const c = d.candidates?.[0] ?? {};
  const u = d.usageMetadata ?? {};
  const text = c.content?.parts?.[0]?.text ?? "";
  let jsonOk = false;
  try { JSON.parse(text); jsonOk = true; } catch {}
  return { finish: c.finishReason, think: u.thoughtsTokenCount, out: u.candidatesTokenCount, hasText: !!text, jsonOk };
}

for (const mt of [2048, 4096, 8192]) {
  const runs = [];
  for (let i = 0; i < 4; i++) runs.push(await probe(mt));
  const ok = runs.filter((r) => r.jsonOk).length;
  console.log(`maxOutputTokens=${mt}: JSON-ok ${ok}/4 | ` + runs.map((r) => `${r.finish}/think${r.think}/${r.jsonOk ? "ok" : "FAIL"}`).join("  "));
}
