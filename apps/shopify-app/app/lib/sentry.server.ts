// Sentry error reporting — optional. Graceful no-op when SENTRY_DSN absent.
// Import this module and call reportError() wherever you catch unexpected errors.

import * as Sentry from "@sentry/remix";

const DSN = process.env.SENTRY_DSN;

let _initialized = false;
export function initSentry() {
  if (_initialized || !DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1, // 10% of requests traced — cheap
    ignoreErrors: [
      // Shopify redirect errors are expected control flow, not bugs
      "Response",
    ],
  });
  _initialized = true;
}

export function reportError(err: unknown, context?: Record<string, unknown>) {
  if (!DSN) return; // silent no-op in dev
  if (context) Sentry.setContext("stylique", context);
  Sentry.captureException(err);
}

export function setUser(user: { id: string; shopId?: string }) {
  if (!DSN) return;
  Sentry.setUser(user);
}

export function addBreadcrumb(msg: string, data?: Record<string, unknown>) {
  if (!DSN) return;
  Sentry.addBreadcrumb({ message: msg, data });
}
