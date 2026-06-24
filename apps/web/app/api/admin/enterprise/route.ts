import { NextResponse } from "next/server";
import { prisma } from "~/lib/db";
import { SupportLevel, PlanTier, AnalyticsLevel } from "@stylique/db";
import { PLAN_DEFAULTS, PLAN_FEATURES } from "@stylique/core";

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
    tier?: string;
    comp?: boolean;
    monthlyTryOnPersonal?: number;
    monthlyTryOnBody?: number;
    monthlyStylistTurns?: number;
    monthlyStyleRecs?: number;
    monthlyFitRecs?: number;
    supportLevel?: string;
    notes?: string;
  };

  try {
    const domain = normalizeShopifyDomain(body.domain);
    if (!domain) {
      return NextResponse.json({ ok: false, error: "valid shop domain required" }, { status: 400 });
    }

    const tier = normalizeTier(body.tier ?? "ULTIMATE");
    if (!tier) {
      return NextResponse.json({ ok: false, error: "tier must be STARTER, GROWTH, or ULTIMATE" }, { status: 400 });
    }

    const supportLevel = (body.supportLevel as SupportLevel) ?? "DEDICATED";
    const defaults = PLAN_DEFAULTS[tier];
    const features = PLAN_FEATURES[tier];
    const comp = body.comp ?? true;

    const shop = await prisma.shop.upsert({
      where: { shopifyDomain: domain },
      update: {},
      create: {
        shopifyDomain: domain,
        accessToken: "manual-provisioning-pending",
        scopes: "",
        uninstalledAt: new Date(),
      },
      select: {
        id: true,
        uninstalledAt: true,
        plan: { select: { planFeaturesJson: true } },
      },
    });

    const current = (shop.plan?.planFeaturesJson as Record<string, unknown> | null) ?? {};
    const provisioningStatus = shop.uninstalledAt ? "PENDING_INSTALL" : "ACTIVE_INSTALLED";
    const planFeaturesJson = {
      ...current,
      comp,
      billingActive: comp,
      billing: {
        ...((typeof current.billing === "object" && current.billing ? current.billing : {}) as Record<string, unknown>),
        status: comp ? "ops_comp" : "pending",
        tier,
        source: "super_admin_enterprise",
        updatedAt: new Date().toISOString(),
      },
      provisioning: {
        ...((typeof current.provisioning === "object" && current.provisioning ? current.provisioning : {}) as Record<string, unknown>),
        status: provisioningStatus,
        updatedBy: "super_admin",
        updatedAt: new Date().toISOString(),
      },
    };

    await prisma.plan.upsert({
      where: { shopId: shop.id },
      update: {
        tier,
        monthlyTryOnPersonal: body.monthlyTryOnPersonal ?? defaults.monthlyTryOnPersonal,
        monthlyTryOnBody: body.monthlyTryOnBody ?? defaults.monthlyTryOnBody,
        monthlyStylistTurns: body.monthlyStylistTurns ?? features.stylist.monthlyTurns,
        monthlyStyleRecs: body.monthlyStyleRecs ?? defaults.monthlyStyleRecs,
        monthlyFitRecs: body.monthlyFitRecs ?? defaults.monthlyFitRecs,
        analyticsLevel: features.analytics.level as AnalyticsLevel,
        supportLevel,
        planFeaturesJson,
      },
      create: {
        shopId: shop.id,
        tier,
        monthlyTryOnPersonal: body.monthlyTryOnPersonal ?? defaults.monthlyTryOnPersonal,
        monthlyTryOnBody: body.monthlyTryOnBody ?? defaults.monthlyTryOnBody,
        monthlyStylistTurns: body.monthlyStylistTurns ?? features.stylist.monthlyTurns,
        monthlyStyleRecs: body.monthlyStyleRecs ?? defaults.monthlyStyleRecs,
        monthlyFitRecs: body.monthlyFitRecs ?? defaults.monthlyFitRecs,
        analyticsLevel: features.analytics.level as AnalyticsLevel,
        supportLevel,
        planFeaturesJson,
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
            tier,
            comp,
            provisioningStatus,
            notes: body.notes,
            createdBy: "admin",
            at: new Date().toISOString(),
          },
        },
      });
    }

    return NextResponse.json({ ok: true, shopId: shop.id, provisioningStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function normalizeShopifyDomain(input: string): string | null {
  const cleaned = input
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
  const domain = cleaned.endsWith(".myshopify.com") ? cleaned : `${cleaned}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) return null;
  return domain;
}

function normalizeTier(input: string): PlanTier | null {
  const tier = input.trim().toUpperCase();
  return tier === "STARTER" || tier === "GROWTH" || tier === "ULTIMATE" ? tier : null;
}
