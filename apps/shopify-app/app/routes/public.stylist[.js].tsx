// Serves the built stylist.js with proper HTTP headers so Shopify ScriptTags
// can load it directly from this app URL — no CDN or separate static host needed.
// The file is expected at public/stylist.js (relative to app root / process.cwd()).

import type { LoaderFunctionArgs } from "@remix-run/node";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loader(_args: LoaderFunctionArgs) {
  const candidates = [
    join(process.cwd(), "public", "stylist.js"),
    join(process.cwd(), "extensions", "stylique-widget", "assets", "stylist.js"),
  ];
  let content: Buffer;
  for (const filePath of candidates) {
    try {
      content = await readFile(filePath);
      return new Response(content as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      // Try the next build output location.
    }
  }
  return new Response("Not found", { status: 404 });
}
