import { describe, it, expect } from "vitest";
import {
  createFashionSiglipProvider,
  selectEmbedProvider,
} from "../embeddings/service.js";
import {
  createOpenClipQualityProvider,
  selectStage2Provider,
} from "../imagery/openclip.js";
import { createAwsRekognitionProvider } from "../imagery/aws-rekognition.js";
import type { ImageInput } from "../imagery/types.js";

// ── FashionSigLIP embeddings (Phase 1a) ──────────────────────────────────
describe("FashionSigLIP embed provider", () => {
  it("has a stable fashion modelKey + dims (so re-backfill is idempotent)", () => {
    const p = createFashionSiglipProvider({ endpoint: "https://x/embed" });
    expect(p.key).toBe("fashion-siglip");
    expect(p.dims).toBe(768);
    expect(p.modelKey).toBe("fashion-siglip:marqo-fashionSigLIP:768");
  });

  it("tolerates the common endpoint response shapes", async () => {
    const vec = [0.1, 0.2, 0.3];
    const shapes = [vec, [vec], { embedding: vec }, { data: vec }];
    for (const body of shapes) {
      const p = createFashionSiglipProvider({
        endpoint: "https://x/embed",
        fetchImpl: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch,
      });
      expect(await p.embed("a navy linen shirt")).toEqual(vec);
    }
  });

  it("selector stays on Gemini until FASHION_EMBED_ENDPOINT is set (dormant)", () => {
    expect(selectEmbedProvider({ GEMINI_API_KEY: "k" }).key).toBe("gemini");
    expect(selectEmbedProvider({ FASHION_EMBED_ENDPOINT: "https://x/embed" }).key).toBe("fashion-siglip");
  });
});

// ── OpenCLIP garment classifier (Phase 1b) ───────────────────────────────
const IMG: ImageInput = { id: "i1", url: "https://cdn/x.jpg", position: 0 };

describe("OpenCLIP image-quality provider", () => {
  it("is dormant (neutral passthrough) without an endpoint", async () => {
    const p = createOpenClipQualityProvider();
    expect(p.key).toBe("stub");
    const [s] = await p.score([IMG]);
    expect(s.id).toBe("i1");
    expect(s.score).toBe(5.5);
  });

  it("boosts a clean garment hero shot and penalizes a lifestyle/model shot", async () => {
    const reply = (scores: number[]): typeof fetch =>
      (async () => new Response(JSON.stringify({ scores }), { status: 200 })) as typeof fetch;
    // label order: garment, lifestyle, swatch, detail, sizechart
    const garment = createOpenClipQualityProvider({ endpoint: "https://x", fetchImpl: reply([0.9, 0.03, 0.02, 0.03, 0.02]) });
    const lifestyle = createOpenClipQualityProvider({ endpoint: "https://x", fetchImpl: reply([0.1, 0.85, 0.02, 0.02, 0.01]) });
    const [g] = await garment.score([IMG]);
    const [l] = await lifestyle.score([IMG]);
    expect(g.score).toBeGreaterThan(l.score);
    expect(g.score).toBeGreaterThan(8);
    expect(g.reasons).toContain("rk_clothing_detected");
    expect(l.garmentRole).toBe("LIFESTYLE");
  });

  it("never throws — a failed endpoint scores neutral-low, not abort", async () => {
    const p = createOpenClipQualityProvider({
      endpoint: "https://x",
      fetchImpl: (async () => { throw new Error("network"); }) as typeof fetch,
    });
    const [s] = await p.score([IMG]);
    expect(s.score).toBe(5.0);
    expect(s.reasons).toContain("rk_low_confidence");
  });

  it("selector falls back to the given Stage-2 provider until CLIP_QUALITY_ENDPOINT is set", () => {
    const rek = createAwsRekognitionProvider();
    expect(selectStage2Provider({}, rek).key).toBe(rek.key);
    expect(selectStage2Provider({ CLIP_QUALITY_ENDPOINT: "https://x" }, rek).key).toBe("openclip");
  });
});
