import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Normalize the connection string for a POOLED Neon endpoint. Against Neon's
// pgbouncer pooler, Prisma MUST send `pgbouncer=true` (disables prepared
// statements) or connections get reset mid-query — the `prisma:error … Closed`
// the worker was logging, which dropped catalog-sync jobs (live health showed
// `catalog-sync: 10 failed`). We add it (idempotently) whenever the host looks
// pooled, plus sane connection_limit/pool_timeout. Runs for app AND worker.
function normalizedDbUrl(): string | undefined {
  const base = process.env.DATABASE_URL;
  if (!base) return undefined;
  const isPooled = /-pooler\./.test(base) || /pgbouncer=true/.test(base);
  // Only rewrite pooled endpoints; a direct endpoint (used for migrations) is
  // left untouched.
  if (!isPooled) return base;
  const params = new Map<string, string>();
  const [, qs = ""] = base.split("?");
  for (const kv of qs.split("&")) { if (kv) { const [k, v = ""] = kv.split("="); params.set(k, v); } }
  if (!params.has("pgbouncer")) params.set("pgbouncer", "true");
  if (!params.has("connection_limit")) params.set("connection_limit", process.env.DATABASE_POOL_SIZE ?? "5");
  if (!params.has("pool_timeout")) params.set("pool_timeout", "20");
  if (!params.has("sslmode")) params.set("sslmode", "require");
  const root = base.split("?")[0];
  const query = [...params.entries()].map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join("&");
  return `${root}?${query}`;
}

const _dbUrl = normalizedDbUrl();

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    datasources: _dbUrl ? { db: { url: _dbUrl } } : undefined,
  });

if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

export * from "@prisma/client";
