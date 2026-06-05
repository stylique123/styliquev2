import { NextResponse } from "next/server";
import { z } from "zod";
import { recordConversion } from "../../../lib/mira-signals.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A REAL add-to-bag conversion — fired by the client when the shopper actually
// adds a piece to the bag (NOT when Mira merely offers to). This is the honest
// denominator for the learning loop's "recommendation → bag" rate (D60): a
// conversion row is written only on a genuine add, tied to the product handle.
const Body = z.object({ productHandle: z.string().min(1).max(120) });

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  void recordConversion(parsed.data.productHandle).catch(() => {});
  return NextResponse.json({ ok: true });
}
