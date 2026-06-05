// The learning loop, made visible to the brand.
//
// GET → aggregated catalog gaps (unmet demand → reorder/stock/price decisions),
// what shoppers come to Mira for (intent histogram), and the discovery hit-rate.
// This is the moat the brand is paying for: every Mira conversation tightens
// what the store should carry next. Each number names the decision it informs
// (CLAUDE.md §11). Read live — no caching — so the dashboard reflects the very
// last conversation.

import { NextResponse } from "next/server";
import { aggregateInsights } from "../../../lib/mira-signals.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const insights = await aggregateInsights();
    return NextResponse.json(insights);
  } catch (err) {
    console.error("[mira-insights] error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "insights_unavailable" }, { status: 500 });
  }
}
