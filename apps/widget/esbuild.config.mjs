// Builds the storefront widget bundles. Output goes directly into the theme
// app extension's assets folder so Shopify's CDN serves them.
//
//   src/index.ts   → ../shopify-app/extensions/stylique-widget/assets/widget.js
//   src/stylist.ts → ../shopify-app/extensions/stylique-widget/assets/stylist.js
//
// Two independent self-mounting custom elements. The theme block loads both.

import { build, context } from "esbuild";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTDIR = resolve(__dirname, "..", "shopify-app", "extensions", "stylique-widget", "assets");

mkdirSync(OUTDIR, { recursive: true });

const ENTRIES = [
  // The demo's REAL MiraWidget + TryOnPanel React components, run on Preact —
  // the ONE interface. Identical to the demo, pointed at the deployed demo backend.
  { name: "tryon",   src: "src/mira-demo.tsx", banner: "/* Stylique (demo parity) */" },
];

function buildOptions(entry) {
  const outfile = resolve(OUTDIR, `${entry.name}.js`);
  try { rmSync(outfile); } catch { /* ok */ }
  return {
    entryPoints: [resolve(__dirname, entry.src)],
    bundle: true,
    outfile,
    format: "iife",
    target: ["es2019", "safari13", "chrome80"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
    define: {
      "process.env.NODE_ENV": '"production"',
      // Storefront images must be absolute (a relative /products/… would 404 on
      // the shop domain). The shared catalog reads this build-time constant.
      __SQ_ASSET_BASE__: '"https://stylique-web-production.up.railway.app"',
    },
    banner: { js: entry.banner },
    metafile: true,
    // JSX → Preact (so the demo's React TryOnPanel runs in a tiny bundle).
    jsx: "automatic",
    jsxImportSource: "preact",
    loader: { ".tsx": "tsx", ".ts": "ts" },
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
      // MiraWidget imports next/image — shim it to a plain <img> (no Next runtime).
      "next/image": resolve(__dirname, "src/tryon/next-image-shim.tsx"),
    },
  };
}

if (process.argv.includes("--watch")) {
  for (const entry of ENTRIES) {
    const ctx = await context(buildOptions(entry));
    await ctx.watch();
    console.log(`[${entry.name}] watching → ${entry.name}.js`);
  }
} else {
  for (const entry of ENTRIES) {
    const opts = buildOptions(entry);
    const result = await build(opts);
    const bytes = Object.values(result.metafile.outputs)[0].bytes;
    console.log(`✓ ${entry.name}.js  ${(bytes / 1024).toFixed(1)} KB  →  ${opts.outfile}`);
  }
}
