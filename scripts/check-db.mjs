#!/usr/bin/env node

import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "packages", "db", "package.json"));
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

try {
  await prisma.$queryRaw`SELECT 1`;
  const [shops, plans, products] = await Promise.all([
    prisma.shop.count().catch(() => -1),
    prisma.plan.count().catch(() => -1),
    prisma.product.count().catch(() => -1),
  ]);
  console.log(JSON.stringify({ ok: true, db: "ok", shops, plans, products }, null, 2));
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    db: "error",
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
