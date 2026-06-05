/**
 * Mira Training Loop API
 * GET  /api/mira/train  — returns latest training report + behavioral memory
 * POST /api/mira/train  — triggers a training cycle (spawns mira-self-training.mjs)
 *
 * The training loop runs as a child process so it doesn't block the server.
 * Results are written to apps/web/data/mira-training-report.json and read back here.
 */

import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_DIR = join(process.cwd(), "data");
const REPORT_PATH = join(DATA_DIR, "mira-training-report.json");
const MEMORY_PATH = join(DATA_DIR, "mira-behavioral-memory.json");
const HISTORY_PATH = join(DATA_DIR, "mira-training-history.json");

function readJson(path: string): unknown {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export async function GET() {
  const report = readJson(REPORT_PATH);
  const memory = readJson(MEMORY_PATH);
  const history = readJson(HISTORY_PATH);

  if (!report && !memory) {
    return NextResponse.json({
      status: "no_data",
      message: "No training data yet. Run: node apps/web/scripts/mira-self-training.mjs",
    });
  }

  return NextResponse.json({ report, memory, history });
}

export async function POST(req: Request) {
  let scenarios = 30;
  let cycles = 1;
  try {
    const body = await req.json() as { scenarios?: number; cycles?: number };
    if (body.scenarios) scenarios = Math.min(body.scenarios, 100);
    if (body.cycles) cycles = Math.min(body.cycles, 5);
  } catch { /* use defaults */ }

  // Spawn training loop as child process — doesn't block the response.
  const scriptPath = join(process.cwd(), "scripts", "mira-self-training.mjs");
  if (!existsSync(scriptPath)) {
    return NextResponse.json({ error: "training_script_not_found", path: scriptPath }, { status: 404 });
  }

  const child = spawn("node", [scriptPath, "--scenarios", String(scenarios), "--cycles", String(cycles)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({
    status: "training_started",
    pid: child.pid,
    scenarios,
    cycles,
    message: `Training loop started. Check /api/mira/train (GET) in ~${Math.ceil(scenarios * 0.7)}s for results.`,
    reportPath: "apps/web/data/mira-training-report.json",
  });
}
