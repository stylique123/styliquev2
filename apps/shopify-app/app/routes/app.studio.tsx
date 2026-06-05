// Creative Studio — "Generate New Set" dashboard page.
//
// Surfaces all CreativeOutputKinds as visual cards grouped into four
// categories: Product, Social, Campaign, Video.
//
// Each card shows:
//   • Kind name (human-readable)
//   • Aspect ratio + image/video count
//   • 1-line description of what it generates
//   • "Veo" badge when VERTEX_PROJECT_ID is set (video kinds only)
//   • "Coming soon" overlay when Veo is not configured
//
// On POST: creates a CreativeSet row (PENDING) + enqueues the BullMQ job,
// then redirects to the dashboard with a confirmation param.
//
// SECURITY: authenticated via Shopify embedded-app session. shopId is
// resolved from the session — never trusted from the form body.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { enqueueCreativeSet } from "../queue.server";
import { z } from "zod";

/** Simple unique id — matches the pattern in other admin routes. */
function createId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
import {
  DEFAULT_ASPECT,
  DEFAULT_COUNT,
  VIDEO_KINDS,
  type CreativeOutputKind,
} from "@stylique/core";

// ─── Types ────────────────────────────────────────────────────────────────

type KindMeta = {
  kind: CreativeOutputKind;
  label: string;
  description: string;
  aspectRatio: string;
  count: number;
  isVideo: boolean;
};

type KindGroup = {
  groupLabel: string;
  groupKey: string;
  items: KindMeta[];
};

// ─── Kind metadata (label + description) ──────────────────────────────────

const KIND_META: Record<CreativeOutputKind, { label: string; description: string }> = {
  PDP_PRODUCT:            { label: "PDP Product Shots",      description: "4 on-brand product shots on a neutral or brand backdrop, 1:1 format for product pages." },
  PDP_LIFESTYLE:          { label: "PDP Lifestyle",          description: "3 model-wearing-in-scene shots in a lifestyle context, 4:5 portrait format." },
  CAMPAIGN_HERO:          { label: "Campaign Hero",          description: "1 bold editorial campaign hero image in 16:9 widescreen for banners and press." },
  CAROUSEL_SET:           { label: "Carousel Set",           description: "5 cohesive slides for an IG carousel, all 1:1 with consistent visual treatment." },
  LOOKBOOK_SPREAD:        { label: "Lookbook Spread",        description: "6 editorial lookbook page images in 4:5 format for a seasonal lookbook." },
  INSTAGRAM_POST:         { label: "Instagram Post",         description: "3 images optimised for the Instagram feed — vibrant, editorial, scroll-stopping, 1:1." },
  INSTAGRAM_CAROUSEL:     { label: "Instagram Carousel",     description: "8 images for a cohesive Instagram carousel swipe-through, consistent color treatment." },
  INSTAGRAM_STORY:        { label: "Instagram Story",        description: "3 vertical 9:16 story frames designed for mobile Stories, bold and immediate." },
  WHATSAPP_STATUS:        { label: "WhatsApp Status",        description: "3 vertical 9:16 frames for WhatsApp broadcast channel content, high contrast." },
  REELS_COVER:            { label: "Reels Cover",            description: "1 thumbnail image for a Reels cover — eye-catching, no text, strong expression." },
  EMAIL_HEADER:           { label: "Email Header",           description: "2 wide 3:1 editorial banners for email newsletters — clean, minimal text space." },
  FLAT_LAY:               { label: "Flat Lay",               description: "4 overhead flat-lay photographs with garments arranged artfully on a clean surface." },
  GHOST_MANNEQUIN:        { label: "Ghost Mannequin",        description: "2 invisible-mannequin product shots on a clean white background for e-commerce." },
  WHOLESALE_CATALOG_PAGE: { label: "Wholesale Catalog Page", description: "4 clean studio images on white background for a wholesale catalog or B2B sheet." },
  LOOKBOOK_PDF:           { label: "Lookbook PDF",           description: "Generates a multi-page PDF lookbook using existing product images + brand colors." },
  STORY_VIDEO:            { label: "Story Video",            description: "A 5-second vertical 9:16 cinematic video clip for Stories. Requires Vertex Veo." },
};

// ─── Kind groups ───────────────────────────────────────────────────────────

