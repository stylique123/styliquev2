# Local Shopify dev — exact terminal order

A reliable, decoupled startup flow. No magic. Four terminals.

```
  Terminal 1   pnpm worker:dev          (BullMQ worker)
  Terminal 2   pnpm shopify:app-server  (Remix on http://localhost:3000)
  Terminal 3   pnpm shopify:tunnel      (Cloudflare quick tunnel → :3000)
  Terminal 4   pnpm shopify:dev         (Shopify CLI session — webhooks, GraphiQL, preview)
```

The first time you start a new tunnel URL, you also run two one-shot commands
(step 4 below) to push the new URL to the Partners dashboard.

---

## One-time setup

Install `cloudflared` (only needed once for the dev tunnel):

```bash
brew install cloudflared       # macOS
# or
sudo apt install cloudflared   # Linux
```

Confirm Postgres + Redis are running:

```bash
pnpm infra:up
```

Confirm the schema and seed are applied:

```bash
pnpm db:migrate
pnpm db:seed
```

---

## Values you must fill in `.env` (repo root)

Copy from `.env.example` and set:

| Var | Where to get it |
| --- | --- |
| `DATABASE_URL` | `postgres://stylique:stylique@localhost:5432/stylique` (default from `infra:up`) |
| `REDIS_URL` | `redis://localhost:6379` (default from `infra:up`) |
| `SHOPIFY_API_KEY` | **same value as `client_id` in `apps/shopify-app/shopify.app.toml`** — copy it verbatim |
| `SHOPIFY_API_SECRET` | Partners dashboard → your app → **Client credentials → Client secret** (click reveal) |
| `SHOPIFY_APP_URL` | Your active Cloudflare tunnel URL, e.g. `https://abc-123.trycloudflare.com` |
| `SHOPIFY_SCOPES` | `read_products,read_inventory,read_orders,write_script_tags` |
| `SHOPIFY_APP_PROXY_SUBPATH` | `stylique` |

If anything is missing, the Remix server fails fast with a clear banner naming
exactly which keys are wrong — including hints like *"same value as `client_id` in
shopify.app.toml"*. Read the banner.

---

## Daily startup — exact order

### Terminal 1 — worker

```bash
pnpm worker:dev
```

Expected: `✓ Stylique worker started`

### Terminal 2 — Remix app server

```bash
pnpm shopify:app-server
```

Expected: `➜  Local:   http://localhost:3000/`

### Terminal 3 — Cloudflare tunnel

```bash
pnpm shopify:tunnel
```

Look for the line that says:

```
Your quick tunnel has been created! Visit it at:
  https://abc-123.trycloudflare.com
```

**Copy that URL.**

### Step 3.5 — only if the tunnel URL changed since last run

The first time you ever start, and any time the cloudflared URL changes, you
need to (a) put the new URL into `.env`, (b) push it into the Partners config:

```bash
# 1. paste the URL into .env as SHOPIFY_APP_URL
$EDITOR .env

# 2. rewrite shopify.app.toml URLs to match
pnpm shopify:link-tunnel https://abc-123.trycloudflare.com

# 3. push the config to Partners
pnpm shopify:deploy
```

`shopify app deploy` will show a diff of `application_url`, `redirect_urls`, and
`[app_proxy].url` and ask **"Release a new version?"** → confirm.

You now have to restart Terminal 2 so the new `SHOPIFY_APP_URL` is picked up.

### Terminal 4 — Shopify CLI session

```bash
pnpm shopify:dev
```

When prompted, pick the existing `Stylique Fashion` app and `stylique-dev` store.
Then press `p` — the embedded Remix UI loads inside Shopify Admin.

---

## What each script does

| Command | What runs | Where the dotenv came from |
| --- | --- | --- |
| `pnpm worker:dev` | `tsx watch apps/worker/src/index.ts` | root `.env` via `dotenv-cli` |
| `pnpm shopify:app-server` | `remix vite:dev --host 0.0.0.0 --port 3000` | root `.env` via `dotenv-cli` |
| `pnpm shopify:tunnel` | `cloudflared tunnel --url http://localhost:3000` | n/a |
| `pnpm shopify:link-tunnel <url>` | rewrites `shopify.app.toml` URLs | n/a |
| `pnpm shopify:deploy` | `shopify app deploy` (pushes toml to Partners) | root `.env` via `dotenv-cli` |
| `pnpm shopify:dev` | `shopify app dev` (CLI session, GraphiQL, preview) | root `.env` via `dotenv-cli` |

---

## Want a stable tunnel URL (no more `link-tunnel` step)?

Switch from quick tunnels to a **named** Cloudflare tunnel attached to a hostname
you control. Done once, the URL never changes:

```bash
cloudflared tunnel login
cloudflared tunnel create stylique
cloudflared tunnel route dns stylique stylique-dev.yourdomain.com
cloudflared tunnel run --url http://localhost:3000 stylique
```

Then set `SHOPIFY_APP_URL=https://stylique-dev.yourdomain.com` once in `.env`,
run `pnpm shopify:link-tunnel https://stylique-dev.yourdomain.com`, `pnpm
shopify:deploy`, and you're set — no more URL rotation.

---

## Troubleshooting

**`✗ SHOPIFY_API_KEY: ...`** — Open `shopify.app.toml`, copy the `client_id`
value, paste it into `.env` as `SHOPIFY_API_KEY`.

**`p` opens Settings → Apps → installation page** — your toml URLs and your
tunnel URL don't match. Re-run steps 3 and 3.5 above. After deploy, the toml,
Partners, and the running tunnel will all agree.

**Webhook 401s** — Partners has an outdated `application_url`. Run `pnpm
shopify:deploy` to push the current toml.

**"Dynamic require not supported" from Vite** — already fixed in
`vite.config.ts`; do not re-add `installGlobals()` to that file.
