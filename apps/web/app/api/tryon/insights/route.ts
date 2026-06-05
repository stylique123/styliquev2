// Try-on render health, made visible to the operator.
//
// GET → aggregated render attempts: error-rate, cache-hit-rate, latency, and —
// critically — the error classes ranked by recency-weighted intensity, each with
// a concrete remediation. This is the self-healing loop the founder asked for:
// "when an error comes we should be able to fix it / automatically learn from
// this." Read live — no caching — so the dashboard reflects the very last render.

import { NextResponse } from "next/server";
import { aggregateTryonInsights } from "../../../lib/tryon-log.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const insights = await aggregateTryonInsights();
    return NextResponse.json(insights);
  } catch (err) {
    console.error(
      "[tryon-insights] error",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "insights_unavailable" }, { status: 500 });
  }
}
