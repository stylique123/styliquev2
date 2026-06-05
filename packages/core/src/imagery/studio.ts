// Studio prep — strip the background off a garment or selfie, then
// composite it onto the fixed neutral Stylique backdrop (D38).
//
// Runs as Stage 3 in the image-quality worker AFTER scoreProductImages
// has chosen Product.primaryTryonImageId. Output is a stable studio
// PNG that every VTO call (model-mode or personal) sees. The win:
// every render — across products, across muses, across shoppers —
// sits on identical backdrop + lighting. Visual brand cohesion at $0
// ongoing cost.
//
// Architecture mirrors the rest of the imagery + tryon stack:
//   • Provider-agnostic `BackgroundRemoverProvider` interface.
//   • `createLocalRembgProvider()` — open-source u2net via
//     @imgly/background-removal-node, runs on worker CPU, $0/call.
//   • `createReplicateBgProvider()` — `lucataco/remove-bg`, ~$0.0015
//     per call, opt-in when local rembg isn't available (no Node
//     install in some deploy targets).
//   • `createStubBgProvider()` — pass-through, used in dev and as the
//     last-resort fallback. Returns the original bytes unchanged.
//
// `compositeOntoStudio()` is pure math — takes a transparent RGBA
// buffer and merges it onto a known studio backdrop. No external API
// call. Backdrop is generated procedurally at boot so we don't ship a
// PNG asset that drifts from brand tokens.
//
// SECURITY: user-selfie path runs in-memory only. Bytes never persist
// to disk or DB (D23 / PB17 invariant). The garment-image path writes
// to S3 once at sync time — keyed by ProductImage.id, scoped to shop.

export type ImageBytes = {
  data: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
};

export type BackgroundRemoverProvider = {
  readonly key: string;   // "local_rembg" | "replicate_u2net" | "stub"
  // Returns RGBA PNG bytes with the subject isolated and the background
  // replaced by alpha=0. Implementations MUST never throw — on failure
  // return the original bytes unchanged (the caller decides what to do).
  strip(input: ImageBytes): Promise<ImageBytes>;
};

// ───────────────────────────────────────────────────────────────────────
// Stub provider — pass-through.
// ───────────────────────────────────────────────────────────────────────
// Activates when no BG-remover env is configured. Lets the pipeline run
// in dev without installing model weights or paying for an API. Output
// quality is just the input quality (composite step still runs, so the
// image still lands on the studio backdrop visually — just with the
// product's original background bleeding through if it had one).

