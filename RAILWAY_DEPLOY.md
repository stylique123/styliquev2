# Stylique Fashion — Railway Deployment Runbook

> **Why this exists:** the first live deploy took ~9 hours and failed ~10 times. Every
> failure is documented below with its exact fix so it NEVER takes more than one
> command again. Read §1 (the one-liner) for routine redeploys. Read §3 (the
> failure ledger) only if something breaks.

---

## 0. The architecture we landed on (and WHY)

| Piece | Where | Why |
|---|---|---|
| Shopify app (Remix + Express) | **Railway** service `stylique-app` | Needs a stable public HTTPS URL Shopify can reach |
| Redis (queues, rate limit) | **Railway** plugin `Redis` | Same project, internal networking |
| Postgres | **Neon** (cloud, in `DATABASE_URL`) | Already cloud — reused as-is |
| Worker (BullMQ: catalog sync, VTO) | ⚠️ **NOT YET DEPLOYED** | Needed for products/Mira/try-on — see §5 |

**Permanent URL:** `https://stylique-app-production.up.railway.app`
**Railway project:** `stylique-fashion` (`0abd1c6d-80f7-442e-8a40-4736b5b4400c`)
**Shopify app client_id:** `5d64194b12c927c4cbe2507fd4824250` (app name "Shopify admin mcp" / "stylique-fashion")

### THE #1 LESSON — do NOT use local tunnels on this network
Local `shopify app dev` and every tunnel (Cloudflare `trycloudflare.com`, `loca.lt`)
**failed identically** — the dev's ISP blocks tunnel domains. Both the app's browser
AND Shopify couldn't reach localhost. **Deploying to Railway (a normal domain) is the
only reliable path.** Never burn time on tunnels again. Deploy.

---

## 1. Routine redeploy (the one command)

After ANY code change, from `fashion/`:
```bash
railway up --detach          # uploads + builds + deploys; URL never changes
```
Watch it: `railway logs --build` (build) then `railway logs` (runtime).
Health: `curl https://stylique-app-production.up.railway.app/api/health`

Setting/changing an env var = a **fast restart** (no rebuild):
```bash
railway variables --set "KEY=value"
```

---

## 2. First-time setup (already done — here for disaster recovery)

```bash
# CLI
npm install -g @railway/cli && railway login

# Project + Redis
cd fashion
railway init --name stylique-fashion
railway add -d redis
railway add -s stylique-app && railway service stylique-app

# Public domain
railway domain     # -> stylique-app-production.up.railway.app

# Env vars (all on the stylique-app service)
railway variables \
  --set "NODE_ENV=production" \
  --set "SHOPIFY_API_KEY=<client_id>" \
  --set "SHOPIFY_API_SECRET=<secret>" \
  --set "SHOPIFY_SCOPES=read_products,read_product_listings,read_inventory,read_orders,write_products,write_script_tags" \
  --set "SHOPIFY_APP_URL=https://stylique-app-production.up.railway.app" \
  --set 'REDIS_URL=redis://default:${{Redis.REDISPASSWORD}}@${{Redis.REDISHOST}}:${{Redis.REDISPORT}}' \
  --set "DATABASE_URL=<neon url>" \
  --set "SESSION_SECRET=<secret>" \
  --set "GEMINI_API_KEY=<key>" \
  --set "STYLIQUE_INTERNAL_SECRET=$(openssl rand -hex 16)" \
  --set "APP_ENCRYPTION_KEY=$(openssl rand -hex 32)" \
  --set "MIRA_EVENT_BRIDGE_SECRET=$(openssl rand -hex 24)" \
  --set "PLATFORM_JWT_SECRET=$(openssl rand -hex 24)" \
  --set "STORAGE_PATH=/tmp/stylique-tryon" \
  --set "CREATIVE_ENABLED=0"

railway up --detach
```

Then point Shopify at the deployed URL:
```bash
cd apps/shopify-app
CI=1 shopify app deploy --config shopify.app.toml --allow-updates --message "Point app at Railway URL"
```

---

## 3. THE FAILURE LEDGER — every crash and its fix (so we never re-debug)

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Upload `413 Payload Too Large` (335MB) | `railway up` packs the dir; `apps/web/public` = 316MB of AI images | `.railwayignore` excludes `node_modules`, `.git`, `apps/web/public` (but KEEP `apps/web/package.json` — lockfile needs it) |
| 2 | Build: invalid `COPY ... 2>/dev/null` | Docker COPY can't use shell fallback | Removed it; copy all `apps/*/package.json` plainly |
| 3 | Crash: `Cannot read properties of undefined (reading 'requestHandler')` | `server.ts` used `Sentry.Handlers` (removed in Sentry v8+) | Guard both Sentry handler calls behind `if (Sentry.Handlers?.x)` |
| 4 | Crash: `require is not defined in ES module scope` | tsx runs `server.ts` as ESM; it used `require(build)` | `const build = await import(...)` (top-level await is valid in ESM) |
| 5 | Crash: `Invalid module ".prisma/client/default"` | Vite bundled `@prisma/client`; its internal specifier leaked into the ESM bundle | `vite.config.ts` → `rollupOptions.external: [..., "@prisma/client", /^\.prisma\//]` (keep Prisma external/CJS) |
| 6 | Crash: `Cannot find package '@prisma/client'` | pnpm's nested `node_modules` → externalized dep unresolvable at runtime | `.npmrc` → `node-linker=hoisted` (flat node_modules). **MUST add `.npmrc` to the Dockerfile deps COPY.** |
| 7 | Crash: `Missing required production env: APP_ENCRYPTION_KEY, MIRA_EVENT_BRIDGE_SECRET, PLATFORM_JWT_SECRET, STORAGE_PATH..., creative provider` | `env.server.ts` has a STRICT prod check | Set those secrets; VTO passes on `GEMINI_API_KEY`; disable creative with `CREATIVE_ENABLED=0` |
| 8 | App installs but renders **blank** ("Handling response"); JS `/assets/*.js` → 404 | `server.ts` served Vite assets at `/build/*`; Vite references them at `/assets/*` | Serve `build/client` at ROOT: `app.use(express.static("./build/client"))` (drop the `/build` prefix) |

