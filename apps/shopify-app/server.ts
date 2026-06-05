// OI-21: Custom Express server entry with increased body-parser limits.
// The default remix-serve body parser cap is too small for chat turns that
// include a 5MB selfie (base64 ≈ 6-8MB). We set 10MB so every valid image
// fits without Remix rejecting the request with a 413.
//
// This file replaces `remix-serve` in production. Update package.json:
//   "start": "node ./server.js"
// and add a build step that compiles this file with tsc/esbuild if needed.
// In dev, Vite's HMR middleware handles requests — this file is not used.

import { createRequestHandler } from "@remix-run/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";
import * as Sentry from "@sentry/remix";
import { initSentry } from "./app/lib/sentry.server";
import { validateRequiredEnvVars } from "./app/lib/startup-validation.server";
import { attachRequestId } from "./app/lib/request-id.server";

// Initialise Sentry as early as possible — no-op when SENTRY_DSN absent.
initSentry();

// Validate required environment variables before accepting any traffic.
// Exits with a clear message if a required var is missing.
validateRequiredEnvVars();

const app = express();
app.disable("x-powered-by");

// OI-21: Raise body-parser limits before the Remix handler.
// A 5MB selfie becomes ~6-8MB as base64 JSON. 10MB gives headroom.
//
// CRITICAL: Shopify webhook HMAC verification (`authenticate.webhook`) needs the
// RAW request body. If express.json() parses it first, the raw bytes are gone
// and every webhook fails HMAC → 400 → NO auto-sync of catalog/inventory/size
// charts. So the body parsers MUST skip /webhooks/* (and the App-Proxy path,
// which also HMAC-verifies the raw request). Remix reads the body itself on
// those routes.
const RAW_BODY_PREFIXES = ["/webhooks", "/proxy"];
const skipRawBody = (req: express.Request) =>
  RAW_BODY_PREFIXES.some((p) => req.path.startsWith(p));
const jsonParser = express.json({ limit: "10mb" });
const urlParser = express.urlencoded({ limit: "10mb", extended: true });
app.use((req, res, next) => (skipRawBody(req) ? next() : jsonParser(req, res, next)));
app.use((req, res, next) => (skipRawBody(req) ? next() : urlParser(req, res, next)));

app.use(compression());

// Static assets built by Vite.
// Remix's Vite build references client assets at /assets/* (and other root
// paths), which live in build/client/. Serve build/client at the ROOT so those
// requests resolve — the old "/build" prefix was for the classic compiler and
// caused every /assets/*.js to 404, leaving the app blank.
const BUILD_DIR = "./build";
app.use(express.static(`${BUILD_DIR}/client`, { immutable: true, maxAge: "1y" }));
app.use(express.static("public", { maxAge: "1h" }));

// Attach X-Request-ID to every request/response for end-to-end tracing.
app.use(attachRequestId);

app.use(morgan("tiny"));

// Sentry request handler — attaches trace context to each incoming request.
// No-op when SENTRY_DSN is absent. Guarded because the Handlers API only
// exists in older @sentry/remix versions (removed in v8+); when absent we
// simply skip it (Sentry without a DSN does nothing anyway).
{
  const handlers = (Sentry as unknown as { Handlers?: { requestHandler?: () => express.RequestHandler } }).Handlers;
  if (handlers?.requestHandler) app.use(handlers.requestHandler());
}

// All other requests go to the Remix handler.
// tsx runs this file as an ES module, so require() is unavailable — load the
// generated Remix server build with a dynamic import (top-level await is valid
// in ESM). The build path is relative to this file (apps/shopify-app/).
const remixBuild = await import(`${BUILD_DIR}/server/index.js`);
app.all(
  "*",
  createRequestHandler({
    build: remixBuild as unknown as Parameters<typeof createRequestHandler>[0]["build"],
    mode: process.env.NODE_ENV,
  }),
);

// Sentry error handler — must be after routes, before any other error middleware.
// Guarded for the same reason as the request handler above.
{
  const handlers = (Sentry as unknown as { Handlers?: { errorHandler?: () => express.ErrorRequestHandler } }).Handlers;
  if (handlers?.errorHandler) app.use(handlers.errorHandler());
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST;
const server = host
  ? app.listen(port, host, onListen)
  : app.listen(port, onListen);

["SIGTERM", "SIGINT"].forEach((sig) =>
  process.once(sig, () => server?.close(console.error)),
);

function onListen() {
  console.log(`[server] http://localhost:${port}`);
}
