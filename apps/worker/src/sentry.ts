// Worker-side error reporting. Uses @sentry/node when the package and DSN are
// available, and always writes structured stderr logs for platform log drains.

const DSN = process.env.SENTRY_DSN;
const IS_PROD = process.env.NODE_ENV === "production";

let _initialized = false;
let _sentry: {
  captureException: (err: unknown, opts?: { extra?: Record<string, unknown>; tags?: Record<string, string> }) => void;
} | null = null;

async function initSentrySdk(): Promise<void> {
  if (!DSN) return;
  try {
    const Sentry = await import("@sentry/node" as string) as {
      init: (opts: { dsn: string; tracesSampleRate: number }) => void;
      captureException: (err: unknown, opts?: { extra?: Record<string, unknown>; tags?: Record<string, string> }) => void;
    };
    Sentry.init({ dsn: DSN, tracesSampleRate: 0.1 });
    _sentry = Sentry;
    process.stderr.write(JSON.stringify({ level: "info", msg: "worker_sentry_initialized", dsn_present: true }) + "\n");
  } catch {
    process.stderr.write(JSON.stringify({ level: "warn", msg: "worker_sentry_sdk_unavailable", dsn_present: true }) + "\n");
  }
}

export function initSentry(): void {
  if (_initialized) return;
  _initialized = true;

  if (IS_PROD && DSN) void initSentrySdk();

  // Capture every unhandled promise rejection. The handler logs to stderr and
  // does NOT exit — BullMQ's job failure handling takes care of retries.
  process.on("unhandledRejection", (reason) => {
    reportJobError(reason, { queue: "unknown", jobId: "unknown", shopId: "unknown" });
  });

  // Capture uncaught synchronous exceptions. The handler logs then exits 1 so
  // the process manager (Docker / PM2 / Fly.io) can restart the worker.
  process.on("uncaughtException", (err) => {
    reportJobError(err, { queue: "unknown", jobId: "unknown", shopId: "unknown" });
    process.exit(1);
  });
}

export interface JobErrorContext {
  queue: string;
  jobId: string;
  shopId: string;
  [key: string]: unknown;
}

export function reportJobError(err: unknown, context: JobErrorContext): void {
  const payload = {
    level: "error",
    msg: "worker_job_error",
    error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    context,
    ts: new Date().toISOString(),
  };
  process.stderr.write(JSON.stringify(payload) + "\n");
  _sentry?.captureException(err, {
    extra: context,
    tags: { queue: String(context.queue), shopId: String(context.shopId) },
  });
}
