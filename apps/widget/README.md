# apps/widget — Storefront PDP widget

Vanilla TS, bundled to a single `<200KB gzipped` file, lazy-loaded by the Theme App Extension.

## Behavior

- Mounts on PDP. Reads product handle from page context.
- Generates / restores `sessionId` from cookie + localStorage (no login).
- Renders four tabs: **Try-On**, **Fit**, **Style**, **Look** (color combos).
- All API calls go through `/apps/stylique/...` (Shopify App Proxy → backend).
- Mobile-first responsive; works as a drawer on mobile, side panel on desktop.

## Shopper inputs (minimal)

Tier 1 (always asked): height, weight, fit preference.
Tier 2 (optional, progressive): body type select, photo upload.

## Try-On UX rule

On load, widget calls `GET /apps/stylique/tryon/entitlement?productId=...`.
- If response says `personalPhotoAllowed: false`, the upload-photo control is **not rendered**. The body-model preview is always rendered.
- Widget NEVER displays anything resembling "credits exhausted".
