# Live Test Checklist — Stylee Store

Step-by-step guide for the first live install and manual smoke test of Stylique
on the Stylee store. Run through this top-to-bottom on every significant feature
change before releasing to production.

---

## 1. Prerequisites

### Infrastructure
- [ ] Docker Desktop running — `pnpm infra:up` starts Postgres + Redis
- [ ] `psql postgres://stylique:stylique@localhost:5432/stylique -c '\l'` prints the `stylique` database
- [ ] `redis-cli ping` returns `PONG`

### Shopify Partners app
- [ ] App created at https://partners.shopify.com — name: **Stylique Fashion**
- [ ] `client_id` from the app matches `SHOPIFY_API_KEY` in `.env`
- [ ] Client secret revealed and set as `SHOPIFY_API_SECRET` in `.env`
- [ ] The Stylee store is added as a **development store** under your Partners account
  (Partners dashboard → Stores → Add store → Create development store, OR add an
  existing store as a test store)

### Env file
- [ ] `.env` exists at the repo root (copy from `apps/shopify-app/.env.stylee-template`)
- [ ] All required vars are filled in (run `bash scripts/setup-live-test.sh` to verify)

### One-time setup
```bash
pnpm infra:up
bash scripts/setup-live-test.sh
```

---

## 2. Installing on the Stylee Store

### Start the dev stack (four terminals)

```bash
# Terminal 1
pnpm worker:dev

# Terminal 2
pnpm shopify:app-server

# Terminal 3
pnpm shopify:tunnel
# Copy the printed URL: https://abc-123.trycloudflare.com
```

### Link the tunnel URL (only when the URL changes)

```bash
pnpm shopify:link-tunnel https://abc-123.trycloudflare.com
# Updates shopify.app.toml and .env

pnpm shopify:deploy
# Pushes the new URLs to Shopify Partners → confirm "Release a new version?"

# Restart Terminal 2 so it picks up the new SHOPIFY_APP_URL
```

### Shopify CLI session

```bash
# Terminal 4
pnpm shopify:dev
```

When prompted:
1. Select the **Stylique Fashion** app
2. Select the **Stylee** development store
3. Press `p` to open the embedded admin UI

If `p` opens the **Settings → Apps** installation page instead of the app:
the toml URLs and tunnel URL are out of sync — re-run `shopify:link-tunnel` and
`shopify:deploy`, then restart Terminal 2.

### Confirm installation
- [ ] Shopify Admin shows "Stylique Fashion" in the Apps section of the Stylee store
- [ ] Pressing `p` opens the Stylique embedded admin (not the install page)
- [ ] The admin home page shows the shop domain as `stylee.myshopify.com`

---

## 3. Automated Smoke Test

With the dev stack running and the tunnel URL known:

```bash
BASE_URL=https://abc-123.trycloudflare.com pnpm tsx scripts/smoke-test.ts
```

All 6 checks should pass. A failure here indicates a broken route or a 500 error
that must be fixed before proceeding to manual tests.

---

## 4. Manual Test Scenarios

### 4.1 Widget — product page

1. Open any product page on the Stylee storefront
   (`https://stylee.myshopify.com/products/<any-handle>`)
2. - [ ] The Stylique chat widget button appears (bottom-right or configured position)
3. - [ ] Clicking the button opens the 3-step widget overlay
4. - [ ] The overlay loads without console errors

### 4.2 Mira — occasion query

1. In the open widget, type: **"I need something for a wedding"**
2. - [ ] Mira responds within ~5 s with product suggestions
3. - [ ] Response mentions occasion-appropriate items (not random)
4. - [ ] At least one product card shows a real product image from the Stylee catalog
5. - [ ] No `500` errors in Terminal 2 logs

### 4.3 Fit & size step

1. Continue the conversation: **"I'm usually a medium but I'm between sizes"**
2. - [ ] Mira asks at least one clarifying question about fit preference
3. - [ ] A size recommendation appears in the response
4. - [ ] The recommended size matches a variant that exists in the suggested product

