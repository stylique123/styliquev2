# apps/worker — Background jobs (BullMQ on Redis)

All long-running work runs here. API routes enqueue, never block.

## Queues

| Queue | Producer | Job |
| --- | --- | --- |
| `catalog-sync` | shopify-app webhooks, manual trigger | Pull products, variants, images; extract primary color + category. |
| `brand-train` | dashboard upload | Build BrandProfile (palette, tone, style vectors) from product imagery + uploaded refs. |
| `studio-generate` | dashboard | Run StudioAdapter to produce Creative; write Asset + Creative row. |
| `tryon-generate` | shopper API | Run TryOnAdapter; on success update TryOnSession + emit `TRYON_COMPLETED`. |
| `style-recommend` | shopper API (async path) | Optional async path when catalog is huge. |
| `analytics-rollup` | cron | Materialize DASHBOARD_VIEWS from AnalyticsEvent. |
| `usage-rollover` | cron, monthly | Reset UsageCounter periods. |
| `photo-retention` | cron, daily | Purge USER_PHOTO assets older than retention window. |
