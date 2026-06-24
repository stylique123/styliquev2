#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = execFileSync("rg", [
  "-l",
  "CART_CONFIRMED",
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

const ignoredPathParts = [
  "__tests__",
  ".test.ts",
  ".test.tsx",
  "packages/types/src/index.ts",
  "routes/webhooks.orders.fulfilled.tsx",
];

const allowedMarkers = [
  "distinctOrderCountFromEvents",
  "orderTotalsFromCartRows",
  "confirmedOrders",
  "tryonAbandon",
  "coPurchase",
  "product-level",
  "productId",
  "shopperId",
  "cartByProduct",
  "keepBiasBySize",
  "top products by cart",
];

const violations = [];

for (const file of files) {
  if (ignoredPathParts.some((part) => file.includes(part))) continue;
  const text = readFileSync(resolve(root, file), "utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const suspiciousCount =
      /eventCount\([^)]*"CART_CONFIRMED"/.test(line) ||
      /evt\("CART_CONFIRMED"\)/.test(line) ||
      /filter\([^)]*CART_CONFIRMED[^)]*\)\.length/.test(line);

    const window = lines.slice(Math.max(0, index - 5), Math.min(lines.length, index + 8)).join("\n");
    const suspiciousPrismaCount =
      /analyticsEvent\s*\.\s*count/.test(line) && /name:\s*"CART_CONFIRMED"/.test(window);
    if (!suspiciousCount && !suspiciousPrismaCount) return;

    if (!allowedMarkers.some((marker) => window.includes(marker))) {
      violations.push(`${relative(root, file)}:${index + 1}`);
    }
  });
}

if (violations.length > 0) {
  console.error("Suspicious CART_CONFIRMED metric paths need explicit order/product/line semantics:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`cart-confirmed metric verifier passed (${files.length} files scanned)`);
