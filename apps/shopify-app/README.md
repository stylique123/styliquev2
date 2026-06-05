# apps/shopify-app — Shopify embedded app (Remix)

Built on `@shopify/shopify-app-remix`. Three responsibilities only:

1. **OAuth + session storage** — install/uninstall, token storage (encrypted), `Shop` row lifecycle.
2. **App Proxy** — exposes shopper APIs under the storefront origin (`/apps/stylique/*` → our Next API). This is what lets the widget call our backend without CORS and without shopper login.
3. **Webhooks** — `products/*`, `orders/paid`, `app/uninstalled`. Pushes to BullMQ jobs in `apps/worker`.

## Routes

```
app/routes/
  auth.$.tsx                  # OAuth callback
  app._index.tsx              # embedded admin home → links to dashboard.stylique.app
  app.catalog.tsx             # trigger catalog sync, show progress
  app.brand.tsx               # upload brand references → BrandProfile
  app.billing.tsx             # Shopify Billing API
  webhooks.products.tsx
  webhooks.orders.tsx
  webhooks.uninstalled.tsx
  proxy.shopper.$.tsx         # forwards /apps/stylique/* to apps/web /api/shopper/*
```

## Theme App Extension

`extensions/stylique-widget/` ships a single `<script>` block + Liquid snippet that mounts the widget bundle from `apps/widget` onto the PDP. Merchants enable it from Theme Editor — no code edits required.
