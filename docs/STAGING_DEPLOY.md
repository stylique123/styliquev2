# Staging Deploy Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Docker + Compose | 24+ | [docs.docker.com](https://docs.docker.com/get-docker/) |
| pnpm | 9.12.0 | `npm i -g pnpm@9.12.0` |
| Node | 20 | via `nvm install 20` |
| Shopify CLI | 3.x | `npm i -g @shopify/cli` |
| cloudflared | latest | `brew install cloudflared` |

---

## Environment variables

Copy `.env.example` to `.env` (repo root) and set the following. Staging
values differ from production as shown:

| Variable | Staging | Production |
|---|---|---|
| `DATABASE_URL` | `postgres://stylique:stylique@localhost:5432/stylique` | Managed Postgres URL (RDS / Supabase) |
| `REDIS_URL` | `redis://localhost:6379` | Managed Redis URL (Upstash / ElastiCache) |
| `SHOPIFY_API_KEY` | Staging Partners app `client_id` | Production Partners app `client_id` |
| `SHOPIFY_API_SECRET` | Staging client secret | Production client secret |
| `SHOPIFY_APP_URL` | Your tunnel URL (see below) | Stable production hostname |
| `SHOPIFY_SCOPES` | `read_products,read_inventory,read_orders,write_script_tags` | Same |
| `NODE_ENV` | `development` | `production` |

---

## Deploy flow

Run these commands **in order** the first time (or after a `db:reset`):

```bash
# 1. Bring up Postgres + Redis containers
pnpm infra:up

# 2. Push schema and generate Prisma client
pnpm db:migrate       # applies all migrations
pnpm db:generate      # regenerates the Prisma client

# 3. Build the storefront widget (output: apps/shopify-app/public/widget.js)
pnpm widget:build

# 4. Start all services + smoke test
pnpm shopify:smoke
```

`shopify:smoke` runs `infra:up`, `db:generate`, then starts the worker,
app server, and tunnel concurrently. Use it for quick end-to-end validation.

---

## Tunnel URL update flow

Every new Cloudflare quick tunnel generates a different hostname. After
`pnpm shopify:tunnel` prints the URL, update the Partners app config:

```bash
# Copy the URL printed by the tunnel command, then:
SHOPIFY_APP_URL=https://<your-tunnel>.trycloudflare.com pnpm shopify:link-tunnel
```

This script (`scripts/set-tunnel-url.mjs`) patches:
- `SHOPIFY_APP_URL` in `.env`
- The `application_url` in `apps/shopify-app/shopify.app.toml`

Then restart the Shopify CLI session (`pnpm shopify:dev`) so it picks up the
new URL.

---

## Verifying the deploy

```bash
# Health check (should return { ok: true, db: "ok", redis: "ok", ... })
curl https://<tunnel-url>/api/health | jq .

# Typecheck (zero errors expected)
pnpm --filter @stylique/shopify-app typecheck
```
