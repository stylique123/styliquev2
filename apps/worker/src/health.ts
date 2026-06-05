// Worker health-check HTTP server.
//
// Exported as a factory so callers can pass in the queue handles that were
// already created in index.ts (avoids opening extra Redis connections).
//
// Usage (index.ts):
//   import { startHealthServer } from "./health.js";
//   const { server } = startHealthServer(healthQueues);
//   // … in shutdown: await new Promise(r => server.close(r));
//
// The existing inline health server in index.ts already covers this fully;
// this module is the extracted, standalone version for use in isolated
// deployments or tests that don't want to boot all workers.

import * as http from "node:http";
import { Queue } from "bullmq";

export type HealthQueueMap = Record<string, Queue>;

export interface HealthServerHandle {
  server: http.Server;
}

/**
 * Start an HTTP server on WORKER_HEALTH_PORT (default 3001) that responds to
 * GET /health and GET / with live BullMQ queue job-count data.
 *
 * @param queues  Map of queue-name → Queue handle (read-only, no extra Redis conn needed).
 * @returns       { server } so callers can close gracefully on SIGTERM.
 */
export function startHealthServer(queues: HealthQueueMap): HealthServerHandle {
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 3001);

  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }

    const url = req.url?.split("?")[0];
    if (url !== "/health" && url !== "/") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    try {
      const entries = await Promise.all(
        Object.entries(queues).map(async ([name, q]) => {
          const counts = await q.getJobCounts("waiting", "active", "failed");
          return [name, counts] as const;
        }),
      );

      const queueStats = Object.fromEntries(entries);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
          queues: queueStats,
        }),
      );
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "redis_unavailable" }));
    }
  });

  server.listen(port, () => {
    console.log(`Worker health server listening on :${port}`);
  });

  server.on("error", (err: Error) => {
    console.error(`[worker-health] server error: ${err.message}`);
  });

  return { server };
}
