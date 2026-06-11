import { PrismaClient } from "@stylique/db";
const p = new PrismaClient();
const [t] = await p.$queryRaw<{n:number}[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'MonthlyReport'`;
const [e] = await p.$queryRaw<{n:number}[]>`SELECT count(*)::int AS n FROM pg_enum en JOIN pg_type ty ON ty.oid=en.enumtypid WHERE ty.typname='EventName' AND en.enumlabel='MIRA_OPENED'`;
const [m] = await p.$queryRaw<{n:number}[]>`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name='00000000000000_baseline' AND finished_at IS NOT NULL`;
console.log(`MonthlyReport table:     ${t.n === 1 ? "EXISTS ✓" : "MISSING ✗"}`);
console.log(`MIRA_OPENED enum value:  ${e.n === 1 ? "EXISTS ✓" : "MISSING ✗"}`);
console.log(`baseline marked applied: ${m.n === 1 ? "YES ✓" : "NO ✗"}`);
await p.$disconnect();
