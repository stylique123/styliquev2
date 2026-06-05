# Stylique Production Deployment

## Processes

- Shopify app: `pnpm --filter @stylique/shopify-app start`
- Worker: `pnpm --filter @stylique/worker start`
- Merchant platform: `pnpm --filter @stylique/platform start`

Run app and worker as separate processes. The app serves Shopify OAuth, App Proxy,
admin routes, webhooks, and `/api/health`. The worker consumes BullMQ queues and
serves `GET /health` on `WORKER_HEALTH_PORT`.

## Build

```bash
pnpm install --frozen-lockfile
pnpm --filter @stylique/db exec prisma generate --schema=prisma/schema.prisma
pnpm --filter @stylique/shopify-app build
pnpm --filter @stylique/platform build
pnpm --filter @stylique/worker typecheck
```

## Migrations

```bash
pnpm --filter @stylique/db exec prisma migrate deploy --schema=prisma/schema.prisma
```

## Required Production Env

See `.env.example`. Production must set real values for DB, Redis, Shopify,
platform/internal secrets, Gemini, storage, and the enabled VTO/creative
provider. Do not run production with stub creative providers.

## Health

- Shopify app: `GET /api/health`
- Worker: `GET /health`

Both checks must pass before routing pilot traffic.
