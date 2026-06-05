// Re-export the singleton Prisma client from @stylique/db so this app and the worker
// share a connection pool config and there is exactly one place to swap clients.
export { prisma } from "@stylique/db";
