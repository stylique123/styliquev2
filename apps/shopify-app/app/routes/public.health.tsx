// /health alias — Shopify Partner Program review checklist probes /health not /api/health.
// Re-exports the same loader so both paths return identical JSON.
export { loader } from "./api.health";