const KIND_GROUPS: KindGroup[] = (() => {
  const makeMeta = (kind: CreativeOutputKind): KindMeta => ({
    kind,
    label: KIND_META[kind].label,
    description: KIND_META[kind].description,
    aspectRatio: DEFAULT_ASPECT[kind],
    count: DEFAULT_COUNT[kind],
    isVideo: VIDEO_KINDS.has(kind),
  });

  const p = (k: CreativeOutputKind) => makeMeta(k);
  return [
    {
      groupKey: "product",
      groupLabel: "Product",
      items: [p("PDP_PRODUCT"), p("FLAT_LAY"), p("GHOST_MANNEQUIN"), p("WHOLESALE_CATALOG_PAGE")],
    },
    {
      groupKey: "social",
      groupLabel: "Social",
      items: [p("INSTAGRAM_POST"), p("INSTAGRAM_CAROUSEL"), p("INSTAGRAM_STORY"), p("WHATSAPP_STATUS"), p("REELS_COVER")],
    },
    {
      groupKey: "campaign",
      groupLabel: "Campaign",
      items: [p("CAMPAIGN_HERO"), p("PDP_LIFESTYLE"), p("LOOKBOOK_SPREAD"), p("LOOKBOOK_PDF")],
    },
    {
      groupKey: "email",
      groupLabel: "Email",
      items: [p("EMAIL_HEADER")],
    },
    {
      groupKey: "video",
      groupLabel: "Video",
      items: [p("STORY_VIDEO")],
    },
  ];
})();

// ─── Loader ───────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) throw new Response("shop_not_installed", { status: 404 });

  const veoConfigured = Boolean(
    process.env.VERTEX_PROJECT_ID && process.env.VERTEX_SERVICE_ACCOUNT_JSON,
  );

  // Fetch a few recent products for the product selector.
  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, category: true },
  });

  // Last 10 creative sets for the "recent" panel.
  const recentSets = await prisma.creativeSet.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      triggeredBy: true,
      providerMeta: true,
      createdAt: true,
      product: { select: { title: true } },
    },
  });

  return json({ veoConfigured, products, recentSets, groups: KIND_GROUPS });
}

// ─── Action ───────────────────────────────────────────────────────────────

const ActionSchema = z.object({
  productId: z.string().optional(),
  kind:      z.string().min(1),
  brief:     z.string().optional(),
  // Optional ISO string for scheduled generation (content calendar).
  scheduledFor: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const form = await request.formData();
  const parsed = ActionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return json({ ok: false, error: "validation_failed" }, { status: 422 });
  }

  const { productId, kind, brief, scheduledFor } = parsed.data;
  const outputKind = kind as CreativeOutputKind;

  // Validate productId belongs to this shop (if supplied).
  if (productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, shopId: shop.id },
      select: { id: true },
    });
    if (!product) return json({ ok: false, error: "product_not_found" }, { status: 404 });
  }

  const setId = createId();
  const now = new Date();

  // Build providerMeta — includes scheduledFor if provided (content calendar).
  const providerMeta: Record<string, unknown> = { kind: outputKind };
  if (scheduledFor) {
    const scheduledDate = new Date(scheduledFor);
    if (!isNaN(scheduledDate.getTime()) && scheduledDate > now) {
      providerMeta.scheduledFor = scheduledDate.toISOString();
    }
  }

  // Create the CreativeSet row.
  await prisma.creativeSet.create({
    data: {
      id: setId,
      shopId: shop.id,
      productId: productId ?? null,
      status: "PENDING",
      brief: brief ? { text: brief } : undefined,
      triggeredBy: "admin_studio",
      providerMeta: providerMeta as object,
    },
  });

  // Only enqueue immediately if not scheduled for the future.
  if (!providerMeta.scheduledFor) {
    await enqueueCreativeSet({
      shopId: shop.id,
      setId,
      productId: productId ?? "",
      triggeredBy: "admin_studio",
      brief,
      kind: outputKind as string,
    }).catch((err) => {
      console.error("[app.studio] failed to enqueue creative-set job", err);
    });
  }

  return redirect(`/app/studio?generated=${encodeURIComponent(outputKind)}`);
}

// ─── UI helpers ────────────────────────────────────────────────────────────

