// Muse archetype images for BODY_MODEL try-on.
//
// BODY_MODEL try-on composites the garment onto a real muse body image (img2img),
// not a text-generated generic model. This module maps the widget's body-model
// IDs (ava/lina/noor/maya/zara/elena — see BODY_MODEL_DESCRIPTIONS in
// @stylique/core) to the bundled muse PNGs and returns them as base64.
//
// Robustness: every read is best-effort. If a muse asset is missing or
// unreadable, we return null and the caller falls back to the legacy
// text-described-model path — try-on still produces an image, just not a
// real composite. A missing asset must NEVER break a render.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Widget body-model ID → bundled muse file (5 generated muses live in ./muses).
// elena (plus) maps to curve — the closest available archetype.
const MUSE_FILE_BY_HINT: Record<string, string> = {
  ava: "petite.png",
  lina: "slim.png",
  noor: "tall.png",
  maya: "curve.png",
  zara: "athletic.png",
  elena: "curve.png",
  // also accept raw archetype names directly (defensive)
  petite: "petite.png",
  slim: "slim.png",
  tall: "tall.png",
  curve: "curve.png",
  athletic: "athletic.png",
};

const DEFAULT_FILE = "slim.png";

// In-memory cache so we read each muse PNG from disk only once per process.
const cache = new Map<string, { base64: string; mime: string } | null>();

export function loadMuseImage(modelHint?: string | null): { base64: string; mime: string } | null {
  const key = (modelHint || "").toLowerCase();
  const file = MUSE_FILE_BY_HINT[key] ?? DEFAULT_FILE;

  if (cache.has(file)) return cache.get(file) ?? null;

  try {
    const path = fileURLToPath(new URL(`./muses/${file}`, import.meta.url));
    const buf = readFileSync(path);
    const result = { base64: buf.toString("base64"), mime: "image/png" };
    cache.set(file, result);
    return result;
  } catch (err) {
    console.error(`[muse-assets] could not load muse "${file}" (falling back to text model):`, (err as Error).message);
    cache.set(file, null);
    return null;
  }
}
