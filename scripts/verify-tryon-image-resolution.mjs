#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imageQualityBackfill = readFileSync(resolve(root, "apps/shopify-app/app/routes/api.admin.image-quality.backfill.tsx"), "utf8");
const appIndex = readFileSync(resolve(root, "apps/shopify-app/app/routes/app._index.tsx"), "utf8");

const files = execFileSync("rg", [
  "-l",
  "primaryTryonImageId|garmentUrl|prewarm|tryon",
  "apps/worker/src",
  "apps/shopify-app/app/lib",
  "-g",
  "*.ts",
], { cwd: root, encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const violations = [];

for (const file of files) {
  const text = readFileSync(resolve(root, file), "utf8");
  if (!/(tryon|prewarm|garmentUrl|primaryTryonImageId)/i.test(text)) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const hasFirstImageFallback =
      /images\.find\([^)]*primaryTryonImageId[\s\S]*\?\?\s*[^;\n]*images\[0\]/.test(line) ||
      /primaryImage\s*=.*images\[0\]/.test(line);
    if (!hasFirstImageFallback) return;
    const window = lines.slice(Math.max(0, index - 4), Math.min(lines.length, index + 5)).join("\n");
    if (!window.includes("resolveTryonImage")) {
      violations.push(`${relative(root, file)}:${index + 1}`);
    }
  });
  for (const match of text.matchAll(/images\.find\([\s\S]{0,240}?primaryTryonImageId[\s\S]{0,240}?\?\?[\s\S]{0,120}?images\[0\]/g)) {
    const line = text.slice(0, match.index ?? 0).split(/\r?\n/).length;
    const window = lines.slice(Math.max(0, line - 5), Math.min(lines.length, line + 8)).join("\n");
    if (!window.includes("resolveTryonImage")) {
      violations.push(`${relative(root, file)}:${line}`);
    }
  }
}

if (!/const backfillRunId = Date\.now\(\)\.toString\(36\)/.test(imageQualityBackfill)) {
  violations.push("apps/shopify-app/app/routes/api.admin.image-quality.backfill.tsx: manual image-quality backfill must create a per-request run id");
}

if (!/img-q:\$\{shop\.id\}:\$\{productId\}:manual:\$\{backfillRunId\}/.test(imageQualityBackfill)) {
  violations.push("apps/shopify-app/app/routes/api.admin.image-quality.backfill.tsx: product image-quality backfill jobId must be request-scoped");
}

if (!/img-q:\$\{shop\.id\}:all:manual:\$\{backfillRunId\}/.test(imageQualityBackfill)) {
  violations.push("apps/shopify-app/app/routes/api.admin.image-quality.backfill.tsx: full-shop image-quality backfill jobId must be request-scoped");
}

if (/jobId:\s*productId\s*\?\s*`img-q:\$\{shop\.id\}:\$\{productId\}`\s*:\s*`img-q:\$\{shop\.id\}:all`/.test(imageQualityBackfill)) {
  violations.push("apps/shopify-app/app/routes/api.admin.image-quality.backfill.tsx: image-quality backfill must not use sticky completed-job ids");
}

if (!/jobId:\s*job\.id/.test(imageQualityBackfill)) {
  violations.push("apps/shopify-app/app/routes/api.admin.image-quality.backfill.tsx: image-quality backfill response must expose the accepted BullMQ job id");
}

if (!/useFetcher<\{ ok: boolean; data\?: \{ enqueued: boolean; scope: string; jobId\?: string \}; error\?: string \}>/.test(appIndex)) {
  violations.push("apps/shopify-app/app/routes/app._index.tsx: image-quality dashboard trigger must type the real API response shape");
}

if (!/Image re-score queued/.test(appIndex) || !/trigger\.data\.data\?\.jobId/.test(appIndex)) {
  violations.push("apps/shopify-app/app/routes/app._index.tsx: image-quality dashboard must show the accepted job id");
}

if (!/Could not queue image re-score/.test(appIndex) || !/trigger\.data\.error/.test(appIndex)) {
  violations.push("apps/shopify-app/app/routes/app._index.tsx: image-quality dashboard must surface queue failure");
}

if (violations.length > 0) {
  console.error("Try-on/prewarm image paths must use resolveTryonImage instead of raw images[0] fallback:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`try-on image resolution verifier passed (${files.length} files scanned)`);
