// Admin settings — VTO render provider + visibility (Sprint 6 / D34).
//
// Two responsibilities on this page:
//   1. **Provider switch.** Default is "gemini-image" (free at quota,
//      mediocre fidelity). Per-brand opt-in to "replicate-idm-vton" when
//      photorealism matters. Stored on Plan.planFeaturesJson.tryon.providerKey.
//      Replicate flip is a no-op until REPLICATE_API_TOKEN is set in env.
//   2. **Recent renders panel.** 30-day TRYON_RENDER_* counts (requested /
//      completed / failed), success rate, p50 latency, current month's
//      personal-photo quota. Built from AnalyticsEvent + Plan, no extra table.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { getEffectivePlan } from "../lib/entitlement.server";
import { currentPeriodStart } from "@stylique/core";

const REPLICATE_AVAILABLE = Boolean(process.env.REPLICATE_API_TOKEN);

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true,
      plan: { select: { planFeaturesJson: true, tier: true } },
    },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const overrides = (shop.plan?.planFeaturesJson as { tryon?: { providerKey?: string } } | null) ?? null;
  const rawKey = overrides?.tryon?.providerKey;
  const providerKey: "replicate-catvton" | "replicate-idm-vton" | "gemini-image" =
    rawKey === "replicate-idm-vton" ? "replicate-idm-vton"
    : rawKey === "replicate-catvton" ? "replicate-catvton"
    : "gemini-image";

  // 30-day usage from AnalyticsEvent. Same query the dashboard uses elsewhere.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const events = await prisma.analyticsEvent.findMany({
    where: {
      shopId: shop.id,
      createdAt: { gte: since },
      name: { in: ["TRYON_RENDER_REQUESTED", "TRYON_RENDER_COMPLETED", "TRYON_RENDER_FAILED"] },
    },
    select: { name: true, payload: true },
  });

  let requested = 0, completed = 0, failed = 0;
  let totalLatency = 0, latencyCount = 0;
  const latencies: number[] = [];
  for (const e of events) {
    if (e.name === "TRYON_RENDER_REQUESTED")  requested++;
    if (e.name === "TRYON_RENDER_COMPLETED") {
      completed++;
      const lat = (e.payload as { latencyMs?: number } | null)?.latencyMs;
      if (typeof lat === "number" && lat > 0) { totalLatency += lat; latencyCount++; latencies.push(lat); }
    }
    if (e.name === "TRYON_RENDER_FAILED")     failed++;
  }
  latencies.sort((a, b) => a - b);
  const p50 = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;
  const successRate = (completed + failed) > 0 ? Math.round((completed * 100) / (completed + failed)) : null;

  // Personal-photo quota — same gate the runtime uses.
  const plan = await getEffectivePlan(shop.id);
  const personalCap = plan?.features.widget.monthlyTryOnPersonal ?? null;
  const personalAllowed = plan?.features.widget.personalPhotoTryOn ?? false;
  const usedThisMonthRow = await prisma.usageCounter.findFirst({
    where: { shopId: shop.id, metric: "TRYON_PERSONAL", periodStart: currentPeriodStart() },
    select: { count: true },
  });
  const usedThisMonth = usedThisMonthRow?.count ?? 0;

  return json({
    tier: shop.plan?.tier ?? "STARTER",
    providerKey,
    replicateAvailable: REPLICATE_AVAILABLE,
    saved: new URL(request.url).searchParams.get("saved") === "1",
    usage: {
      requested, completed, failed,
      successRate, p50LatencyMs: p50,
      personalAllowed, personalCap, usedThisMonth,
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const providerKey = String(formData.get("providerKey") ?? "");

  if (providerKey !== "gemini-image" && providerKey !== "replicate-idm-vton" && providerKey !== "replicate-catvton") {
    return json({ error: "Unknown provider" }, { status: 400 });
  }
  if ((providerKey === "replicate-idm-vton" || providerKey === "replicate-catvton") && !REPLICATE_AVAILABLE) {
    return json({ error: "Replicate is not configured on this Stylique instance. Ask Stylique to enable it before switching." }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: { select: { id: true, planFeaturesJson: true } } },
  });
  if (!shop?.plan) throw new Response("Plan not found", { status: 404 });

  const current = (shop.plan.planFeaturesJson as Record<string, unknown> | null) ?? {};
  const currentTryon = (current.tryon as Record<string, unknown> | undefined) ?? {};
  const next = { ...current, tryon: { ...currentTryon, providerKey } };

  await prisma.plan.update({
    where: { id: shop.plan.id },
    data: { planFeaturesJson: next as object },
  });
  return redirect("/app/settings/tryon?saved=1");
}

export default function TryOnSettingsPage() {
  const d = useLoaderData<typeof loader>();
  const ad = useActionData<typeof action>();
  const nav = useNavigation();
  const saving = nav.state === "submitting";

  const honest = d.providerKey === "replicate-catvton"
    ? "Real virtual try-on. Preserves garment identity. ~$0.012 per render."
    : d.providerKey === "replicate-idm-vton"
    ? "Photorealistic. Preserves the actual SKU. ~$0.03 per render."
    : "AI style preview. Reimagines the garment on a body. ~free at quota.";

  return (
    <div className="sq-shell">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <header className="sq-header">
        <div>
          <div className="sq-eyebrow"><span className="sq-eyebrow__dot" /> Stylique · Try-on settings</div>
          <h1 className="sq-h1"><span className="serif">Render</span><em className="serif"> engine.</em></h1>
          <p className="sq-sub">{honest}</p>
        </div>
      </header>

      {/* Usage panel */}
      <section className="sq-usage">
        <div className="sq-tile">
          <div className="mono">30-day renders</div>
          <div className="serif sq-tile__big">{d.usage.completed.toLocaleString()}</div>
          <div className="mono sq-tile__sub">{d.usage.requested} requested · {d.usage.failed} failed</div>
        </div>
        <div className="sq-tile">
          <div className="mono">Success rate</div>
          <div className="serif sq-tile__big">{d.usage.successRate == null ? "—" : `${d.usage.successRate}%`}</div>
          <div className="mono sq-tile__sub">last 30 days</div>
        </div>
        <div className="sq-tile">
          <div className="mono">p50 latency</div>
          <div className="serif sq-tile__big">{d.usage.p50LatencyMs == null ? "—" : `${(d.usage.p50LatencyMs / 1000).toFixed(1)}s`}</div>
          <div className="mono sq-tile__sub">render wall-clock</div>
        </div>
        <div className="sq-tile">
          <div className="mono">Personal-photo cap</div>
          <div className="serif sq-tile__big">
            {!d.usage.personalAllowed
              ? "Off"
              : d.usage.personalCap == null
                ? "Unlimited"
                : `${d.usage.usedThisMonth} / ${d.usage.personalCap}`}
          </div>
          <div className="mono sq-tile__sub">{d.tier} tier · this month</div>
        </div>
      </section>

      <Form method="post" className="sq-form">
        <div className="sq-field">
          <label htmlFor="providerKey">Render engine</label>
          <select id="providerKey" name="providerKey" defaultValue={d.providerKey}>
            <option value="replicate-catvton" disabled={!d.replicateAvailable}>
              Replicate CatVTON (recommended — best quality/cost, $0.012/render){d.replicateAvailable ? "" : " — not configured"}
            </option>
            <option value="gemini-image">Style preview · Gemini Image (default)</option>
            <option value="replicate-idm-vton" disabled={!d.replicateAvailable}>
              Photorealistic · Replicate IDM-VTON (~$0.03/render){d.replicateAvailable ? "" : " — not configured"}
            </option>
          </select>
          <small>
            <strong>Replicate CatVTON</strong> is the recommended engine — real garment try-on at ~$0.012/render (~10-15s). Best quality-to-cost ratio; preserves garment identity well.
            <br />
            <strong>Gemini Image</strong> is free at quota and fast (~4-8s) but reimagines the garment rather than preserving SKU pixels — label it "Style Preview" to shoppers.
            <br />
            <strong>Replicate IDM-VTON</strong> preserves the actual garment and looks photorealistic, but costs ~$0.03 per render and takes 15-30s. Use when your shoppers need fidelity, not just inspiration.
          </small>
        </div>

        {ad?.error && <div className="sq-error">{ad.error}</div>}
        {d.saved && <div className="sq-ok">Saved. Next render uses the new engine.</div>}
        <button className="sq-cta" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </Form>
    </div>
  );
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
:root {
  --sq-bg: #08070A; --sq-surface: #14111A; --sq-line: rgba(255,255,255,.08);
  --sq-line-acc: rgba(201,181,255,.35); --sq-text: #F4F2EE; --sq-mute: #8E8A99;
  --sq-grad: linear-gradient(135deg, #8B5CF6, #E879C8);
}
.sq-shell { font-family: "Manrope", system-ui, sans-serif; background: var(--sq-bg); color: var(--sq-text); min-height: 100vh; padding: 36px 40px; }
.sq-header { margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--sq-line); }
.serif { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; }
.mono { font-family: "JetBrains Mono", monospace; font-size: 10.5px; letter-spacing: 1.4px; color: var(--sq-mute); text-transform: uppercase; }
.sq-eyebrow { font-size: 10.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--sq-mute); display: inline-flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sq-eyebrow__dot { width: 6px; height: 6px; border-radius: 999px; background: #8B5CF6; box-shadow: 0 0 8px #8B5CF6; }
.sq-h1 { font-size: 52px; line-height: 1; margin: 0; font-weight: 400; }
.sq-h1 em { font-style: italic; background: var(--sq-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-sub { font-size: 13px; color: var(--sq-mute); margin: 12px 0 0; }
.sq-usage { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 32px; }
.sq-tile { background: var(--sq-surface); border: 1px solid var(--sq-line); border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 6px; }
.sq-tile__big { font-size: 32px; line-height: 1.1; margin-top: 4px; }
.sq-tile__sub { margin-top: 4px; }
.sq-form { max-width: 620px; display: flex; flex-direction: column; gap: 22px; }
.sq-field { display: flex; flex-direction: column; gap: 6px; }
.sq-field label { font-size: 12.5px; color: var(--sq-text); }
.sq-field small { font-size: 11.5px; color: var(--sq-mute); line-height: 1.6; }
.sq-field select { background: var(--sq-surface); color: var(--sq-text); border: 1px solid var(--sq-line); border-radius: 10px; padding: 11px 14px; font-family: inherit; font-size: 14px; outline: none; }
.sq-field select:focus { border-color: var(--sq-line-acc); }
.sq-cta { align-self: flex-start; padding: 11px 22px; border: 0; border-radius: 999px; background: var(--sq-grad); color: #fff; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 18px rgba(139,92,246,.35); }
.sq-cta:disabled { opacity: .5; cursor: not-allowed; }
.sq-error { padding: 10px 14px; color: #E879C8; background: rgba(232,121,200,.08); border: 1px solid rgba(232,121,200,.3); border-radius: 10px; font-size: 13px; }
.sq-ok    { padding: 10px 14px; color: #B6F0C8; background: rgba(120,220,160,.08); border: 1px solid rgba(120,220,160,.3); border-radius: 10px; font-size: 13px; }
`;
