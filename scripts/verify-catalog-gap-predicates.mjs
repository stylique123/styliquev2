#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = execFileSync("rg", [
  "-l",
  "catalogGap\\.(findMany|groupBy|count)",
  "apps",
  "packages",
  "-g",
  "*.ts",
  "-g",
  "*.tsx",
], { cwd: root, encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const allowedPredicates = [
  "realCatalogGapWhere",
  "realDemandCatalogGapWhere",
  "internalDemandCatalogGapWhere",
  "fashionIntelligenceCatalogGapWhere",
  "gapIntensityCatalogGapWhere",
  "recommendationCatalogGapWhere",
  "monthlyReportCatalogGapWhere",
  "outcomeCatalogGapWhere",
];

const violations = [];

for (const file of files) {
  if (file.includes("__tests__") || file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
  const text = readFileSync(resolve(root, file), "utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!/catalogGap\.(findMany|groupBy|count)/.test(line)) return;
    const window = lines.slice(index, Math.min(lines.length, index + 8)).join("\n");
    if (!allowedPredicates.some((name) => window.includes(name))) {
      violations.push(`${relative(root, file)}:${index + 1}`);
    }
  });
}

if (violations.length > 0) {
  console.error("CatalogGap read paths must use a real-demand predicate helper:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`catalog-gap predicate verifier passed (${files.length} files scanned)`);