---

## 4. THE INSTALL FLOW (the other thing that cost hours)

The new **dev.shopify.com dev dashboard** distinguishes:
- **"Preview app with Shopify CLI" / `shopify app dev`** → a *localhost* dev preview. **NEVER use this** — localhost is unreachable; the app loads blank forever.
- **"Install app"** button (Overview → Installs) → installs the **released version** (the Railway URL). **ALWAYS use this.**

If the store is stuck on the localhost preview (blank loading, and Railway logs show ZERO
browser requests): **uninstall the app, then click "Install app" → select store → install.**
A fresh install uses the active released version's `application_url` (Railway).

Verify install landed:
```bash
psql "$DATABASE_URL" -c 'SELECT "shopifyDomain" FROM "Shop";'   # should show the store
psql "$DATABASE_URL" -c 'SELECT tier FROM "Plan";'             # STARTER
```

---

## 5. Deploy the worker (products/Mira/try-on need it)

The app alone leaves `Product = 0` — catalog-sync jobs have no consumer. The worker is a
SECOND Railway service in the SAME project (shares Redis + Neon).

```bash
cd fashion
railway add -s stylique-worker && railway service stylique-worker
# Worker needs: the SAME shared secrets as the app (esp. APP_ENCRYPTION_KEY — it
# decrypts Shop.accessToken!), Redis, AND the Shopify creds (it builds the API client).
railway variables \
  --set "APP_ENCRYPTION_KEY=<same value as the app>" \
  --set "DATABASE_URL=<neon>" --set "GEMINI_API_KEY=<key>" \
  --set "SHOPIFY_API_KEY=<id>" --set "SHOPIFY_API_SECRET=<secret>" \
  --set "SHOPIFY_APP_URL=https://stylique-app-production.up.railway.app" \
  --set "NODE_ENV=production" --set "WORKER_HEALTH_PORT=3001" \
  --set 'REDIS_URL=redis://default:${{Redis.REDISPASSWORD}}@${{Redis.REDISHOST}}:${{Redis.REDISPORT}}' \
  --set "RAILWAY_DOCKERFILE_PATH=apps/worker/Dockerfile"
railway up --detach
```

### TWO multi-service gotchas (fix #9 + #10)
- **#9 — `railway.json` overrides per-service `RAILWAY_DOCKERFILE_PATH`.** With a root
  `railway.json` pinning `apps/shopify-app/Dockerfile`, the WORKER service also built the
  *app* (crashed on the app's env check). Fix: **DELETE `railway.json`** and set
  `RAILWAY_DOCKERFILE_PATH=apps/shopify-app/Dockerfile` on the app service +
  `=apps/worker/Dockerfile` on the worker service. One Dockerfile path per service.
- **#10 — the worker requires `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` + `SHOPIFY_APP_URL`**
  (builds the Shopify Admin client). Set them on the worker too, not just the app.
- **Critical:** `APP_ENCRYPTION_KEY` MUST match the app's value — the app encrypted
  `Shop.accessToken` with it at install; the worker decrypts it for catalog sync.

Once up, the worker consumes the install-time `catalog-sync` job and products populate
(only if the store actually HAS products — see §7).

## 7. Get products into the store (for Mira/try-on to have data)

Catalog sync only pulls what the store contains. If `stylique-fashion-dev` is empty, add
products: Shopify admin → Products → Add product (or import sample data), OR via the Admin
API / `@akson/mcp-shopify` MCP. After products exist, trigger a re-sync (reinstall, or an
admin sync route) and confirm `SELECT COUNT(*) FROM "Product"` climbs.

---

## 6. Config files that make this work (committed)

- `fashion/railway.json` → `{ build.dockerfilePath: "apps/shopify-app/Dockerfile" }`
- `fashion/.railwayignore` → trims the upload (excludes `apps/web/public` etc.)
- `fashion/.npmrc` → `node-linker=hoisted`
- `fashion/apps/shopify-app/Dockerfile` → 4-stage build, `tsx server.ts` entry
- `fashion/apps/shopify-app/shopify.app.toml` → `application_url` + redirect + app_proxy = Railway URL
