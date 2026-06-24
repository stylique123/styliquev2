// Serves the built widget.js with proper HTTP headers so Shopify ScriptTags
// can load it directly from this app URL — no CDN or separate static host needed.
// The file is expected at public/widget.js (relative to app root / process.cwd()).

import type { LoaderFunctionArgs } from "@remix-run/node";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loader(_args: LoaderFunctionArgs) {
  const candidates = [
    join(process.cwd(), "public", "widget.js"),
    join(process.cwd(), "extensions", "stylique-widget", "assets", "tryon.js"),
  ];
  let content: Buffer;
  for (const filePath of candidates) {
    try {
      content = await readFile(filePath);
      return new Response(content as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          // Revalidate on every load so a new widget build reaches every store
          // immediately (the ScriptTag URL is unversioned). A stale 1-hour cache
          // is why a fresh deploy + hard-refresh still served the OLD widget.
          "Cache-Control": "no-cache, must-revalidate, max-age=0",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      // Try the next build output location.
    }
  }
  return new Response("Not found", { status: 404 });
}
