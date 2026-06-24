// Startup environment validation.
//
// Call validateRequiredEnvVars() once at boot (e.g. in server.ts or root.tsx loader)
// BEFORE accepting traffic. If a required var is missing the process exits with a
// clear, actionable message rather than failing silently mid-request.
//
// Required vars — missing any of these means the app CANNOT function:
//   DATABASE_URL         Prisma / Postgres connection
//   SESSION_SECRET       Remix session signing key
//   SHOPIFY_API_KEY      Shopify Partner app key
//   SHOPIFY_API_SECRET   Shopify Partner app secret
//   SHOPIFY_APP_URL      Public URL the app is served from
//   SHOPIFY_SCOPES       Must include the scopes required by sync/injection/order attribution
//   REDIS_URL            BullMQ / rate-limiter / SSE pub-sub
//
// Warn-only vars — missing these degrades optional features but the app starts:
//   GEMINI_API_KEY       Mira / VTO will be disabled
//   SENTRY_DSN           Error tracking will be silent
//   APP_ENCRYPTION_KEY   accessToken stored plaintext (see OI-25 / crypto.server.ts)

import { missingRequiredShopifyScopes } from "./shopify-scopes.server";

const REQUIRED_VARS: ReadonlyArray<{ key: string; hint: string }> = [
  {
    key: "DATABASE_URL",
    hint: "Prisma cannot connect. Set a postgres:// connection string.",
  },
  {
    key: "SESSION_SECRET",
    hint: "Remix sessions cannot be signed. Set a long random string (openssl rand -hex 32).",
  },
  {
    key: "SHOPIFY_API_KEY",
    hint: "Shopify OAuth will fail. Copy from your Partner Dashboard app credentials.",
  },
  {
    key: "SHOPIFY_API_SECRET",
    hint: "Shopify webhook HMAC validation will fail. Copy from your Partner Dashboard.",
  },
  {
    key: "SHOPIFY_APP_URL",
    hint: "Shopify redirect URLs will be wrong. Set to the public HTTPS URL of this app.",
  },
  {
    key: "SHOPIFY_SCOPES",
    hint: "Shopify OAuth will mint under-scoped tokens. Include read_products, read_inventory, read_orders, write_script_tags.",
  },
  {
    key: "REDIS_URL",
    hint: "BullMQ, rate-limiting, and SSE require Redis. Set a redis:// or rediss:// URL.",
  },
];

const PRODUCTION_REQUIRED_VARS: ReadonlyArray<{ key: string; hint: string }> = [
  {
    key: "APP_ENCRYPTION_KEY",
    hint: "Required in production so stored Shopify access tokens are encrypted.",
  },
  {
    key: "MIRA_EVENT_BRIDGE_SECRET",
    hint: "Required in production so the demo event bridge cannot spoof analytics.",
  },
  {
    key: "PLATFORM_JWT_SECRET",
    hint: "Required in production for platform/internal JWT validation.",
  },
  {
    key: "STYLIQUE_INTERNAL_SECRET",
    hint: "Required in production for internal API authentication.",
  },
];

const WARN_VARS: ReadonlyArray<{ key: string; feature: string }> = [
  {
    key: "GEMINI_API_KEY",
    feature: "Mira AI Stylist, VTO render, and image-match will be DISABLED.",
  },
  {
    key: "SENTRY_DSN",
    feature: "Sentry error tracking is not configured — errors will be logged to console only.",
  },
  {
    key: "APP_ENCRYPTION_KEY",
    feature:
      "APP_ENCRYPTION_KEY is not set — Shop.accessToken stored as plaintext (see OI-25). " +
      "Generate one with: openssl rand -hex 32",
  },
];

export function missingRequiredEnvVars(): string[] {
  const missing: string[] = [];

  for (const { key, hint } of REQUIRED_VARS) {
    if (!process.env[key]) missing.push(`  • ${key}: ${hint}`);
  }

  const missingScopes = missingRequiredShopifyScopes(process.env.SHOPIFY_SCOPES);
  if (missingScopes.length) {
    missing.push(
      `  • SHOPIFY_SCOPES: Missing ${missingScopes.join(", ")}. Required for catalog sync, inventory/size availability, order attribution, and ScriptTag auto-injection.`,
    );
  }

  if (process.env.NODE_ENV === "production") {
    for (const { key, hint } of PRODUCTION_REQUIRED_VARS) {
      if (!process.env[key]) missing.push(`  • ${key}: ${hint}`);
    }
    if (!process.env.STORAGE_PATH && !process.env.S3_TRYON_BUCKET) {
      missing.push("  • STORAGE_PATH or S3_TRYON_BUCKET: Required in production for try-on image storage.");
    }

    const vtoEnabled = process.env.VTO_ENABLED !== "0";
    const hasVtoProvider =
      Boolean(process.env.VERTEX_SERVICE_ACCOUNT_JSON && process.env.VERTEX_PROJECT_ID) ||
      Boolean(process.env.REPLICATE_API_TOKEN) ||
      Boolean(process.env.GEMINI_API_KEY);
    if (vtoEnabled && !hasVtoProvider) {
      missing.push("  • VTO provider env: Set Vertex, Replicate, or GEMINI_API_KEY, or set VTO_ENABLED=0.");
    }
    if (process.env.USE_IN_PROCESS_BRAIN === "0") {
      missing.push("  • USE_IN_PROCESS_BRAIN: Must not be 0 in production; production Mira must use the in-process @stylique/mira-brain runtime.");
    }
  }

  return missing;
}

/**
 * Validate that all required environment variables are set.
 * Throws an Error with a detailed message listing every missing variable
 * so the operator can fix them all at once.
 *
 * Also emits console.warn for optional vars whose absence degrades features.
 *
 * Call once at app startup, before accepting requests.
 */
export function validateRequiredEnvVars(): void {
  const missing = missingRequiredEnvVars();

  if (missing.length > 0) {
    throw new Error(
      [
        `[Stylique] FATAL — ${missing.length} required environment variable(s) are not set.`,
        `The application cannot start until these are configured:`,
        ...missing,
        ``,
        `Check your .env file or deployment environment and restart.`,
      ].join("\n"),
    );
  }

  // Warn about optional vars
  for (const { key, feature } of WARN_VARS) {
    if (!process.env[key]) {
      console.warn(`[Stylique] WARN — ${key} not set. ${feature}`);
    }
  }
}

/**
 * Check a single env var and throw with a clear message if missing.
 * Useful for lazy-init code that needs a specific var at the call site.
 */
export function requireEnvVar(key: string, hint?: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[Stylique] Missing required env var: ${key}${hint ? ` — ${hint}` : ""}.`,
    );
  }
  return value;
}