### 4.4 Virtual Try-On (VTO) panel

> Requires `REPLICATE_API_TOKEN` to be set. If absent, the fallback provider
> (`TRYON_FALLBACK_PROVIDER=gemini-image`) is used.

1. Click the **"See on me"** or **"Try On"** button on a suggested product card
2. - [ ] The VTO panel opens (camera prompt or upload button)
3. - [ ] After uploading/taking a photo, a render job is queued (check Terminal 1)
4. - [ ] A render result image appears within ~30 s (depends on Replicate queue)
5. - [ ] No 500s in either Terminal 1 or Terminal 2

### 4.5 Shopper account — OTP signup

1. In the widget, trigger the signup flow (Mira suggests it, or visit the account step)
2. Enter a test email address
3. - [ ] With `RESEND_API_KEY` set: an email arrives with a 6-digit code
4. - [ ] Without `RESEND_API_KEY`: Terminal 2 logs the OTP code (search for `[OTP]`)
5. Enter the code
6. - [ ] Account is created; `sq_shopper_id` cookie is set in the browser
7. - [ ] Subsequent widget loads recognise the shopper (name appears)

### 4.6 Analytics dashboard

1. In Shopify Admin, open the embedded Stylique app → **Dashboard**
2. - [ ] The dashboard loads without a 500
3. - [ ] Chat count is > 0 (from the widget test above)
4. - [ ] Product mentions section lists items that were discussed
5. - [ ] Sentiment chart renders (may show "no data" for a new store — that is fine)

### 4.7 Sentiment extraction

1. In the dashboard, click the **"Analyze now"** / sentiment button
2. - [ ] A background job is enqueued (Terminal 1 shows a BullMQ job starting)
3. - [ ] Job completes without error
4. - [ ] Refreshing the dashboard shows updated sentiment scores

### 4.8 Catalog sync

1. In Shopify Admin → Stylique app home, click **"Sync catalog"**
2. - [ ] Sync job starts (Terminal 1 logs)
3. - [ ] After completion, the product count in the app home matches the store's product count

---

## 5. Common Errors and Fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Widget button doesn't appear on storefront | App proxy not configured / storefront script not injected | Verify `[app_proxy]` in `shopify.app.toml`; check that the widget script tag is in the theme |
| `shop_not_installed` from proxy endpoints | App not installed on store, or HMAC check fails with wrong secret | Re-install the app; confirm `SHOPIFY_API_SECRET` matches the Partners dashboard |
| Mira returns "I'm not sure" on every message | `GEMINI_API_KEY` invalid or quota exceeded | Check key at https://aistudio.google.com; check quota in Google Cloud Console |
| VTO panel never returns a render | `REPLICATE_API_TOKEN` missing or Replicate outage | Set the token; check https://status.replicate.com |
| OTP email not arriving | `RESEND_API_KEY` missing or domain not verified | Check Terminal 2 for the console-logged OTP; verify domain in Resend dashboard |
| Dashboard 500 after install | DB migration not applied | Run `pnpm db:migrate` and restart Terminal 2 |
| `p` opens install page, not the app | Tunnel URL mismatch with `shopify.app.toml` | Run `pnpm shopify:link-tunnel <current-tunnel-url>` → `pnpm shopify:deploy` → restart Terminal 2 |
| Webhook 401 in Shopify CLI logs | `application_url` in Partners is stale | `pnpm shopify:deploy` to push the current toml |
| BullMQ worker not processing jobs | Redis not running, or `REDIS_URL` wrong | `pnpm infra:up`; confirm `REDIS_URL=redis://localhost:6379` |
| `✗ SHOPIFY_API_KEY` banner on startup | Key not set or wrong value | Copy `client_id` from `shopify.app.toml` verbatim into `.env` as `SHOPIFY_API_KEY` |