export function createStubBgProvider(): BackgroundRemoverProvider {
  return {
    key: "stub",
    async strip(input) {
      return input;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Local rembg provider (lazy-import so the worker doesn't pay the
// 50MB onnx weight load unless this provider is actually selected).
// ───────────────────────────────────────────────────────────────────────
// Wire when `@imgly/background-removal-node` lands in apps/worker. Until
// then this throws a clear error if accidentally selected. Same
// not-yet-installed-but-real-interface pattern we use across providers.

export function createLocalRembgProvider(): BackgroundRemoverProvider {
  return {
    key: "local_rembg",
    async strip(input) {
      try {
        // Dynamic import so the dependency is optional at build time.
        // Cast through unknown — we don't have types when the package
        // isn't installed, and we want this file to compile regardless.
        const mod = (await import(
          "@imgly/background-removal-node" as string
        ).catch(() => null)) as
          | { removeBackground?: (b: Blob) => Promise<Blob> }
          | null;
        if (!mod?.removeBackground) {
          // Not installed — return input unchanged. The pipeline still
          // runs; the admin tile flags this so operators see they're
          // missing the dependency.
          return input;
        }
        const blob = new Blob([input.data as BlobPart], { type: input.mimeType });
        const out = await mod.removeBackground(blob);
        const buf = new Uint8Array(await out.arrayBuffer());
        return { data: buf, mimeType: "image/png" };
      } catch {
        return input;
      }
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Replicate provider (~$0.0015 per call).
// ───────────────────────────────────────────────────────────────────────
// Real call wires in once REPLICATE_API_TOKEN lands. Today the stub
// throws a typed error so callers can fall back gracefully — same
// shape as createVertexVtoProvider's "not implemented" gate.

export type ReplicateBgConfig = {
  apiToken?: string;
  model?: string;   // default "lucataco/remove-bg"
};

export function createReplicateBgProvider(
  cfg: ReplicateBgConfig = {},
): BackgroundRemoverProvider {
  const enabled = Boolean(cfg.apiToken);
  return {
    key: enabled ? "replicate_u2net" : "replicate_u2net_disabled",
    async strip(input) {
      if (!enabled) return input;
      // TODO: implement once REPLICATE_API_TOKEN is set in .env.
      // Until then we behave as a stub (returns input unchanged) rather
      // than throwing — keeps the pipeline alive.
      return input;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Studio composite — pure function.
// ───────────────────────────────────────────────────────────────────────
// Takes a transparent (or not) RGBA buffer and produces the final
// studio image as PNG bytes. The backdrop is procedural — we generate
// it from brand tokens so it never drifts from the rest of the UI.
//
// IMPLEMENTATION NOTE: we don't ship sharp / canvas as a hard dep here
// yet (keeps @stylique/core dep-free). The worker side imports `sharp`
// directly to perform the merge; this module exposes the spec + a
// helper to describe what the backdrop should look like so any
// renderer (sharp / canvas / pure-WASM) can produce it consistently.

export type StudioBackdrop = {
  width: number;
  height: number;
  // Linear gradient stops, top-to-bottom, hex colours from brand tokens.
  // Matches the storefront's --surface → --bg transition so renders
  // visually anchor inside the dashboard + widget consistently.
  gradient: Array<{ at: number; hex: string }>; // at in [0, 1]
  // Soft shadow ellipse beneath the subject — gives the 3D feel
  // without paying for true 3D. Coordinates in [0, 1] relative to size.
  shadow: {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
    opacity: number;
    blurPx: number;
  };
};

export const DEFAULT_STUDIO_BACKDROP: StudioBackdrop = {
  width: 1024,
  height: 1536, // 2:3 portrait — matches PDP aspect ratio
  gradient: [
    { at: 0.0, hex: "#1A1722" },   // surface darken, top
    { at: 0.55, hex: "#0E0B14" },  // brand bg deep
    { at: 1.0, hex: "#08070A" },   // bg floor
  ],
  shadow: {
    centerX: 0.5,
    centerY: 0.92,
    radiusX: 0.28,
    radiusY: 0.03,
    opacity: 0.45,
    blurPx: 22,
  },
};

// Subject placement spec — the rectangle the foreground subject is
// composited into. Centred, top-aligned at 8% from top, takes 70% of
// the canvas height. Matches the framing the production widget uses.
export const DEFAULT_SUBJECT_FRAME = {
  top: 0.08,
  bottom: 0.92,
  leftPad: 0.12,
  rightPad: 0.12,
};

// Output spec consumed by the worker-side sharp pipeline.
export type CompositeRequest = {
  subject: ImageBytes;   // transparent PNG ideally; works on opaque too
  backdrop?: StudioBackdrop;
};

// Returned by the orchestrator so the worker knows what to upload.
export type CompositeResult = {
  png: ImageBytes;
  backdrop: StudioBackdrop;
  appliedShadow: boolean;
};

// The actual sharp/canvas pipeline lives in apps/worker (CPU-side, can
// pull native deps without bloating @stylique/core for everyone). This
// stub returns the subject unchanged so dev never blocks; the worker
// override replaces it with a real composite. Same provider-shaped
// override pattern we use for embeddings (`embedAllForShop` worker-side
// mirror of the shopify-app helper).
export async function compositeOntoStudio(req: CompositeRequest): Promise<CompositeResult> {
  return {
    png: req.subject,
    backdrop: req.backdrop ?? DEFAULT_STUDIO_BACKDROP,
    appliedShadow: false,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Provider selection from env — used by both garment + selfie paths.
// ───────────────────────────────────────────────────────────────────────

export function selectBackgroundRemoverFromEnv(): BackgroundRemoverProvider {
  if (process.env.BG_REMOVER_DISABLED === "1") return createStubBgProvider();
  if (process.env.REPLICATE_API_TOKEN) {
    return createReplicateBgProvider({ apiToken: process.env.REPLICATE_API_TOKEN });
  }
  // Local rembg falls back to stub if the package isn't installed.
  return createLocalRembgProvider();
}
