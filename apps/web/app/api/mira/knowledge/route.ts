// Admin-authored knowledge base API for Mira (demo).
//
// GET    → list current knowledge entries (open; the widget reads these to
//          render the admin drawer).
// POST   → add a note. Admin-gated via isAdminAuthorized.
// DELETE → remove a note by id. Admin-gated.
//
// In production this is the admin dashboard writing brand DNA / active sales;
// here it's a flat-file store (see lib/mira-knowledge.server.ts).

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listKnowledge,
  addKnowledge,
  removeKnowledge,
  isAdminAuthorized,
} from "../../../lib/mira-knowledge.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await listKnowledge();
  return NextResponse.json({ entries });
}

const AddSchema = z.object({ text: z.string().min(2).max(600) });

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const entry = await addKnowledge(parsed.data.text);
  return NextResponse.json({ entry });
}

const DelSchema = z.object({ id: z.string().min(1).max(80) });

export async function DELETE(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = DelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  await removeKnowledge(parsed.data.id);
  return NextResponse.json({ ok: true });
}
