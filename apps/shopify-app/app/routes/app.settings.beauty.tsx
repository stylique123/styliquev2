// Admin settings — configure beauty-mode features:
//   brandMode toggle, Beauty Advisor name, shade-match config,
//   replenishment cycle overrides, and active promotions.
//
// All writes land on Plan.planFeaturesJson. Same editorial dark aesthetic as
// app.settings.stylist.tsx (D6 invariant — no Polaris).

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useActionData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

// ── types ───────────────────────────────────────────────────────────────────

interface ActiveSale {
  title: string;
  discountText: string;
  endsAt: string; // ISO date string or ""
}

interface ReplenishmentOverride {
  category: string;
  cycleDays: number;
}

interface BeautyFeatures {
  brandMode?: "fashion" | "beauty";
  stylist?: {
    stylistName?: string;
    avatarUrl?: string;
    voice?: string;
  };
  beauty?: {
    shadeMatchEnabled?: boolean;
    shadeMatchMinConfidence?: number;
    shadeMatchShowWhy?: boolean;
    replenishmentOverrides?: ReplenishmentOverride[];
  };
  activeSales?: ActiveSale[];
}

const DEFAULT_REPLENISHMENT: ReplenishmentOverride[] = [
  { category: "serum",        cycleDays: 30 },
  { category: "moisturiser",  cycleDays: 60 },
  { category: "foundation",   cycleDays: 90 },
  { category: "concealer",    cycleDays: 90 },
  { category: "cleanser",     cycleDays: 45 },
  { category: "toner",        cycleDays: 45 },
  { category: "sunscreen",    cycleDays: 60 },
];

// ── loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: { select: { planFeaturesJson: true, tier: true } } },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const f = (shop.plan?.planFeaturesJson as BeautyFeatures | null) ?? {};
  const b = f.beauty ?? {};

  // Merge stored overrides with defaults (stored wins per category).
  const storedOverrides: Record<string, number> = {};
  for (const o of b.replenishmentOverrides ?? []) {
    storedOverrides[o.category] = o.cycleDays;
  }
  const replenishment: ReplenishmentOverride[] = DEFAULT_REPLENISHMENT.map((d) => ({
    category: d.category,
    cycleDays: storedOverrides[d.category] ?? d.cycleDays,
  }));

  // Cap at 3 active sales.
  const activeSales: ActiveSale[] = (f.activeSales ?? []).slice(0, 3);
  while (activeSales.length < 3) {
    activeSales.push({ title: "", discountText: "", endsAt: "" });
  }

  return json({
    tier: shop.plan?.tier ?? "STARTER",
    brandMode: f.brandMode ?? "fashion",
    advisorName: f.stylist?.stylistName ?? "Lumière AI",
    shadeMatchEnabled: b.shadeMatchEnabled ?? false,
    shadeMatchMinConfidence: b.shadeMatchMinConfidence ?? 0.7,
    shadeMatchShowWhy: b.shadeMatchShowWhy ?? true,
    replenishment,
    activeSales,
  });
}

// ── action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();

  const brandMode = fd.get("brandMode") === "beauty" ? "beauty" : "fashion";
  const advisorName = String(fd.get("advisorName") ?? "").trim().slice(0, 40) || "Lumière AI";
  const shadeMatchEnabled = fd.get("shadeMatchEnabled") === "1";
  const rawConf = parseFloat(String(fd.get("shadeMatchMinConfidence") ?? "0.7"));
  const shadeMatchMinConfidence = Math.max(0.5, Math.min(0.9, isNaN(rawConf) ? 0.7 : rawConf));
  const shadeMatchShowWhy = fd.get("shadeMatchShowWhy") === "1";

  // Replenishment overrides — encoded as replenishment[serum]=30 etc.
  const replenishmentOverrides: ReplenishmentOverride[] = DEFAULT_REPLENISHMENT.map((d) => {
    const raw = parseInt(String(fd.get(`replenishment[${d.category}]`) ?? ""), 10);
    const cycleDays = isNaN(raw) || raw < 1 || raw > 365 ? d.cycleDays : raw;
    return { category: d.category, cycleDays };
  });

  // Active sales — encoded as sale[0][title], sale[0][discountText], sale[0][endsAt].
  const activeSales: ActiveSale[] = [];
  for (let i = 0; i < 3; i++) {
    const title = String(fd.get(`sale[${i}][title]`) ?? "").trim().slice(0, 80);
    const discountText = String(fd.get(`sale[${i}][discountText]`) ?? "").trim().slice(0, 80);
    const endsAt = String(fd.get(`sale[${i}][endsAt]`) ?? "").trim();
    if (title) {
      activeSales.push({ title, discountText, endsAt });
    }
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: { select: { id: true, planFeaturesJson: true } } },
  });
  if (!shop?.plan) throw new Response("Plan not found", { status: 404 });

  const current = (shop.plan.planFeaturesJson as Record<string, unknown> | null) ?? {};
  const currentStylist = (current.stylist as Record<string, unknown> | undefined) ?? {};

  const next: BeautyFeatures = {
    ...(current as BeautyFeatures),
    brandMode,
    stylist: {
      ...currentStylist,
      stylistName: advisorName,
    },
    beauty: {
      shadeMatchEnabled,
      shadeMatchMinConfidence,
      shadeMatchShowWhy,
      replenishmentOverrides,
    },
    activeSales,
  };

  await prisma.plan.update({
    where: { id: shop.plan.id },
    data: { planFeaturesJson: next as object },
  });

  return redirect("/app/settings/beauty?saved=1");
}

