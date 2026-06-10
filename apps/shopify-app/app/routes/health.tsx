// /health — Shopify Partner Program review checklist probes /health (root), not
// /api/health or /public/health. The prior alias (public.health.tsx) actually
// resolves to /public/health under this app's flat-route convention, so /health
// 404'd. This root resource route re-exports the same loader so /health returns
// the identical health JSON.
export { loader } from "./api.health";
