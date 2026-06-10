// Brand DNA settings — /app/settings/brand
//
// Lets brand admins review and enrich the AI creative director's understanding
// of their brand aesthetic. Four sections:
//
//   1. Brand Identity   — auto-computed palette + tone from catalog; refresh button
//   2. Instagram        — ZIP upload to feed real campaign imagery into DNA
//   3. Reference Assets — upload mood board / campaign photos directly
//   4. Campaign Overrides — per-campaign DNA snapshots for Mira and recommendations

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect, unstable_parseMultipartFormData, unstable_createFileUploadHandler } from "@remix-run/node";
import { Form, useLoaderData, useActionData, useNavigation, useFetcher } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { getEffectivePlan } from "../lib/entitlement.server";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const STORAGE_PATH = process.env.STORAGE_PATH ?? "/tmp/stylique-storage";

let _conn: IORedis | null = null;
let _instagramQueue: Queue | null = null;
let _dnaQueue: Queue | null = null;
function instagramQueue(): Queue {
  if (!_instagramQueue) {
    _conn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _instagramQueue = new Queue("brand-instagram", { connection: _conn });
  }
  return _instagramQueue;
}
function dnaQueue(): Queue {
  if (!_dnaQueue) {
    if (!_conn) _conn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _dnaQueue = new Queue("brand-dna-catalog", { connection: _conn });
  }
  return _dnaQueue;
}