// ── component ────────────────────────────────────────────────────────────────

export default function BeautySettingsPage() {
  const d = useLoaderData<typeof loader>();
  const ad = useActionData<typeof action>();
  const nav = useNavigation();
  const [params] = useSearchParams();
  const saving = nav.state === "submitting";
  const saved = params.get("saved") === "1";

  return (
    <div className="sq-shell">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <header className="sq-header">
        <div>
          <div className="sq-eyebrow"><span className="sq-eyebrow__dot" /> Stylique · Beauty settings</div>
          <h1 className="sq-h1"><span className="serif">Beauty</span><em className="serif"> advisor config.</em></h1>
          <p className="sq-sub">Configure shade matching, replenishment cycles, and active promotions for beauty brands.</p>
        </div>
      </header>

      {saved && (
        <div className="sq-banner sq-banner--ok">Settings saved.</div>
      )}
      {ad && "error" in ad && (
        <div className="sq-banner sq-banner--err">{(ad as { error: string }).error}</div>
      )}

      <Form method="post" className="sq-form">

        {/* ── 1. Brand Mode ─────────────────────────────────────────────── */}
        <section className="sq-section">
          <h2 className="sq-section-title">Brand mode</h2>
          <p className="sq-section-sub">
            Switch the entire advisor experience between fashion-first and beauty-first.
            Beauty mode activates shade matching, skin-tone awareness, and replenishment reminders.
          </p>
          <div className="sq-toggle-row">
            <label className="sq-toggle-label">
              <input
                type="radio" name="brandMode" value="fashion"
                defaultChecked={d.brandMode !== "beauty"}
              />
              <span className="sq-toggle-card">
                <span className="sq-toggle-card__icon">👗</span>
                <span>Fashion</span>
              </span>
            </label>
            <label className="sq-toggle-label">
              <input
                type="radio" name="brandMode" value="beauty"
                defaultChecked={d.brandMode === "beauty"}
              />
              <span className="sq-toggle-card">
                <span className="sq-toggle-card__icon">💄</span>
                <span>Beauty</span>
              </span>
            </label>
          </div>
        </section>

        {/* ── 2. Beauty Advisor Name ────────────────────────────────────── */}
        <section className="sq-section">
          <h2 className="sq-section-title">Beauty advisor name</h2>
          <p className="sq-section-sub">
            The name shoppers see in the advisor dock. Writes to <span className="mono">stylist.stylistName</span>.
          </p>
          <div className="sq-field">
            <label htmlFor="advisorName">Advisor name</label>
            <input
              id="advisorName" name="advisorName" type="text"
              defaultValue={d.advisorName} maxLength={40}
              placeholder="Lumière AI"
            />
            <small>Max 40 characters. Default: Lumière AI.</small>
          </div>
        </section>

        {/* ── 3. Shade Match Config ─────────────────────────────────────── */}
        <section className="sq-section">
          <h2 className="sq-section-title">Shade match</h2>
          <p className="sq-section-sub">
            When enabled, the advisor matches the shopper's skin tone to product shades using
            photo analysis. Only shown when confidence meets the threshold.
          </p>

          <div className="sq-checkbox-row">
            <label className="sq-checkbox-label">
              <input
                type="checkbox" name="shadeMatchEnabled" value="1"
                defaultChecked={d.shadeMatchEnabled}
              />
              Enable shade matching
            </label>
          </div>

          <div className="sq-field sq-field--slider">
            <label htmlFor="shadeMatchMinConfidence">
              Minimum confidence threshold
              <span className="sq-slider-val" id="confVal">
                {Math.round(d.shadeMatchMinConfidence * 100)}%
              </span>
            </label>
            <input
              id="shadeMatchMinConfidence" name="shadeMatchMinConfidence"
              type="range" min="0.5" max="0.9" step="0.05"
              defaultValue={d.shadeMatchMinConfidence}
              onInput={(e) => {
                const val = parseFloat((e.target as HTMLInputElement).value);
                const el = document.getElementById("confVal");
                if (el) el.textContent = `${Math.round(val * 100)}%`;
              }}
            />
            <small>
              Shade suggestions are suppressed below this threshold. 70% is a good starting point.
              Range: 50–90%.
            </small>
          </div>

          <div className="sq-checkbox-row">
            <label className="sq-checkbox-label">
              <input
                type="checkbox" name="shadeMatchShowWhy" value="1"
                defaultChecked={d.shadeMatchShowWhy}
              />
              Show "why this shade" tooltip to shopper
            </label>
            <small className="sq-checkbox-small">
              Displays a one-line explanation ("warm-toned, medium depth") alongside each shade recommendation.
            </small>
          </div>
        </section>

        {/* ── 4. Replenishment Cycles ───────────────────────────────────── */}
        <section className="sq-section">
          <h2 className="sq-section-title">Replenishment cycle overrides</h2>
          <p className="sq-section-sub">
            The advisor proactively reminds returning shoppers when a product is likely running low.
            Override the default cycle per category (in days).
          </p>
          <table className="sq-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Cycle (days)</th>
              </tr>
            </thead>
            <tbody>
              {d.replenishment.map((r) => (
                <tr key={r.category}>
                  <td className="sq-table-cat">{capitalize(r.category)}</td>
                  <td>
                    <input
                      className="sq-table-input"
                      type="number"
                      name={`replenishment[${r.category}]`}
                      defaultValue={r.cycleDays}
                      min={1}
                      max={365}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ── 5. Active Promotions ──────────────────────────────────────── */}
        <section className="sq-section">
          <h2 className="sq-section-title">Active promotions</h2>
          <p className="sq-section-sub">
            Declare up to 3 live sales or promotions. The advisor will mention these naturally
            in conversation but will <strong>never invent a discount code or percentage</strong> beyond
            what you enter here. Leave a row blank to remove it.
          </p>
          <div className="sq-promos">
            {d.activeSales.map((s, i) => (
              <div key={i} className="sq-promo-card">
                <div className="sq-promo-num">#{i + 1}</div>
                <div className="sq-promo-fields">
                  <div className="sq-field">
                    <label htmlFor={`sale-title-${i}`}>Title</label>
                    <input
                      id={`sale-title-${i}`}
                      name={`sale[${i}][title]`}
                      type="text"
                      defaultValue={s.title}
                      maxLength={80}
                      placeholder="Summer Glow Event"
                    />
                  </div>
                  <div className="sq-field">
                    <label htmlFor={`sale-discount-${i}`}>Discount text</label>
                    <input
                      id={`sale-discount-${i}`}
                      name={`sale[${i}][discountText]`}
                      type="text"
                      defaultValue={s.discountText}
                      maxLength={80}
                      placeholder="20% off all serums · code GLOW20"
                    />
                    <small>Exact text the advisor can repeat. No fabrication beyond this.</small>
                  </div>
                  <div className="sq-field">
                    <label htmlFor={`sale-ends-${i}`}>Ends (optional)</label>
                    <input
                      id={`sale-ends-${i}`}
                      name={`sale[${i}][endsAt]`}
                      type="date"
                      defaultValue={s.endsAt}
                    />
                    <small>Expired promotions are automatically hidden from the advisor.</small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <button className="sq-cta" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save beauty settings"}
        </button>
      </Form>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── styles ───────────────────────────────────────────────────────────────────

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
:root {
  --sq-bg: #08070A; --sq-surface: #14111A; --sq-line: rgba(255,255,255,.08);
  --sq-line-acc: rgba(201,181,255,.35); --sq-text: #F4F2EE; --sq-mute: #8E8A99;
  --sq-grad: linear-gradient(135deg, #8B5CF6, #E879C8);
}
.sq-shell { font-family: "Manrope", system-ui, sans-serif; background: var(--sq-bg); color: var(--sq-text); min-height: 100vh; padding: 36px 40px; }
.sq-header { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--sq-line); }
.serif { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; }
.mono { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--sq-mute); }
.sq-eyebrow { font-size: 10.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--sq-mute); display: inline-flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sq-eyebrow__dot { width: 6px; height: 6px; border-radius: 999px; background: #E879C8; box-shadow: 0 0 8px #E879C8; }
.sq-h1 { font-size: 52px; line-height: 1; margin: 0; font-weight: 400; }
.sq-h1 em { font-style: italic; background: var(--sq-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-sub { font-size: 13px; color: var(--sq-mute); margin: 12px 0 0; }
.sq-banner { padding: 10px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 20px; }
.sq-banner--ok  { background: rgba(139,92,246,.1); border: 1px solid rgba(139,92,246,.35); color: #C4B5FD; }
.sq-banner--err { background: rgba(232,121,200,.08); border: 1px solid rgba(232,121,200,.3); color: #E879C8; }
.sq-form { max-width: 600px; display: flex; flex-direction: column; gap: 40px; }
.sq-section { display: flex; flex-direction: column; gap: 16px; }
.sq-section-title { font-size: 16px; font-weight: 600; margin: 0; }
.sq-section-sub { font-size: 12.5px; color: var(--sq-mute); margin: 0; line-height: 1.6; }
.sq-field { display: flex; flex-direction: column; gap: 6px; }
.sq-field label { font-size: 12.5px; color: var(--sq-text); display: flex; align-items: center; gap: 8px; }
.sq-field small { font-size: 11.5px; color: var(--sq-mute); }
.sq-field input[type=text], .sq-field input[type=url], .sq-field input[type=date] {
  background: var(--sq-surface); color: var(--sq-text); border: 1px solid var(--sq-line);
  border-radius: 10px; padding: 11px 14px; font-family: inherit; font-size: 14px;
  outline: none; transition: border-color .15s; }
.sq-field input:focus { border-color: var(--sq-line-acc); }
.sq-field--slider label { justify-content: space-between; }
.sq-field--slider input[type=range] {
  -webkit-appearance: none; width: 100%; height: 4px;
  background: linear-gradient(90deg, #8B5CF6, #E879C8);
  border-radius: 2px; outline: none; }
.sq-field--slider input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 16px; height: 16px; border-radius: 999px;
  background: #fff; border: 2px solid #8B5CF6; cursor: pointer; }
.sq-slider-val { font-family: "JetBrains Mono", monospace; font-size: 12px; color: #C4B5FD; }
.sq-toggle-row { display: flex; gap: 12px; }
.sq-toggle-label { cursor: pointer; }
.sq-toggle-label input[type=radio] { position: absolute; opacity: 0; pointer-events: none; }
.sq-toggle-card {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 16px 28px; background: var(--sq-surface); border: 1px solid var(--sq-line);
  border-radius: 12px; font-size: 13px; font-weight: 500; transition: border-color .15s, box-shadow .15s; }
.sq-toggle-label input[type=radio]:checked + .sq-toggle-card {
  border-color: rgba(139,92,246,.7); box-shadow: 0 0 0 2px rgba(139,92,246,.25); }
.sq-toggle-card__icon { font-size: 22px; }
.sq-checkbox-row { display: flex; flex-direction: column; gap: 4px; }
.sq-checkbox-label { display: flex; align-items: center; gap: 10px; font-size: 13.5px; cursor: pointer; }
.sq-checkbox-label input[type=checkbox] { width: 16px; height: 16px; accent-color: #8B5CF6; cursor: pointer; }
.sq-checkbox-small { font-size: 11.5px; color: var(--sq-mute); margin-left: 26px; }
.sq-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.sq-table th { text-align: left; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--sq-mute); padding: 8px 12px; border-bottom: 1px solid var(--sq-line); }
.sq-table td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.04); }
.sq-table-cat { color: var(--sq-text); }
.sq-table-input { background: var(--sq-surface); color: var(--sq-text); border: 1px solid var(--sq-line); border-radius: 8px; padding: 6px 10px; font-family: inherit; font-size: 13px; width: 90px; outline: none; transition: border-color .15s; }
.sq-table-input:focus { border-color: var(--sq-line-acc); }
.sq-promos { display: flex; flex-direction: column; gap: 16px; }
.sq-promo-card { display: flex; gap: 16px; background: var(--sq-surface); border: 1px solid var(--sq-line); border-radius: 14px; padding: 18px; }
.sq-promo-num { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--sq-mute); padding-top: 2px; flex-shrink: 0; }
.sq-promo-fields { flex: 1; display: flex; flex-direction: column; gap: 12px; }
.sq-cta { align-self: flex-start; padding: 11px 22px; border: 0; border-radius: 999px; background: var(--sq-grad); color: #fff; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 18px rgba(139,92,246,.35); transition: opacity .15s; }
.sq-cta:disabled { opacity: .5; cursor: not-allowed; }
`;
