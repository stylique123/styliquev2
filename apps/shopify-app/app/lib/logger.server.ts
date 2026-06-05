/**
 * Structured logger for the Stylique Shopify app (server-only).
 *
 * Usage:
 *   import { logger, createLogger } from "~/lib/logger.server";
 *   logger.info("Server started");
 *   const log = createLogger({ shopId: "shop_abc", component: "brain" });
 *   log.error({ err: error.message }, "Tool handler failed");
 */

export type Logger = {
  info: (fieldsOrMessage?: unknown, message?: string) => void;
  warn: (fieldsOrMessage?: unknown, message?: string) => void;
  error: (fieldsOrMessage?: unknown, message?: string) => void;
  debug: (fieldsOrMessage?: unknown, message?: string) => void;
  child: (bindings: Record<string, string>) => Logger;
};

function write(level: "info" | "warn" | "error" | "debug", bindings: Record<string, string>, fieldsOrMessage?: unknown, message?: string) {
  const payload = typeof fieldsOrMessage === "string"
    ? { msg: fieldsOrMessage, ...bindings }
    : { ...(fieldsOrMessage && typeof fieldsOrMessage === "object" ? fieldsOrMessage as Record<string, unknown> : {}), msg: message, ...bindings };
  const line = JSON.stringify({ level, time: new Date().toISOString(), service: "shopify-app", ...payload });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function makeLogger(bindings: Record<string, string> = {}): Logger {
  return {
    info: (fieldsOrMessage?: unknown, message?: string) => write("info", bindings, fieldsOrMessage, message),
    warn: (fieldsOrMessage?: unknown, message?: string) => write("warn", bindings, fieldsOrMessage, message),
    error: (fieldsOrMessage?: unknown, message?: string) => write("error", bindings, fieldsOrMessage, message),
    debug: (fieldsOrMessage?: unknown, message?: string) => {
      if ((process.env.LOG_LEVEL ?? "info") === "debug") write("debug", bindings, fieldsOrMessage, message);
    },
    child: (next: Record<string, string>) => makeLogger({ ...bindings, ...next }),
  };
}

export const logger = makeLogger();

export interface LogContext {
  shopId?: string;
  requestId?: string;
  component?: string;
}

/**
 * Create a child logger pre-bound to a fixed context.
 * Additional fields can be included on individual log calls.
 *
 * @example
 *   const log = createLogger({ shopId, component: "brain" });
 *   log.error({ err: error.message, toolName }, "Tool handler threw");
 */
export function createLogger(context: LogContext): Logger {
  const bindings: Record<string, string> = {};
  if (context.shopId)    bindings["shopId"]    = context.shopId;
  if (context.requestId) bindings["requestId"] = context.requestId;
  if (context.component) bindings["component"] = context.component;
  return logger.child(bindings);
}
