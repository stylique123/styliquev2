// Demo-side chat endpoint — Mira (the Brain) talking inside apps/web.
//
// Mirrors the production `postChat` in apps/shopify-app but without Prisma,
// without Shopify auth, and without any storage. The browser keeps the
// conversation history client-side and replays it on every turn. The Brain
// orchestrator, prompt, provider, and three demo-safe tools are the same
// modules the production storefront uses.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { BrainMessage } from "@stylique/ai";
import { buildDemoBrainContext, getDemoBrain } from "../../lib/brain-demo.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MessageSchema = z.object({
  role: z.enum(["user", "model"]),
  text: z.string().max(2000),
});

const BodySchema = z.object({
  sessionId: z.string().min(8).max(64),
  messages: z.array(MessageSchema).min(1).max(40),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { sessionId, messages } = parsed.data;
  const brain = getDemoBrain();
  const ctx = buildDemoBrainContext(sessionId);

  // Hydrate ctx.recentHistory with the older turns so the prompt can ground
  // on them; pass the latest user message as the live input.
  ctx.recentHistory = messages.slice(0, -1).map(
    (m): BrainMessage => ({ role: m.role, text: m.text }),
  );

  try {
    const out = await brain.run({
      ctx,
      messages: messages.map((m): BrainMessage => ({ role: m.role, text: m.text })),
    });
    return NextResponse.json({
      reply: out.reply,
      combos: out.combos,
      actions: out.actions,
      latencyMs: out.latencyMs,
      modelUsed: out.modelUsed,
      toolsCalled: out.toolsCalled,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "brain_failed", message },
      { status: 500 },
    );
  }
}