function kindCountLabel(kind: KindMeta): string {
  if (kind.isVideo) return "1 video";
  if (kind.kind === "LOOKBOOK_PDF") return "PDF";
  return `${kind.count} image${kind.count !== 1 ? "s" : ""}`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    PENDING:    "sq-badge--pending",
    GENERATING: "sq-badge--generating",
    READY:      "sq-badge--ready",
    FAILED:     "sq-badge--failed",
    PARTIAL:    "sq-badge--partial",
  };
  return `sq-badge ${map[status] ?? ""}`;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function StudioPage() {
  const { veoConfigured, products, recentSets, groups } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  // Check URL param for success toast.
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const generated = params?.get("generated");

  return (
    <div className="sq-studio-page">
      <header className="sq-page-header">
        <div>
          <h1 className="serif">Creative Studio</h1>
          <p className="sq-sub">Generate on-brand visual assets for every surface.</p>
        </div>
        <Link to="/app/settings/brand" className="sq-btn sq-btn--ghost" style={{ textDecoration: "none", fontSize: 13 }}>
          Brand DNA →
        </Link>
      </header>

      {generated && (
        <div className="sq-toast sq-toast--success" role="status">
          ✓ Creative set queued: <strong>{generated.replace(/_/g, " ").toLowerCase()}</strong>
        </div>
      )}

      {/* ── Generate new set form ──────────────────────────────────────── */}
      <section className="sq-card sq-studio-generate">
        <div className="sq-card-header">
          <h2 className="serif">Generate New Set</h2>
        </div>

        <Form method="post" className="sq-studio-form">
          {/* Product selector */}
          <div className="sq-form-field">
            <label htmlFor="productId" className="sq-label">Product (optional)</label>
            <select id="productId" name="productId" className="sq-select">
              <option value="">— No specific product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.title}{p.category ? ` (${p.category})` : ""}</option>
              ))}
            </select>
          </div>

          {/* Brief */}
          <div className="sq-form-field">
            <label htmlFor="brief" className="sq-label">Brief (optional)</label>
            <input
              id="brief"
              name="brief"
              type="text"
              className="sq-input"
              placeholder="e.g. Summer 2026 campaign, warm light, outdoor setting"
              maxLength={500}
            />
          </div>

          {/* Schedule for later */}
          <div className="sq-form-field">
            <label htmlFor="scheduledFor" className="sq-label">Schedule for (optional)</label>
            <input
              id="scheduledFor"
              name="scheduledFor"
              type="datetime-local"
              className="sq-input"
            />
            <span className="sq-hint">Leave blank to generate immediately. The worker scans hourly for scheduled sets.</span>
          </div>

          {/* Output kind cards — grouped */}
          <div className="sq-form-field">
            <span className="sq-label">Output type</span>
            {groups.map((group) => (
              <div key={group.groupKey} className="sq-kind-group">
                <h3 className="sq-kind-group__label">{group.groupLabel}</h3>
                <div className="sq-kind-grid">
                  {group.items.map((item) => {
                    const needsVeo = item.isVideo && !veoConfigured;
                    return (
                      <label
                        key={item.kind}
                        className={`sq-kind-card${needsVeo ? " sq-kind-card--disabled" : ""}`}
                      >
                        <input
                          type="radio"
                          name="kind"
                          value={item.kind}
                          disabled={needsVeo}
                          className="sq-kind-radio"
                          defaultChecked={item.kind === "PDP_PRODUCT"}
                        />
                        <div className="sq-kind-card__body">
                          <div className="sq-kind-card__top">
                            <span className="sq-kind-card__name">{item.label}</span>
                            <div className="sq-kind-card__badges">
                              <span className="sq-badge sq-badge--aspect">{item.aspectRatio}</span>
                              <span className="sq-badge sq-badge--count">{kindCountLabel(item)}</span>
                              {item.isVideo && veoConfigured && (
                                <span className="sq-badge sq-badge--veo">Veo</span>
                              )}
                              {needsVeo && (
                                <span className="sq-badge sq-badge--soon">Coming soon</span>
                              )}
                            </div>
                          </div>
                          <p className="sq-kind-card__desc">{item.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <button
            type="submit"
            className="sq-btn sq-btn--primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Queuing…" : "Generate Set"}
          </button>
        </Form>
      </section>

      {/* ── Recent creative sets ───────────────────────────────────────── */}
      {recentSets.length > 0 && (
        <section className="sq-card sq-studio-recent">
          <div className="sq-card-header">
            <h2 className="serif">Recent Sets</h2>
          </div>
          <table className="sq-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Triggered</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentSets.map((s) => {
                const meta = s.providerMeta as Record<string, unknown> | null;
                const kind = (meta?.kind as string | undefined) ?? "—";
                const triggered = s.triggeredBy ?? "—";
                const date = new Date(s.createdAt).toLocaleDateString();
                return (
                  <tr key={s.id}>
                    <td>{s.product?.title ?? "—"}</td>
                    <td>
                      <code className="sq-code">{kind.replace(/_/g, " ").toLowerCase()}</code>
                    </td>
                    <td>
                      <span className={statusBadge(s.status)}>{s.status}</span>
                    </td>
                    <td className="sq-muted">{triggered.slice(0, 40)}</td>
                    <td className="sq-muted">{date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <style>{`
        .sq-studio-page { max-width: 960px; margin: 0 auto; padding: 32px 16px; }
        .sq-page-header { margin-bottom: 32px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .sq-page-header h1 { font-size: 2rem; margin: 0 0 6px; }
        .sq-sub { color: var(--sq-muted, #888); margin: 0; }
        .sq-btn--ghost { background: transparent; border: 1px solid var(--sq-border, #2a2a2e); color: var(--sq-fg, #e8e8e8); padding: 8px 16px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
        .sq-btn--ghost:hover { border-color: var(--sq-accent, #a78bfa); color: var(--sq-accent, #a78bfa); }

        .sq-toast { padding: 12px 20px; border-radius: 6px; margin-bottom: 24px; font-size: 14px; }
        .sq-toast--success { background: #1a3a1a; color: #7de87d; border: 1px solid #2a5a2a; }

        .sq-card { background: var(--sq-surface, #1c1c1e); border: 1px solid var(--sq-border, #2a2a2e); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
        .sq-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
        .sq-card-header h2 { font-size: 1.2rem; margin: 0; }

        .sq-studio-form { display: flex; flex-direction: column; gap: 20px; }
        .sq-form-field { display: flex; flex-direction: column; gap: 6px; }
        .sq-label { font-size: 13px; font-weight: 500; color: var(--sq-fg, #e8e8e8); }
        .sq-hint { font-size: 12px; color: var(--sq-muted, #888); }
        .sq-select, .sq-input { background: var(--sq-input-bg, #111); border: 1px solid var(--sq-border, #2a2a2e); border-radius: 6px; padding: 8px 12px; color: var(--sq-fg, #e8e8e8); font-size: 14px; width: 100%; box-sizing: border-box; }
        .sq-select:focus, .sq-input:focus { outline: 2px solid var(--sq-accent, #a78bfa); outline-offset: 2px; }

        .sq-kind-group { margin-bottom: 20px; }
        .sq-kind-group__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sq-muted, #888); margin: 0 0 10px; }

        .sq-kind-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
        @media (max-width: 600px) { .sq-kind-grid { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 380px) { .sq-kind-grid { grid-template-columns: 1fr; } }

        .sq-kind-card { display: block; cursor: pointer; border: 1px solid var(--sq-border, #2a2a2e); border-radius: 8px; padding: 12px; transition: border-color 0.15s, background 0.15s; position: relative; }
        .sq-kind-card:has(input:checked) { border-color: var(--sq-accent, #a78bfa); background: rgba(167,139,250,0.06); }
        .sq-kind-card--disabled { opacity: 0.5; cursor: not-allowed; }
        .sq-kind-radio { position: absolute; opacity: 0; pointer-events: none; }

        .sq-kind-card__body { display: flex; flex-direction: column; gap: 6px; }
        .sq-kind-card__top { display: flex; flex-direction: column; gap: 4px; }
        .sq-kind-card__name { font-size: 13px; font-weight: 600; color: var(--sq-fg, #e8e8e8); }
        .sq-kind-card__badges { display: flex; gap: 4px; flex-wrap: wrap; }
        .sq-kind-card__desc { font-size: 11px; color: var(--sq-muted, #888); margin: 0; line-height: 1.4; }

        .sq-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.03em; }
        .sq-badge--aspect { background: #1e2a3a; color: #7ab4f5; }
        .sq-badge--count { background: #1e2a1e; color: #7de87d; }
        .sq-badge--veo { background: #3a1e2a; color: #e87ab4; }
        .sq-badge--soon { background: #2a2a2a; color: #888; }
        .sq-badge--pending    { background: #2a2a1a; color: #e8c87a; }
        .sq-badge--generating { background: #1a1a3a; color: #7ab4f5; }
        .sq-badge--ready      { background: #1a3a1a; color: #7de87d; }
        .sq-badge--failed     { background: #3a1a1a; color: #f57a7a; }
        .sq-badge--partial    { background: #2a1a2a; color: #c87ae8; }

        .sq-btn { padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; }
        .sq-btn--primary { background: var(--sq-accent, #a78bfa); color: #fff; }
        .sq-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .sq-btn--primary:hover:not(:disabled) { opacity: 0.9; }

        .sq-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .sq-table th { text-align: left; padding: 8px 10px; font-weight: 600; color: var(--sq-muted, #888); border-bottom: 1px solid var(--sq-border, #2a2a2e); }
        .sq-table td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .sq-muted { color: var(--sq-muted, #888); }
        .sq-code { font-family: monospace; font-size: 11px; }
      `}</style>
    </div>
  );
}
