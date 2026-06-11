import { NextResponse } from "next/server";
import { prisma } from "~/lib/db";
import { SupportLevel } from "@stylique/db";

function checkAuth(req: Request): boolean {
  const adminSecret = process.env.STYLIQUE_ADMIN_SECRET;
  // SECURITY (audit P0): fail CLOSED in production. With no secret set, prod
  // denies every request (was `return true` → world-writable admin plane:
  // anyone could overwrite enterprise quotas). Dev stays open for convenience.
  if (!adminSecret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("Authorization");
  return auth === `Bearer ${adminSecret}`;
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    domain: string;
    monthlyTryOnPersonal?: number;
    monthlyTryOnBody?: number;
    monthlyCreatives?: number;
    monthlyStyleRecs?: number;
    monthlyFitRecs?: number;
    supportLevel?: string;
    notes?: string;
  };

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: body.domain },
    });

    if (!shop) {
      return NextResponse.json(
        { ok: false, error: `Shop not found: ${body.domain}` },
        { status: 404 }
      );
    }

    const supportLevel = (body.supportLevel as SupportLevel) ?? "DEDICATED";

    await prisma.plan.upsert({
      where: { shopId: shop.id },
      update: {
        tier: "ULTIMATE",
        monthlyTryOnPersonal: body.monthlyTryOnPersonal ?? null,
        monthlyTryOnBody: body.monthlyTryOnBody ?? null,
        monthlyCreatives: body.monthlyCreatives ?? null,
        monthlyStyleRecs: body.monthlyStyleRecs ?? null,
        monthlyFitRecs: body.monthlyFitRecs ?? null,
        supportLevel,
      },
      create: {
        shopId: shop.id,
        tier: "ULTIMATE",
        monthlyTryOnPersonal: body.monthlyTryOnPersonal ?? null,
        monthlyTryOnBody: body.monthlyTryOnBody ?? null,
        monthlyCreatives: body.monthlyCreatives ?? null,
        monthlyStyleRecs: body.monthlyStyleRecs ?? null,
        monthlyFitRecs: body.monthlyFitRecs ?? null,
        supportLevel,
      },
    });

    // Leave an audit note in notifications
    if (body.notes) {
      await prisma.notification.create({
        data: {
          shopId: shop.id,
          kind: "PLAN_RENEWED",
          payload: {
            type: "enterprise_created",
            notes: body.notes,
            createdBy: "admin",
            at: new Date().toISOString(),
          },
        },
      });
    }

    return NextResponse.json({ ok: true, shopId: shop.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
