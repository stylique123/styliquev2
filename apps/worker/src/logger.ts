/**
 * Structured logger for the Stylique worker process.
 *
 * Usage:
 *   import { logger, createLogger } from "./logger.js";
 *   const log = createLogger({ queue: "catalog-sync", shopId, jobId: job.id });
 *   log.info("Job started");
 *   log.error({ err: error.message }, "Job failed");
 */

export type Logger = {
  info: (fieldsOrMessage?: unknown, message?: string) => void;
  warn: (fieldsOrMessage?: unknown, message?: string) => void;
  error: (fieldsOrMessage?: unknown, message?: string) => void;
  debug: (fieldsOrMessage?: unknown, message?: string) => void;
  child: (bindings: Record<string, unknown>) => Logger;
};

function write(level: "info" | "warn" | "error" | "debug", bindings: Record<string, unknown>, fieldsOrMessage?: unknown, message?: string) {
  const payload = typeof fieldsOrMessage === "string"
    ? { msg: fieldsOrMessage, ...bindings }
    : { ...(fieldsOrMessage && typeof fieldsOrMessage === "object" ? fieldsOrMessage as Record<string, unknown> : {}), msg: message, ...bindings };
  const line = JSON.stringify({ level, time: new Date().toISOString(), service: "worker", ...payload });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function makeLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    info: (fieldsOrMessage?: unknown, message?: string) => write("info", bindings, fieldsOrMessage, message),
    warn: (fieldsOrMessage?: unknown, message?: string) => write("warn", bindings, fieldsOrMessage, message),
    error: (fieldsOrMessage?: unknown, message?: string) => write("error", bindings, fieldsOrMessage, message),
    debug: (fieldsOrMessage?: unknown, message?: string) => {
      if ((process.env.LOG_LEVEL ?? "info") === "debug") write("debug", bindings, fieldsOrMessage, message);
    },
    child: (next: Record<string, unknown>) => makeLogger({ ...bindings, ...next }),
  };
}

export const logger = makeLogger();

export interface WorkerLogContext {
  queue?: string;
  jobId?: string | number | undefined;
  shopId?: string;
  component?: string;
}

/**
 * Create a child logger pre-bound to a job/queue context.
 * Add per-call fields (err, productId, etc.) directly on the log call.
 *
 * @example
 *   const log = createLogger({ queue: "catalog-sync", shopId, jobId: job.id });
 *   log.info({ productCount: 42 }, "Sync complete");
 *   log.error({ err: error.message }, "Sync failed");
 */
export function createLogger(context: WorkerLogContext): Logger {
  const bindings: Record<string, unknown> = {};
  if (context.queue)     bindings["queue"]     = context.queue;
  if (context.jobId != null) bindings["jobId"] = String(context.jobId);
  if (context.shopId)    bindings["shopId"]    = context.shopId;
  if (context.component) bindings["component"] = context.component;
  return logger.child(bindings);
}
