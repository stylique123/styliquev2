/**
 * Request-ID middleware and helper for the Stylique Shopify app.
 *
 * Attaches X-Request-ID to every response:
 *   - If the incoming request already carries X-Request-ID, that value is used.
 *   - Otherwise a new UUID v4 is generated.
 *
 * Usage in a Remix loader/action:
 *   const requestId = getRequestId(request);
 *   const log = createLogger({ requestId, shopId });
 *
 * Usage in a custom Express server (server.ts):
 *   import { attachRequestId } from "~/lib/request-id.server";
 *   app.use(attachRequestId);
 */

import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Express middleware: attaches X-Request-ID to the request and response.
 * Call this early in your middleware chain before any route handlers.
 */
export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const existing = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof existing === "string" && existing.trim()
      ? existing.trim()
      : randomUUID();

  // Make it accessible via req.headers for downstream getRequestId() calls.
  req.headers[REQUEST_ID_HEADER] = id;
  // Echo back on every response so callers can correlate.
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

/**
 * Extract the request ID from a Remix/Fetch Request object.
 * Returns a new UUID if the header is absent (e.g. direct Remix loader calls
 * that don't pass through the Express middleware).
 */
export function getRequestId(request: Request | globalThis.Request): string {
  const header =
    "headers" in request && typeof (request as globalThis.Request).headers?.get === "function"
      ? (request as globalThis.Request).headers.get(REQUEST_ID_HEADER)
      : (request as Request).headers?.[REQUEST_ID_HEADER];

  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return randomUUID();
}
