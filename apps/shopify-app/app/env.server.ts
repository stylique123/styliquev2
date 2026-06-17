import { z } from "zod";

// SHOPIFY_API_KEY = the `client_id` from your Partners app (shopify.app.toml line 1).
// They are the same value. We keep two names because Shopify's own SDK reads
// `SHOPIFY_API_KEY` and the toml uses `client_id`.

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a postgres:// URL"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  SHOPIFY_API_KEY: z.string().min(1, "Set to your Partners app client_id (same value as `client_id` in apps/shopify-app/shopify.app.toml)"),
  SHOPIFY_API_SECRET: z.string().min(1, "Partners → App → Client credentials → Client secret"),
  SHOPIFY_APP_URL: z.string().url("Must be the public URL the app is reachable at — your Cloudflare tunnel URL in dev"),
  SHOPIFY_SCOPES: z.string().default("read_products,read_inventory,read_orders,write_script_tags"),
  SHOPIFY_APP_PROXY_SUBPATH: z.string().default("stylique"),

  GEMINI_API_KEY: z.string().min(1, "Required — chat is non-functional without it (get from https://aistudio.google.com)"),
  STORAGE_PATH: z.string().optional(), // When set, VTO images are written to disk here instead of inline data URLs

  STYLIQUE_INTERNAL_SECRET: z
    .string()
    .min(32, "Must be at least 32 chars — generate with: openssl rand -hex 32")
    .optional(),
  // Sentry error tracking — optional. When absent, all Sentry calls are no-ops.
  // Get a DSN from sentry.io → your project → Settings → Client Keys.
  SENTRY_DSN: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  const lines = Object.entries(errors)
    .map(([key, issues]) => `  ✗ ${key}: ${(issues ?? ["missing"]).join("; ")}`)
    .join("\n");

  // Pretty, actionable output. Printed to stderr at boot.
  const message = [
    "",
    "════════════════════════════════════════════════════════════════════",
    " Stylique shopify-app — environment validation failed",
    "════════════════════════════════════════════════════════════════════",
    "",
    "The following env vars are missing or invalid in .env (repo root):",
    "",
    lines,
    "",
    "Copy .env.example → .env and set:",
    "",
    "  DATABASE_URL        postgres://stylique:stylique@localhost:5432/stylique",
    "  REDIS_URL           redis://localhost:6379",
    "  SHOPIFY_API_KEY     <client_id from shopify.app.toml>",
    "  SHOPIFY_API_SECRET  <Client secret from Shopify Partners dashboard>",
    "  SHOPIFY_APP_URL     https://<your-tunnel>.trycloudflare.com",
    "  SHOPIFY_SCOPES             read_products,read_inventory,read_orders,write_script_tags",
    "  STYLIQUE_INTERNAL_SECRET   $(openssl rand -hex 32)  # required in production",
    "",
    "Then re-run the command. See docs/LOCAL_SHOPIFY_DEV.md for the full flow.",
    "════════════════════════════════════════════════════════════════════",
    "",
  ].join("\n");

  console.error(message);
  throw new Error("Missing required environment variables — see message above.");
}

if (parsed.success && !parsed.data.STYLIQUE_INTERNAL_SECRET && parsed.data.NODE_ENV === "production") {
  throw new Error("STYLIQUE_INTERNAL_SECRET is required in production");
}

if (parsed.success && parsed.data.NODE_ENV === "production") {
  const missing: string[] = [];
  if (!process.env.APP_ENCRYPTION_KEY) missing.push("APP_ENCRYPTION_KEY");
  if (!process.env.MIRA_EVENT_BRIDGE_SECRET) missing.push("MIRA_EVENT_BRIDGE_SECRET");
  if (!process.env.PLATFORM_JWT_SECRET) missing.push("PLATFORM_JWT_SECRET");
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!process.env.STORAGE_PATH && !process.env.S3_TRYON_BUCKET) missing.push("STORAGE_PATH or S3_TRYON_BUCKET");

  const vtoEnabled = process.env.VTO_ENABLED !== "0";
  if (vtoEnabled) {
    const hasVtoProvider =
      Boolean(process.env.VERTEX_SERVICE_ACCOUNT_JSON && process.env.VERTEX_PROJECT_ID) ||
      Boolean(process.env.REPLICATE_API_TOKEN) ||
      Boolean(parsed.data.GEMINI_API_KEY);
    if (!hasVtoProvider) missing.push("VTO provider env (Vertex, Replicate, or GEMINI_API_KEY)");
  }

  if (missing.length) {
    throw new Error(`Missing required production env: ${missing.join(", ")}`);
  }
}

export const env = parsed.data;
export type Env = typeof env;
