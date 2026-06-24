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

export async function assertRequiredDatabaseShape(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('ShopperSession')
  `;
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
