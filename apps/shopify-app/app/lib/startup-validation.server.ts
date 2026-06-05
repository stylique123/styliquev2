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
//   REDIS_URL            BullMQ / rate-limiter / SSE pub-sub
//
// Warn-only vars — missing these degrades optional features but the app starts:
//   GEMINI_API_KEY       Mira / VTO will be disabled
//   SENTRY_DSN           Error tracking will be silent
//   APP_ENCRYPTION_KEY   accessToken stored plaintext (see OI-25 / crypto.server.ts)

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
    key: "REDIS_URL",
    hint: "BullMQ, rate-limiting, and SSE require Redis. Set a redis:// or rediss:// URL.",
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
  const missing: string[] = [];

  for (const { key, hint } of REQUIRED_VARS) {
    if (!process.env[key]) {
      missing.push(`  • ${key}: ${hint}`);
    }
  }

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