// ─── Asset reference limits by tier ──────────────────────────────────────────
const REFERENCE_ASSET_LIMIT: Record<string, number> = {
  STARTER: 10,
  GROWTH: 30,
  ULTIMATE: Infinity,
};

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true,
      plan: { select: { tier: true } },
      brandProfile: {
        select: {
          id: true,
          paletteJson: true,
          toneJson: true,
          trainedAt: true,
          referenceAssets: {
            select: { id: true, url: true, kind: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
        },
      },
      brandSources: {
        select: { id: true, kind: true, status: true, lastSyncedAt: true, error: true },
      },
    },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const tier = (shop.plan?.tier ?? "STARTER") as string;
  const profile = shop.brandProfile;
  const tone = (profile?.toneJson as Record<string, unknown> | null) ?? null;
  const palette = (profile?.paletteJson as { hex?: string[] } | null)?.hex ?? [];
  const campaignOverrides = (tone?.campaignOverrides as Array<{
    name: string; active: boolean; createdAt?: string
  }> | undefined) ?? [];

  // Count products for the "computed from" label
  const productCount = await prisma.product.count({ where: { shopId: shop.id } });
  const refAssets = profile?.referenceAssets ?? [];

  const instagramSource = shop.brandSources.find((s) => s.kind === "INSTAGRAM");
  const shopifySource = shop.brandSources.find((s) => s.kind === "SHOPIFY");

  const url = new URL(request.url);

  return json({
    tier,
    productCount,
    trainedAt: profile?.trainedAt?.toISOString() ?? null,
    palette,
    tone: {
      moodAdjectives: (tone?.moodAdjectives as string[] | undefined) ?? [],
      lighting: (tone?.lighting as string | undefined) ?? null,
      modelArchetype: (tone?.modelArchetype as string | undefined) ?? null,
      composition: (tone?.composition as string | undefined) ?? null,
      dominantFabrics: (tone?.dominantFabrics as string[] | undefined) ?? [],
      seasonality: (tone?.seasonality as string | undefined) ?? null,
      pricePositioning: (tone?.pricePositioning as string | undefined) ?? null,
    },
    referenceAssets: refAssets.map((a) => ({
      id: a.id,
      url: a.url,
      createdAt: a.createdAt.toISOString(),
    })),
    referenceLimit: REFERENCE_ASSET_LIMIT[tier] ?? 10,
    campaignOverrides,
    instagramStatus: instagramSource?.status ?? null,
    instagramLastSyncedAt: instagramSource?.lastSyncedAt?.toISOString() ?? null,
    instagramError: instagramSource?.error ?? null,
    shopifySourceStatus: shopifySource?.status ?? null,
    saved: url.searchParams.get("saved") === "1",
    toast: url.searchParams.get("toast") ?? null,
  });
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: { select: { tier: true } }, brandProfile: { select: { id: true } } },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const contentType = request.headers.get("content-type") ?? "";

  // ─── Multipart (file uploads) ──────────────────────────────────────────
  if (contentType.includes("multipart/form-data")) {
    const storagePath = join(STORAGE_PATH, "brand", shop.id);
    await mkdir(storagePath, { recursive: true });

    const uploadHandler = unstable_createFileUploadHandler({
      directory: storagePath,
      maxPartSize: 200 * 1024 * 1024, // 200MB for Instagram ZIP
    });
    const formData = await unstable_parseMultipartFormData(request, uploadHandler);
    const intent = String(formData.get("intent") ?? "");

    if (intent === "upload_instagram") {
      const file = formData.get("instagram_zip") as File | null;
      if (!file || file.size === 0) {
        return json({ error: "No ZIP file uploaded" }, { status: 400 });
      }
      if (!file.name.toLowerCase().endsWith(".zip")) {
        return json({ error: "File must be a .zip archive" }, { status: 400 });
      }

      // Save ZIP to storage
      const zipPath = join(storagePath, "instagram.zip");
      const bytes = await file.arrayBuffer();
      await writeFile(zipPath, new Uint8Array(bytes));

      // Ensure a BrandSource row exists
      await ensureBrandSource(shop.id, "INSTAGRAM");
      await prisma.brandSource.updateMany({
        where: { shopId: shop.id, kind: "INSTAGRAM" },
        data: { status: "PENDING", error: null, updatedAt: new Date() },
      });

      // Enqueue the extraction job
      const campaignOverride = String(formData.get("campaign_override") ?? "").trim() || undefined;
      await instagramQueue().add(
        "process",
        { shopId: shop.id, zipPath, campaignOverride },
        {
          jobId: `brand-instagram:${shop.id}:${Date.now()}`,
          attempts: 2,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 5,
          removeOnFail: 20,
        },
      ).catch((err) => {
        console.error("[brand-settings] Failed to enqueue brand-instagram job", err);
      });

      return redirect("/app/settings/brand?saved=1&toast=instagram_processing");
    }

    if (intent === "upload_reference") {
      const tier = (shop.plan?.tier ?? "STARTER") as string;
      const limit = REFERENCE_ASSET_LIMIT[tier] ?? 10;
      const existing = await prisma.asset.count({
        where: { brandProfileId: shop.brandProfile?.id },
      });
      if (existing >= limit) {
        return json({ error: `Reference asset limit reached (${limit} for ${tier} plan)` }, { status: 400 });
      }

      const file = formData.get("reference_image") as File | null;
      if (!file || file.size === 0) return json({ error: "No file uploaded" }, { status: 400 });

      // Validate image MIME
      const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedMimes.includes(file.type)) {
        return json({ error: "Only JPEG, PNG, and WebP images are accepted" }, { status: 400 });
      }

      // Save to storage
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const filename = `ref-${Date.now()}.${ext}`;
      const filePath = join(storagePath, filename);
      const bytes = await file.arrayBuffer();
      await writeFile(filePath, new Uint8Array(bytes));
      const assetUrl = `/api/admin/brand-profile/asset/${shop.id}/${filename}`;

      // Ensure brand profile exists
      const profileId = await ensureBrandProfile(shop.id);
      await prisma.asset.create({
        data: {
          brandProfileId: profileId,
          url: assetUrl,
          kind: "BRAND_REFERENCE",
          meta: { filename: file.name, size: file.size, mimeType: file.type },
        },
      });
      return redirect("/app/settings/brand?saved=1&toast=reference_uploaded");
    }

    if (intent === "campaign_override_images") {
      const campaignName = String(formData.get("campaign_name") ?? "").trim();
      if (!campaignName) return json({ error: "Campaign name is required" }, { status: 400 });

      const zipPath = join(storagePath, `campaign-${campaignName.replace(/[^a-z0-9]/gi, "_")}.zip`);
      const file = formData.get("campaign_zip") as File | null;
      if (!file || file.size === 0) return json({ error: "No ZIP file uploaded" }, { status: 400 });

      const bytes = await file.arrayBuffer();
      await writeFile(zipPath, new Uint8Array(bytes));

      await instagramQueue().add(
        "process-campaign",
        { shopId: shop.id, zipPath, campaignOverride: campaignName },
        {
          jobId: `brand-instagram:campaign:${shop.id}:${campaignName}`,
          attempts: 2,
          removeOnComplete: 5,
          removeOnFail: 20,
        },
      ).catch((err) => {
        console.error("[brand-settings] Failed to enqueue campaign override job", err);
      });
      return redirect(`/app/settings/brand?saved=1&toast=campaign_processing`);
    }

    return json({ error: "Unknown multipart intent" }, { status: 400 });
  }

  // ─── Regular form data ─────────────────────────────────────────────────
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "refresh_catalog") {
    await dnaQueue().add(
      "extract-from-catalog",
      { shopId: shop.id },
      {
        jobId: `brand-dna-catalog:${shop.id}:manual:${Date.now()}`,
        attempts: 2,
        removeOnComplete: 10,
        removeOnFail: 20,
      },
    ).catch((err) => {
      console.error("[brand-settings] Failed to enqueue brand-dna-catalog job", err);
    });
    return redirect("/app/settings/brand?saved=1&toast=refresh_queued");
  }

  if (intent === "delete_reference") {
    const assetId = String(formData.get("assetId") ?? "");
    if (!assetId) return json({ error: "assetId required" }, { status: 400 });
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { brandProfileId: true } });
    if (asset?.brandProfileId === shop.brandProfile?.id) {
      await prisma.asset.delete({ where: { id: assetId } });
    }
    return redirect("/app/settings/brand?saved=1");
  }

  if (intent === "toggle_campaign") {
    const campaignName = String(formData.get("campaignName") ?? "");
    const active = formData.get("active") === "true";
    if (!campaignName) return json({ error: "campaignName required" }, { status: 400 });

    const profile = await prisma.brandProfile.findUnique({
      where: { shopId: shop.id },
      select: { id: true, toneJson: true },
    });
    if (!profile) return json({ error: "Profile not found" }, { status: 404 });

    const tone = (profile.toneJson as Record<string, unknown> | null) ?? {};
    const overrides = (tone.campaignOverrides as Array<Record<string, unknown>> | undefined) ?? [];
    const updated = overrides.map((o) =>
      o.name === campaignName ? { ...o, active } : o,
    );
    await prisma.brandProfile.update({
      where: { id: profile.id },
      data: { toneJson: { ...tone, campaignOverrides: updated } as object },
    });
    return redirect("/app/settings/brand?saved=1");
  }

  if (intent === "delete_campaign") {
    const campaignName = String(formData.get("campaignName") ?? "");
    if (!campaignName) return json({ error: "campaignName required" }, { status: 400 });

    const profile = await prisma.brandProfile.findUnique({
      where: { shopId: shop.id },
      select: { id: true, toneJson: true },
    });
    if (!profile) return json({ error: "Profile not found" }, { status: 404 });

    const tone = (profile.toneJson as Record<string, unknown> | null) ?? {};
    const overrides = (tone.campaignOverrides as Array<Record<string, unknown>> | undefined) ?? [];
    const updated = overrides.filter((o) => o.name !== campaignName);
    await prisma.brandProfile.update({
      where: { id: profile.id },
      data: { toneJson: { ...tone, campaignOverrides: updated } as object },
    });
    return redirect("/app/settings/brand");
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

// ─── UI ───────────────────────────────────────────────────────────────────────

export default function BrandDNAPage() {
  const d = useLoaderData<typeof loader>();
  const ad = useActionData<typeof action>();
  const nav = useNavigation();
  const saving = nav.state === "submitting";
  const fetcher = useFetcher();

  const toastMessages: Record<string, string> = {
    instagram_processing: "Instagram archive received — processing DNA in the background.",
    refresh_queued: "Catalog re-analysis queued — DNA will update shortly.",
    reference_uploaded: "Reference image uploaded.",
    campaign_processing: "Campaign images received — processing override DNA.",
  };
  const toast = d.toast ? toastMessages[d.toast] ?? null : null;

  return (
    <div className="sq-shell">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <header className="sq-header">
        <div>
          <div className="sq-eyebrow"><span className="sq-eyebrow__dot" /> Stylique · Brand DNA</div>
          <h1 className="sq-h1"><span className="serif">Your brand's</span><em className="serif"> creative director.</em></h1>
          <p className="sq-sub">Stylique learns your visual aesthetic automatically — feed it more signal for richer results.</p>
        </div>
      </header>

      {toast && <div className="sq-toast">{toast}</div>}
      {d.saved && !toast && <div className="sq-toast">Saved.</div>}
      {ad && "error" in ad && ad.error && <div className="sq-error">{ad.error}</div>}

      {/* ── Section 1: Brand Identity ── */}
      <section className="sq-section">
        <div className="sq-section-head">
          <h2 className="sq-h2">Brand Identity</h2>
          <span className="sq-badge">Auto-computed</span>
        </div>
        <p className="sq-section-sub">
          {d.trainedAt
            ? `DNA last computed: ${new Date(d.trainedAt).toLocaleDateString()} — computed from ${d.productCount} synced products.`
            : "Not yet computed — DNA will be extracted automatically after your next catalog sync."}
        </p>

        {d.palette.length > 0 && (
          <div className="sq-palette">
            {d.palette.map((hex) => (
              <div key={hex} className="sq-swatch" style={{ backgroundColor: hex }} title={hex} />
            ))}
          </div>
        )}

        {d.tone.moodAdjectives.length > 0 && (
          <div className="sq-chips">
            {d.tone.moodAdjectives.map((adj) => (
              <span key={adj} className="sq-chip">{adj}</span>
            ))}
          </div>
        )}

        {d.tone.lighting && (
          <div className="sq-tone-row">
            <span className="sq-tone-label">Lighting</span>
            <span className="sq-tone-value">{humanize(d.tone.lighting)}</span>
          </div>
        )}
        {d.tone.composition && (
          <div className="sq-tone-row">
            <span className="sq-tone-label">Composition</span>
            <span className="sq-tone-value">{humanize(d.tone.composition)}</span>
          </div>
        )}
        {d.tone.modelArchetype && (
          <div className="sq-tone-row">
            <span className="sq-tone-label">Model archetype</span>
            <span className="sq-tone-value">{humanize(d.tone.modelArchetype)}</span>
          </div>
        )}
        {d.tone.seasonality && (
          <div className="sq-tone-row">
            <span className="sq-tone-label">Seasonality</span>
            <span className="sq-tone-value">{humanize(d.tone.seasonality)}</span>
          </div>
        )}
        {d.tone.pricePositioning && (
          <div className="sq-tone-row">
            <span className="sq-tone-label">Positioning</span>
            <span className="sq-tone-value">{humanize(d.tone.pricePositioning)}</span>
          </div>
        )}

        <Form method="post" className="sq-inline-form">
          <input type="hidden" name="intent" value="refresh_catalog" />
          <button className="sq-btn-ghost" type="submit" disabled={saving}>
            {saving && nav.formData?.get("intent") === "refresh_catalog" ? "Queuing…" : "Refresh from catalog"}
          </button>
        </Form>

        {!d.trainedAt && d.shopifySourceStatus === null && (
          <p className="sq-hint">DNA extraction runs automatically after catalog sync. Trigger a sync from your Shopify admin or use the Refresh button above.</p>
        )}
      </section>

      {/* ── Section 2: Instagram ── */}
      <section className="sq-section">
        <div className="sq-section-head">
          <h2 className="sq-h2">Instagram Content</h2>
          <span className="sq-badge sq-badge--purple">Richer signal</span>
        </div>
        <p className="sq-section-sub">Feed your actual campaign photography into the brand AI director.</p>

        {d.instagramStatus === "PENDING" && (
          <div className="sq-status-card sq-status-card--processing">
            <span className="sq-spinner" /> Processing Instagram archive — this may take a few minutes.
          </div>
        )}
        {d.instagramStatus === "READY" && d.instagramLastSyncedAt && (
          <div className="sq-status-card sq-status-card--ok">
            Instagram DNA last updated: {new Date(d.instagramLastSyncedAt).toLocaleDateString()}
          </div>
        )}
        {d.instagramStatus === "FAILED" && (
          <div className="sq-status-card sq-status-card--err">
            Last processing failed: {d.instagramError ?? "unknown error"}. Try uploading again.
          </div>
        )}

        <div className="sq-card-grid">
          {/* Option A: ZIP upload */}
          <div className="sq-option-card">
            <div className="sq-option-icon">📦</div>
            <h3 className="sq-option-title">Upload Instagram archive</h3>
            <p className="sq-option-desc">
              Download your data from Instagram → Settings → Your activity → Download your information. Select "Posts" format. Upload the .zip file here.
            </p>
            <Form method="post" encType="multipart/form-data">
              <input type="hidden" name="intent" value="upload_instagram" />
              <div className="sq-file-row">
                <input name="instagram_zip" type="file" accept=".zip" className="sq-file-input" />
                <button className="sq-btn" type="submit" disabled={saving}>Upload &amp; analyze</button>
              </div>
            </Form>
          </div>

          {/* Option B: API (future) */}
          <div className="sq-option-card sq-option-card--disabled">
            <div className="sq-option-icon">🔗</div>
            <h3 className="sq-option-title">Connect Instagram API</h3>
            <p className="sq-option-desc">
              Connect via Instagram Business API to auto-sync new posts as they publish.
            </p>
            <button className="sq-btn sq-btn--disabled" disabled>Coming soon</button>
          </div>
        </div>
      </section>

      {/* ── Section 3: Reference Assets ── */}
      <section className="sq-section">
        <div className="sq-section-head">
          <h2 className="sq-h2">Reference Assets</h2>
          <span className="sq-badge">{d.referenceAssets.length} / {d.referenceLimit === Infinity ? "∞" : d.referenceLimit}</span>
        </div>
        <p className="sq-section-sub">Campaign photos, lookbook images, and mood board shots used to understand the brand's visual language.</p>

        {d.referenceAssets.length > 0 && (
          <div className="sq-asset-grid">
            {d.referenceAssets.map((asset) => (
              <div key={asset.id} className="sq-asset-thumb">
                <img src={asset.url} alt="" className="sq-asset-img" />
                <fetcher.Form method="post" className="sq-asset-delete-form">
                  <input type="hidden" name="intent" value="delete_reference" />
                  <input type="hidden" name="assetId" value={asset.id} />
                  <button className="sq-asset-delete" type="submit" title="Remove">×</button>
                </fetcher.Form>
              </div>
            ))}
          </div>
        )}

        {d.referenceAssets.length < (d.referenceLimit === Infinity ? 9999 : d.referenceLimit) && (
          <Form method="post" encType="multipart/form-data" className="sq-upload-zone">
            <input type="hidden" name="intent" value="upload_reference" />
            <input name="reference_image" type="file" accept="image/jpeg,image/png,image/webp" className="sq-file-input" />
            <button className="sq-btn" type="submit" disabled={saving}>Upload reference image</button>
          </Form>
        )}
        {d.tier === "STARTER" && (
          <p className="sq-hint">Starter plan: 10 reference images. Upgrade to Growth (30) or Ultimate (unlimited).</p>
        )}
      </section>

      {/* ── Section 4: Campaign Overrides ── */}
      <section className="sq-section">
        <div className="sq-section-head">
          <h2 className="sq-h2">Campaign Overrides</h2>
          <span className="sq-badge sq-badge--purple">Brand intelligence</span>
        </div>
        <p className="sq-section-sub">
          Override the base brand DNA for specific campaigns. Mira and the recommendation engine use the active campaign context when selecting products and explaining looks.
        </p>

        {d.campaignOverrides.length > 0 && (
          <div className="sq-campaign-list">
            {d.campaignOverrides.map((override) => (
              <div key={override.name} className={`sq-campaign-row ${override.active ? "sq-campaign-row--active" : ""}`}>
                <span className="sq-campaign-name">{override.name}</span>
                {override.active && <span className="sq-campaign-active-badge">Active</span>}
                {override.createdAt && (
                  <span className="sq-campaign-date">{new Date(override.createdAt).toLocaleDateString()}</span>
                )}
                <div className="sq-campaign-actions">
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="toggle_campaign" />
                    <input type="hidden" name="campaignName" value={override.name} />
                    <input type="hidden" name="active" value={override.active ? "false" : "true"} />
                    <button className="sq-btn-ghost sq-btn-sm" type="submit">
                      {override.active ? "Deactivate" : "Activate"}
                    </button>
                  </fetcher.Form>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete_campaign" />
                    <input type="hidden" name="campaignName" value={override.name} />
                    <button className="sq-btn-ghost sq-btn-sm sq-btn-danger" type="submit">Delete</button>
                  </fetcher.Form>
                </div>
              </div>
            ))}
          </div>
        )}

        <details className="sq-details">
          <summary className="sq-btn-ghost">Create campaign override</summary>
          <div className="sq-details-body">
            <p className="sq-hint">Upload 5-10 reference images or a ZIP archive that captures this campaign's mood. We'll extract the visual DNA and store it as an override.</p>
            <Form method="post" encType="multipart/form-data" className="sq-form">
              <input type="hidden" name="intent" value="campaign_override_images" />
              <div className="sq-field">
                <label>Campaign name</label>
                <input name="campaign_name" type="text" placeholder="e.g. Summer 2026 — Cannes" maxLength={60} />
              </div>
              <div className="sq-field">
                <label>Campaign images (ZIP)</label>
                <input name="campaign_zip" type="file" accept=".zip" className="sq-file-input" />
                <small>ZIP of 5-20 campaign photos. Same format as the Instagram archive upload.</small>
              </div>
              <button className="sq-btn" type="submit" disabled={saving}>Extract campaign DNA</button>
            </Form>
          </div>
        </details>
      </section>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureBrandSource(shopId: string, kind: "INSTAGRAM" | "SHOPIFY"): Promise<void> {
  const existing = await prisma.brandSource.findFirst({ where: { shopId, kind } });
  if (!existing) {
    await prisma.brandSource.create({ data: { shopId, kind, status: "PENDING" } });
  }
}

async function ensureBrandProfile(shopId: string): Promise<string> {
  const existing = await prisma.brandProfile.findUnique({
    where: { shopId },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.brandProfile.create({
    data: { shopId },
    select: { id: true },
  });
  return created.id;
}

function humanize(str: string): string {
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
:root {
  --sq-bg: #08070A; --sq-surface: #14111A; --sq-surface2: #1C1924;
  --sq-line: rgba(255,255,255,.08); --sq-line-acc: rgba(201,181,255,.35);
  --sq-text: #F4F2EE; --sq-mute: #8E8A99;
  --sq-grad: linear-gradient(135deg, #8B5CF6, #E879C8);
  --sq-green: #22C55E; --sq-red: #EF4444; --sq-amber: #F59E0B;
}
* { box-sizing: border-box; }
.sq-shell { font-family: "Manrope", system-ui, sans-serif; background: var(--sq-bg); color: var(--sq-text); min-height: 100vh; padding: 36px 40px; max-width: 900px; }
.sq-header { margin-bottom: 36px; padding-bottom: 24px; border-bottom: 1px solid var(--sq-line); }
.serif { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; }
.sq-eyebrow { font-size: 10.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--sq-mute); display: inline-flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sq-eyebrow__dot { width: 6px; height: 6px; border-radius: 999px; background: #8B5CF6; box-shadow: 0 0 8px #8B5CF6; }
.sq-h1 { font-size: 48px; line-height: 1; margin: 0; font-weight: 400; }
.sq-h1 em { font-style: italic; background: var(--sq-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-sub { font-size: 13px; color: var(--sq-mute); margin: 12px 0 0; }
.sq-h2 { font-size: 20px; font-weight: 500; margin: 0; }
.sq-section { margin-bottom: 36px; padding: 24px; background: var(--sq-surface); border: 1px solid var(--sq-line); border-radius: 16px; display: flex; flex-direction: column; gap: 16px; }
.sq-section-head { display: flex; align-items: center; gap: 12px; }
.sq-section-sub { font-size: 13px; color: var(--sq-mute); margin: 0; }
.sq-badge { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; background: rgba(255,255,255,.08); color: var(--sq-mute); padding: 3px 8px; border-radius: 999px; }
.sq-badge--purple { background: rgba(139,92,246,.15); color: #C4B5FD; }
.sq-palette { display: flex; gap: 10px; flex-wrap: wrap; }
.sq-swatch { width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--sq-line); flex-shrink: 0; }
.sq-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.sq-chip { font-size: 12px; background: rgba(139,92,246,.15); color: #C4B5FD; border: 1px solid rgba(139,92,246,.3); padding: 4px 10px; border-radius: 999px; }
.sq-tone-row { display: flex; gap: 16px; align-items: baseline; }
.sq-tone-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--sq-mute); width: 130px; flex-shrink: 0; }
.sq-tone-value { font-size: 14px; color: var(--sq-text); }
.sq-inline-form { display: flex; }
.sq-form { display: flex; flex-direction: column; gap: 14px; }
.sq-field { display: flex; flex-direction: column; gap: 6px; }
.sq-field label { font-size: 12px; color: var(--sq-text); }
.sq-field small { font-size: 11px; color: var(--sq-mute); }
.sq-field input[type=text], .sq-field input[type=url] { background: var(--sq-surface2); color: var(--sq-text); border: 1px solid var(--sq-line); border-radius: 10px; padding: 10px 14px; font-family: inherit; font-size: 14px; outline: none; }
.sq-field input:focus { border-color: var(--sq-line-acc); }
.sq-btn { padding: 10px 20px; border: 0; border-radius: 999px; background: var(--sq-grad); color: #fff; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.sq-btn:disabled { opacity: .5; cursor: not-allowed; }
.sq-btn--disabled { padding: 10px 20px; border: 1px solid var(--sq-line); border-radius: 999px; background: transparent; color: var(--sq-mute); font-family: inherit; font-size: 13px; cursor: not-allowed; }
.sq-btn-ghost { background: transparent; border: 1px solid var(--sq-line); color: var(--sq-text); padding: 9px 18px; border-radius: 999px; font-family: inherit; font-size: 13px; cursor: pointer; }
.sq-btn-ghost:hover { border-color: var(--sq-line-acc); }
.sq-btn-ghost:disabled { opacity: .5; cursor: not-allowed; }
.sq-btn-sm { padding: 5px 12px; font-size: 12px; }
.sq-btn-danger { color: var(--sq-red); border-color: rgba(239,68,68,.3); }
.sq-card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 640px) { .sq-card-grid { grid-template-columns: 1fr; } }
.sq-option-card { background: var(--sq-surface2); border: 1px solid var(--sq-line); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
.sq-option-card--disabled { opacity: .5; }
.sq-option-icon { font-size: 24px; }
.sq-option-title { font-size: 15px; font-weight: 600; margin: 0; }
.sq-option-desc { font-size: 12.5px; color: var(--sq-mute); margin: 0; line-height: 1.5; }
.sq-file-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.sq-file-input { font-size: 12px; color: var(--sq-mute); }
.sq-upload-zone { padding: 16px; border: 1px dashed var(--sq-line); border-radius: 10px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.sq-asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 10px; }
.sq-asset-thumb { position: relative; }
.sq-asset-img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; border: 1px solid var(--sq-line); display: block; }
.sq-asset-delete-form { position: absolute; top: 4px; right: 4px; }
.sq-asset-delete { background: rgba(0,0,0,.7); color: #fff; border: 0; border-radius: 999px; width: 20px; height: 20px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.sq-status-card { padding: 12px 16px; border-radius: 10px; font-size: 13px; display: flex; align-items: center; gap: 10px; }
.sq-status-card--processing { background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.3); color: #FCD34D; }
.sq-status-card--ok { background: rgba(34,197,94,.08); border: 1px solid rgba(34,197,94,.3); color: #86EFAC; }
.sq-status-card--err { background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.3); color: #FCA5A5; }
.sq-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.2); border-top-color: #FCD34D; border-radius: 999px; animation: sq-spin .7s linear infinite; flex-shrink: 0; }
@keyframes sq-spin { to { transform: rotate(360deg); } }
.sq-campaign-list { display: flex; flex-direction: column; gap: 8px; }
.sq-campaign-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--sq-surface2); border: 1px solid var(--sq-line); border-radius: 10px; flex-wrap: wrap; }
.sq-campaign-row--active { border-color: rgba(139,92,246,.4); }
.sq-campaign-name { font-size: 14px; font-weight: 500; flex: 1; min-width: 120px; }
.sq-campaign-active-badge { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; background: rgba(139,92,246,.2); color: #C4B5FD; padding: 2px 8px; border-radius: 999px; }
.sq-campaign-date { font-size: 11px; color: var(--sq-mute); }
.sq-campaign-actions { display: flex; gap: 8px; margin-left: auto; }
.sq-details summary { cursor: pointer; list-style: none; }
.sq-details summary::-webkit-details-marker { display: none; }
.sq-details-body { padding-top: 16px; display: flex; flex-direction: column; gap: 12px; }
.sq-hint { font-size: 11.5px; color: var(--sq-mute); margin: 0; line-height: 1.6; }
.sq-toast { padding: 12px 18px; background: rgba(139,92,246,.12); border: 1px solid rgba(139,92,246,.3); border-radius: 10px; font-size: 13px; color: #C4B5FD; margin-bottom: 16px; }
.sq-error { padding: 10px 14px; color: #E879C8; background: rgba(232,121,200,.08); border: 1px solid rgba(232,121,200,.3); border-radius: 10px; font-size: 13px; }
`;
