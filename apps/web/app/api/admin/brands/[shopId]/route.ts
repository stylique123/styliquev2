import { NextResponse } from "next/server";
import { prisma } from "~/lib/db";
import { PlanTier } from "@stylique/db";
import { PLAN_DEFAULTS, PLAN_FEATURES } from "@stylique/core";

function checkAuth(req: Request): boolean {
  const adminSecret = process.env.STYLIQUE_ADMIN_SECRET;
  // SECURITY (audit P0): fail CLOSED in production. With no secret set, prod
  // denies every request (was `return true` → world-writable: anyone could
  // suspend/terminate/retier any brand by shopId). Dev stays open.
  if (!adminSecret) return process.env.NODE_ENV !== "production";
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
    comp?: boolean;
  };

  try {
    if (body.action === "change_tier") {
      if (!body.tier) {
        return NextResponse.json({ ok: false, error: "tier required" }, { status: 400 });
      }
      const tier = normalizeTier(body.tier);
      if (!tier) {
        return NextResponse.json({ ok: false, error: "invalid tier" }, { status: 400 });
      }
      const existing = await prisma.plan.findUnique({
        where: { shopId },
        select: { planFeaturesJson: true },
      });
      const current = (existing?.planFeaturesJson as Record<string, unknown> | null) ?? {};
      const comp = body.comp ?? current.comp === true;
      const defaults = PLAN_DEFAULTS[tier];
      const features = PLAN_FEATURES[tier];
      await prisma.plan.upsert({
        where: { shopId },
        update: {
          tier,
          monthlyTryOnPersonal: defaults.monthlyTryOnPersonal,
          monthlyTryOnBody: defaults.monthlyTryOnBody,
          monthlyStylistTurns: features.stylist.monthlyTurns,
          monthlyStyleRecs: defaults.monthlyStyleRecs,
          monthlyFitRecs: defaults.monthlyFitRecs,
          analyticsLevel: features.analytics.level,
          planFeaturesJson: {
            ...current,
            comp,
            billingActive: comp || current.billingActive === true,
            billing: {
              ...((typeof current.billing === "object" && current.billing ? current.billing : {}) as Record<string, unknown>),
              status: comp ? "ops_comp" : "pending",
              tier,
              source: "super_admin_brand_action",
              updatedAt: new Date().toISOString(),
            },
          },
        },
        create: {
          shopId,
          tier,
          monthlyTryOnPersonal: defaults.monthlyTryOnPersonal,
          monthlyTryOnBody: defaults.monthlyTryOnBody,
          monthlyStylistTurns: features.stylist.monthlyTurns,
          monthlyStyleRecs: defaults.monthlyStyleRecs,
          monthlyFitRecs: defaults.monthlyFitRecs,
          analyticsLevel: features.analytics.level,
          planFeaturesJson: {
            comp,
            billingActive: comp,
            billing: {
              status: comp ? "ops_comp" : "pending",
              tier,
              source: "super_admin_brand_action",
              updatedAt: new Date().toISOString(),
            },
          },
        },
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

function normalizeTier(input: string): PlanTier | null {
  const tier = input.trim().toUpperCase();
  return tier === "STARTER" || tier === "GROWTH" || tier === "ULTIMATE" ? tier : null;
}
