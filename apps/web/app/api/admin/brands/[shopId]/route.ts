import { NextResponse } from "next/server";
import { prisma } from "~/lib/db";
import { PlanTier } from "@stylique/db";

function checkAuth(req: Request): boolean {
  const adminSecret = process.env.STYLIQUE_ADMIN_SECRET;
  if (!adminSecret) return true; // dev: no secret = open
  const auth = req.headers.get("Authorization");
  return auth === `Bearer ${adminSecret}`;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ shopId: string }> }
) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { shopId } = await params;
  const body = (await req.json()) as {
    action: "change_tier" | "terminate" | "suspend";
    tier?: string;
  };

  try {
    if (body.action === "change_tier") {
      if (!body.tier) {
        return NextResponse.json({ ok: false, error: "tier required" }, { status: 400 });
      }
      await prisma.plan.update({
        where: { shopId },
        data: { tier: body.tier as PlanTier },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "terminate") {
      await prisma.shop.update({
        where: { id: shopId },
        data: { uninstalledAt: new Date() },
      });
      await prisma.notification.create({
        data: {
          shopId,
          kind: "APP_UNINSTALLED",
          payload: { terminatedBy: "admin", at: new Date().toISOString() },
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "suspend") {
      // Use a notification entry as a suspension flag (no schema migration needed)
      await prisma.notification.create({
        data: {
          shopId,
          kind: "APP_UNINSTALLED",
          payload: { suspendedBy: "admin", at: new Date().toISOString(), type: "suspension" },
        },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
