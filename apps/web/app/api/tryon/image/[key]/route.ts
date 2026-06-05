// ─────────────────────────────────────────────────────────────────────────────
// Serves a cached muse try-on render by key.
//
// WHY THIS EXISTS: muse renders are produced at runtime, but on Railway / any
// serverless container the build's public/ dir is read-only and Next.js only
// serves the build-time public snapshot — a file written to public/tryon/ at
// runtime 404s. So muse renders are cached in memory + a writable temp dir and
// streamed back here through a DYNAMIC route, which Next.js always serves. This
// is what makes muse try-on actually work in production.
//
// The bytes come from: in-memory cache → writable disk → baked public dir
// (committed pre-warms). 24h immutable cache headers — the key is content-stable.
// ─────────────────────────────────────────────────────────────────────────────
import { readMuseRenderBytes } from "../../../../lib/tryon-render.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const clean = key.replace(/\.png$/i, "");
  const bytes = await readMuseRenderBytes(clean);
  if (!bytes) {
    return new Response("not_found", { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
