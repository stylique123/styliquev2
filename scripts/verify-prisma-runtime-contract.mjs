#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const scannedFiles = [
  "apps/worker/src/jobs/fit-tuner.ts",
  "packages/core/src/reports/monthly.ts",
  "apps/web/scripts/pilot-measure.mjs",
];

for (const file of scannedFiles) {
  const source = readFileSync(resolve(root, file), "utf8");
  if (/@prisma\/client/.test(source)) {
    failures.push(`${file} must import Prisma through @stylique/db, not @prisma/client`);
  }
}

function runPnpm(args, label) {
  try {
    execFileSync("pnpm", args, {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://user:pass@localhost:5432/stylique" },
    });
  } catch (error) {
    failures.push(`${label} failed: ${String(error.stderr || error.message).slice(0, 800)}`);
  }
}

runPnpm(
  [
    "--filter",
    "@stylique/db",
    "exec",
    "node",
    "-e",
    "const p=require('@prisma/client'); if (typeof p.PrismaClient !== 'function' || !p.Prisma) process.exit(1)",
  ],
  "@stylique/db package Prisma client import",
);

runPnpm(
  [
    "--filter",
    "@stylique/shopify-app",
    "exec",
    "node",
    "-e",
    "import('@stylique/db').then(m=>{ if (typeof m.PrismaClient !== 'function' || !m.Prisma || !m.prisma) process.exit(1) })",
  ],
  "Shopify app runtime facade import",
);

if (failures.length > 0) {
  console.error("Prisma runtime contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("Prisma runtime contract verifier passed");
