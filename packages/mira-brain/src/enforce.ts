// ─── Mira card-first + voice/chip enforcement (Step 2H Phase 2 / P2-T07) ─────
// Mira sells visually and briefly: a product card first, a short voice (≤2 short
// lines), ≤3 chips. This deterministic pass trims any wall-of-text the model
// returns and caps the chips, so the UI never reads like a rambling chatbot.

import type { MiraDecision } from "./schemas.js";

const MAX_CHIPS = 3;
const MAX_VOICE_CHARS = 240; // ~2 short lines

// Trim the voice to at most 2 sentences / 2 lines and a hard char cap, without
// cutting mid-word. Keeps Mira punchy.
function trimVoice(voice: string): string {
  let v = voice.replace(/\s+/g, " ").trim();
  // Keep at most the first two sentences.
  const sentences = v.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  if (sentences && sentences.length > 2) {
    v = sentences.slice(0, 2).join(" ").trim();
  }
  if (v.length > MAX_VOICE_CHARS) {
    const cut = v.slice(0, MAX_VOICE_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    v = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\-\s]+$/, "") + "…";
  }
  return v;
}

export function enforceCardVoiceChips(decision: MiraDecision): MiraDecision {
  let d = decision;
  if (d.voice) {
    const trimmed = trimVoice(d.voice);
    if (trimmed !== d.voice) d = { ...d, voice: trimmed };
  }
  if (d.quickReplies && d.quickReplies.length > MAX_CHIPS) {
    d = { ...d, quickReplies: d.quickReplies.slice(0, MAX_CHIPS) };
  }
  return d;
}
