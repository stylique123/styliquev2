// Admin settings — configure the in-store stylist's name + avatar per brand.
// Stored on Plan.planFeaturesJson.stylist.{stylistName, avatarUrl}. Live-merged
// into PlanFeatures by resolveFeatures() in @stylique/core.
//
// Minimal Polaris-free UI to match the dashboard's editorial aesthetic.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: { select: { planFeaturesJson: true, tier: true } } },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const overrides = (shop.plan?.planFeaturesJson as { stylist?: { stylistName?: string; avatarUrl?: string; voice?: string } } | null) ?? null;
  return json({
    tier: shop.plan?.tier ?? "STARTER",
    stylistName: overrides?.stylist?.stylistName ?? "Mira",
    avatarUrl:   overrides?.stylist?.avatarUrl ?? "",
    voice:       overrides?.stylist?.voice ?? "warm_friend",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const stylistName = String(formData.get("stylistName") ?? "").trim().slice(0, 40) || "Mira";
  const avatarUrl   = String(formData.get("avatarUrl") ?? "").trim().slice(0, 500);
  const voice       = String(formData.get("voice") ?? "warm_friend");

  // Validate URL shape (light — Shopify CDN or any https).
  if (avatarUrl && !/^https:\/\//.test(avatarUrl)) {
    return json({ error: "Avatar URL must start with https://" }, { status: 400 });
  }
  const validVoices = ["warm_friend", "older_sister", "editorial", "streetwear_casual", "fashion_press"];
  if (!validVoices.includes(voice)) {
    return json({ error: "Unknown voice" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: { select: { id: true, planFeaturesJson: true } } },
  });
  if (!shop?.plan) throw new Response("Plan not found", { status: 404 });

  const current = (shop.plan.planFeaturesJson as Record<string, unknown> | null) ?? {};
  const currentStylist = (current.stylist as Record<string, unknown> | undefined) ?? {};
  const next = { ...current, stylist: { ...currentStylist, stylistName, avatarUrl, voice } };

  await prisma.plan.update({
    where: { id: shop.plan.id },
    data: { planFeaturesJson: next as object },
  });
  return redirect("/app/settings/stylist?saved=1");
}

export default function StylistSettingsPage() {
  const d = useLoaderData<typeof loader>();
  const ad = useActionData<typeof action>();
  const nav = useNavigation();
  const saving = nav.state === "submitting";

  return (
    <div className="sq-shell">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <header className="sq-header">
        <div>
          <div className="sq-eyebrow"><span className="sq-eyebrow__dot" /> Stylique · Stylist settings</div>
          <h1 className="sq-h1"><span className="serif">Customize</span><em className="serif"> your stylist.</em></h1>
          <p className="sq-sub">Once per brand. Shoppers see this name + face on every page.</p>
        </div>
      </header>

      <Form method="post" className="sq-form">
        <div className="sq-field">
          <label htmlFor="stylistName">Stylist name</label>
          <input
            id="stylistName" name="stylistName" type="text"
            defaultValue={d.stylistName} maxLength={40}
            placeholder="Mira"
          />
          <small>The name shoppers see in the dock header and when she introduces herself.</small>
        </div>

        <div className="sq-field">
          <label htmlFor="avatarUrl">Avatar URL</label>
          <input
            id="avatarUrl" name="avatarUrl" type="url"
            defaultValue={d.avatarUrl}
            placeholder="https://cdn.shopify.com/.../mira.png"
          />
          <small>HTTPS image, square preferred. 256×256 minimum. Leave blank for the default gradient mark.</small>
          {d.avatarUrl && (
            <div className="sq-preview">
              <img src={d.avatarUrl} alt="" />
              <span className="mono">current</span>
            </div>
          )}
        </div>

        <div className="sq-field">
          <label htmlFor="voice">Voice</label>
          <select id="voice" name="voice" defaultValue={d.voice}>
            <option value="warm_friend">Warm best-friend (default)</option>
            <option value="older_sister">Knowledgeable older sister</option>
            <option value="editorial">Fashion-press editorial</option>
            <option value="streetwear_casual">Streetwear native</option>
            <option value="fashion_press">High-fashion press (sparse, allusive)</option>
          </select>
          <small>How she sounds. Same friend underneath — different register.</small>
        </div>

        {ad?.error && <div className="sq-error">{ad.error}</div>}
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
.sq-header { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--sq-line); }
.serif { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; }
.mono { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--sq-mute); }
.sq-eyebrow { font-size: 10.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--sq-mute); display: inline-flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sq-eyebrow__dot { width: 6px; height: 6px; border-radius: 999px; background: #8B5CF6; box-shadow: 0 0 8px #8B5CF6; }
.sq-h1 { font-size: 52px; line-height: 1; margin: 0; font-weight: 400; }
.sq-h1 em { font-style: italic; background: var(--sq-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-sub { font-size: 13px; color: var(--sq-mute); margin: 12px 0 0; }
.sq-form { max-width: 540px; display: flex; flex-direction: column; gap: 22px; }
.sq-field { display: flex; flex-direction: column; gap: 6px; }
.sq-field label { font-size: 12.5px; color: var(--sq-text); }
.sq-field small { font-size: 11.5px; color: var(--sq-mute); }
.sq-field input, .sq-field select { background: var(--sq-surface); color: var(--sq-text); border: 1px solid var(--sq-line); border-radius: 10px; padding: 11px 14px; font-family: inherit; font-size: 14px; outline: none; transition: border-color .15s; }
.sq-field input:focus, .sq-field select:focus { border-color: var(--sq-line-acc); }
.sq-preview { display: inline-flex; align-items: center; gap: 12px; margin-top: 8px; }
.sq-preview img { width: 48px; height: 48px; border-radius: 999px; object-fit: cover; border: 1px solid var(--sq-line); }
.sq-cta { align-self: flex-start; padding: 11px 22px; border: 0; border-radius: 999px; background: var(--sq-grad); color: #fff; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 18px rgba(139,92,246,.35); }
.sq-cta:disabled { opacity: .5; cursor: not-allowed; }
.sq-error { padding: 10px 14px; color: #E879C8; background: rgba(232,121,200,.08); border: 1px solid rgba(232,121,200,.3); border-radius: 10px; font-size: 13px; }
`;
