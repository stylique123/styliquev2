# apps/worker — Background jobs

All long-running work runs through BullMQ on Redis. API routes enqueue jobs and do not block shopper/admin requests.

## Active Queues

| Queue | Main producers | Job |
| --- | --- | --- |
| `catalog-sync` | Shopify install, product webhooks, scheduled refresh | Sync products, variants, images, inventory, currency, and enqueue catalog follow-ups. |
| `image-quality` | Catalog sync, admin backfill | Score product images, choose `primaryTryonImageId`, set `tryonReady` and `widgetTier`. |
| `size-chart-extract` | Catalog sync, admin backfill | Extract size charts from metafields, descriptions, linked pages, and chart images. |
| `brand-dna-catalog` | Shopify install, brand settings refresh | Extract brand palette/tone/style signals from catalog imagery. |
| `brand-instagram` | Brand settings upload | Merge Instagram archive visual DNA into `BrandProfile`. |
| `brand-install` | Shopify install/reinstall | Run first-install setup and try-on prewarm work. |
| `tryon-render` | Shopper try-on API, prewarm jobs | Render and cache body-model or personal try-on outputs. |
| `recommendations` | Scheduled refresh, admin run-now | Generate merchant recommendations. |
| `sentiment-extract` | Scheduled refresh, admin run-now | Extract session sentiment labels/themes/summaries. |
| `fit-tuner` | Scheduled refresh | Tune fit/look weights from cart and size outcomes. |
| `outcome-resolver` | Scheduled refresh | Resolve recommendation outcomes into learned signals. |
| `billing-reconcile` | Scheduled refresh | Verify Shopify billing status and downgrade unpaid paid tiers. |
| `inject-widget` | Scheduled refresh | Re-ensure storefront ScriptTag injection for active shops. |
| `retention-cleanup` | Scheduled refresh | Delete stale shopper sessions according to retention policy. |
| `monthly-report` | Monthly scheduled refresh | Generate merchant optimization reports. |

## Schedules

- Catalog refresh: every 6 hours globally, then fan-out per active shop.
- Per-shop catalog safety sync: daily at 06:00 UTC.
- Widget injection health check: daily at 07:00 UTC.
- Recommendations: nightly at 02:30 UTC.
- Sentiment extraction: nightly at 02:45 UTC.
- Fit/look tuner: nightly at 02:50 UTC.
- Outcome resolver: nightly at 03:00 UTC.
- Billing reconcile: daily at 04:00 UTC.
- Retention cleanup: Monday at 03:00 UTC.
- Monthly report: first day of each month at 08:00 UTC.
