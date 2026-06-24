import { prisma } from "../db.server";

type RequiredColumn = {
  table: string;
  column: string;
  why: string;
};

const REQUIRED_COLUMNS: RequiredColumn[] = [
  {
    table: "ShopperSession",
    column: "miraObjectiveJson",
    why: "server-canonical Mira objective memory",
  },
  {
    table: "ShopperSession",
    column: "miraObjectiveUpdatedAt",
    why: "server-canonical Mira objective memory timestamp",
  },
];

async function queryShopperSessionColumns(): Promise<
  Array<{ tableName: string; columnName: string }>
> {
  // Neon's serverless pooler frequently throws a transient `Closed` on the
  // first connection after a cold start. This guard runs BEFORE listen(), so a
  // single transient failure here would crash boot and fail the deploy even when
  // the schema is correct. Retry connection-level failures a few times; a
  // genuinely-missing column is detected only from a SUCCESSFUL query below.
  const MAX_ATTEMPTS = 6;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
        SELECT table_name AS "tableName", column_name AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('ShopperSession')
      `;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[Stylique] DB shape check: connection attempt ${attempt}/${MAX_ATTEMPTS} failed (${
            (err as Error)?.message ?? "unknown"
          }) — retrying in ${attempt * 500}ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

export async function assertRequiredDatabaseShape(): Promise<void> {
  const rows = await queryShopperSessionColumns();
  const present = new Set(rows.map((row) => `${row.tableName}.${row.columnName}`));
  const missing = REQUIRED_COLUMNS.filter((item) => !present.has(`${item.table}.${item.column}`));

  if (missing.length > 0) {
    throw new Error([
      "[Stylique] FATAL — database schema is behind the code.",
      "Run Prisma migrations before accepting traffic:",
      "  pnpm --filter @stylique/db exec prisma migrate deploy --schema=prisma/schema.prisma",
      "Missing required column(s):",
      ...missing.map((item) => `  • ${item.table}.${item.column} (${item.why})`),
    ].join("\n"));
  }
}
