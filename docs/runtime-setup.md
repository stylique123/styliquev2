# Stylique Fashion Runtime Setup

Fashion is the active Shopify runtime. Beauty is frozen and must use a separate
Shopify app, store, TOML, and env set before it is reactivated.

## Architecture

```text
Shopify dev store: stylique-fashion-test.myshopify.com
        |
        | embedded admin + OAuth
        v
apps/shopify-app  Remix Shopify app on :3000
        |  afterAuth: Shop row, Plan row, webhooks, catalog-sync job
        |  app proxy: /apps/stylique/* -> /proxy/shopper/*
        v
Redis / BullMQ  <---->  apps/worker on :3001 health
        |
        v
Postgres / Prisma

apps/widget builds theme extension assets into:
apps/shopify-app/extensions/stylique-widget/assets

apps/platform is the merchant/super-admin platform.
apps/web is demo/local preview only.
apps/creative is a standalone creative UI shell.
```

## Apps And Packages

| Path | Role | Fashion runtime? |
| --- | --- | --- |
| `apps/shopify-app` | Shopify Remix app, OAuth, webhooks, app proxy, admin | yes |
| `apps/shopify-app/extensions/stylique-widget` | Shopify theme extension | yes |
| `apps/widget` | Builds `widget.js` and `stylist.js` for the theme extension | yes |
| `apps/worker` | BullMQ workers: catalog sync, recommendations, try-on, billing, outcomes | yes |
| `apps/platform` | Merchant platform and super admin | yes |
| `apps/web` | Demo/local preview and marketing storefront | no production Shopify runtime |
| `apps/creative` | Standalone creative shell | no Shopify runtime |
| `packages/db` | Prisma schema/client | shared |
| `packages/core` | Shared services and plans | shared |
| `packages/ai` | Mira/brain packages | shared, not runtime config |
| `packages/types` | Shared schemas | shared |

## Shopify TOML Files

| File | Purpose |
| --- | --- |
| `apps/shopify-app/shopify.app.toml` | Active default local Fashion config |
| `apps/shopify-app/shopify.app.local.toml` | Local Shopify CLI config for `stylique-fashion-test.myshopify.com` |
| `apps/shopify-app/shopify.app.staging.toml` | Staging config for `https://staging.stylique.ai` |
| `apps/shopify-app/shopify.app.production.toml` | Production config for `https://app.stylique.ai` |
| `apps/shopify-app/shopify.app.stylique-fashion.toml` | Legacy generated config; do not use |
| `apps/shopify-app/shopify.app.stylique-fashion-km.toml` | Legacy generated config with dead Shopify default URL; do not use |

The actual Remix auth route is `/auth/callback`, provided by
`apps/shopify-app/app/routes/auth.$.tsx` with `authPathPrefix: "/auth"`.
Do not use `/api/auth` or `https://shopify.dev/apps/default-app-home`.

## Env Strategy

Commit only examples:

```text
.env.example
.env.local.example
.env.staging.example
.env.production.example
```

Never commit real env files:

```text
.env
.env.local
.env.staging
.env.production
apps/*/.env
```

Root scripts load `.env.local` first, then `.env` as fallback:

```text
dotenv -e .env.local -e .env -- <command>
```

That means the Shopify app and worker see the same env regardless of folder.

## Terminal Layout

Terminal 1:

```bash
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm dev:worker
```

Terminal 2:

```bash
pnpm dev:shopify
```

Terminal 3, optional platform:

```bash
pnpm platform:dev
```

Terminal 4, checks:

```bash
pnpm check:shopify-config
pnpm check:db
pnpm check:health
pnpm check:ready
pnpm check:worker
```

## Local

Local uses:

```text
Shopify app: stylique-fashion
Store: stylique-fashion-test.myshopify.com
Config: apps/shopify-app/shopify.app.local.toml
Backend: http://localhost:3000
Worker health: http://localhost:3001/health
```

Start both worker and Shopify CLI together:

```bash
pnpm dev:all
```

Or separately:

```bash
pnpm dev:worker
pnpm dev:shopify
```

The local TOML has:

```toml
[build]
automatically_update_urls_on_dev = true
dev_command = "pnpm exec remix vite:dev --host 0.0.0.0 --port 3000"
```

Shopify CLI owns the tunnel and URL update during local dev.

## Staging

Staging should be the main real Shopify validation environment before a pilot:

```text
URL: https://staging.stylique.ai
Config: apps/shopify-app/shopify.app.staging.toml
Store: a dedicated Fashion staging store
```

Staging must validate:

- embedded app opens
- OAuth completes
- `Shop` row created
- `Plan` row created
- webhooks registered
- catalog sync job enqueued
- worker consumes catalog sync
- theme extension preview works
- widget can call app proxy

## Production

Production uses:

```text
URL: https://app.stylique.ai
Config: apps/shopify-app/shopify.app.production.toml
Store: real merchant stores only
```

Production must have separate Shopify credentials from local/staging.

## Health Checks

```bash
pnpm check:health
pnpm check:ready
pnpm check:worker
pnpm check:db
pnpm check:shopify-config
```

`/api/health` checks DB, Redis, and queues.
`/api/ready` checks DB, Redis, and required env.
Worker health checks live BullMQ queue counts.

## Common Errors

| Error | Fix |
| --- | --- |
| `shopify.dev/apps/default-app-home` opens | Run `pnpm check:shopify-config`; use `shopify.app.local.toml` |
| `/api/auth` callback mismatch | Use `/auth/callback` only |
| worker says `DATABASE_URL` missing | Start from repo root with `pnpm dev:worker` |
| `/api/ready` says missing env | Fill `.env.local` from `.env.local.example` |
| `/api/health` says Redis error | Run `pnpm infra:up` |
| embedded app hangs | Confirm `pnpm dev:shopify` is using `stylique-fashion-test.myshopify.com` |
| Beauty affects Fashion | Stop; Beauty needs separate TOML/env/app/store before reactivation |

## Pilot Gate

Staging deployment is required before pilot. A local Shopify CLI preview is not
enough because pilot readiness requires stable URLs, stable webhooks, stable app
proxy routing, and repeatable worker behavior.
