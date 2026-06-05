# apps/web — Next.js 15 (App Router)

Three surfaces, one app:

## Routes

```
app/
  (marketing)/
    page.tsx                          # /  marketing home
    pricing/page.tsx
    contact/page.tsx
  demo/
    page.tsx                          # /demo  interactive showcase (no Shopify required)
    [productHandle]/page.tsx          # /demo/blue-oxford-shirt  full PDP demo
  dashboard/
    layout.tsx                        # auth-gated, brand-facing
    page.tsx                          # /dashboard  overview
    studio/page.tsx                   # creatives + sets
    tryon/page.tsx                    # try-on usage, fair-use status
    fit/page.tsx                      # size accuracy, up/down distribution
    style/page.tsx                    # outfit + color combo performance
    analytics/page.tsx                # PDP improvement opportunities
    settings/page.tsx                 # plan, billing, integrations
  api/
    shopper/profile/route.ts          # POST: upsert ShopperSession (no auth)
    shopper/tryon/route.ts            # POST: start try-on; enforces plan via core/plans
    shopper/fit/route.ts              # POST: size recommendation
    shopper/style/route.ts            # POST: complete-the-look + color combos
    shopper/upload/route.ts           # POST: presigned upload for personal photo
    shopper/events/route.ts           # POST: batched analytics events
    dashboard/...                     # brand-facing, session-protected
    webhooks/shopify/route.ts         # mirrors webhook intake from shopify-app when needed
```

## Hard rules enforced here

- `/api/shopper/*` MUST validate with zod schemas from `@stylique/types` and MUST NOT require auth.
- `/api/shopper/tryon` calls `plans.canConsume(shopId, "TRYON_PERSONAL")` BEFORE the AI call. If `allowed:false && hideFromShopper`, return 200 with `{ mode: "BODY_MODEL" }` — never an error.
- Demo page reads from a seeded `Shop` row (`shopifyDomain = "demo.stylique.local"`).
