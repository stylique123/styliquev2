// Fashion intelligence — the four-pillar analytics the brand buys.
//
// GET → Consumer / Conversion / Fit-&-Confidence / Style-&-Merchandising
// intelligence. Every distribution is grounded in the real 12-product catalog
// and the real learning-loop signals; modelled engagement is deterministic
// (seeded) so the demo is alive on first load and stable across reloads.
// Each metric names the decision it informs (CLAUDE.md §11). Read live — no
// caching — so the dashboard reflects the very last conversation.

import { NextResponse } from "next/server";
import { buildFashionIntelligence } from "../../../lib/mira-intelligence.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const intel = await buildFashionIntelligence();
    return NextResponse.json(intel);
  } catch (err) {
    console.error("[mira-intelligence] error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "intelligence_unavailable" }, { status: 500 });
  }
}
