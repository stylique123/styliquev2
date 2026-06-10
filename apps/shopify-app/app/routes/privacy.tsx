// /privacy — Shopify App Store listing requires a reachable privacy policy at the
// URL declared in shopify.app.toml (privacy_policy_url). The marketing copy lived
// only in apps/web; if the apps deploy separately that URL 404s and the listing
// review auto-rejects (panel P1). This serves the same policy from the Shopify app
// origin so the declared URL always returns 200. Loader-only HTML — no React/runtime.
import type { LoaderFunctionArgs } from "@remix-run/node";

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Privacy · Stylique</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0E0A14; color:#F4F2EE; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; line-height:1.65; }
  main { max-width:760px; margin:0 auto; padding:72px 28px 110px; }
  h1 { font-size:30px; line-height:1.2; margin:8px 0 18px; }
  h2 { font-size:18px; margin:34px 0 8px; }
  a { color:#b794f6; }
  .eyebrow { font-family: ui-monospace, monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:#b794f6; }
  .lede { font-size:18px; color:#cfc9d6; }
  .meta { font-family: ui-monospace, monospace; font-size:12px; color:#8a8294; margin-top:40px; }
  strong { color:#fff; }
</style></head><body><main>
  <div class="eyebrow">Privacy</div>
  <h1>What we collect. What we never share.</h1>
  <p class="lede">Stylique is a personal stylist embedded in fashion brand stores. We process the minimum
  shopper data needed to make Mira useful, we store it on the brand's behalf, and we never sell or rent it to a third party.</p>
  <h2>What we collect</h2>
  <ul>
    <li>An anonymous shopper id (cookie) so Mira can remember a conversation across visits.</li>
    <li>Body type, height, weight, and fit preference if the shopper volunteers them.</li>
    <li>Chat history — the conversation thread between the shopper and Mira.</li>
    <li>Behaviour signals on the brand's storefront: opens, clicks, cart events, mood + model picks.</li>
    <li>Email + name if the shopper explicitly chooses to save their taste profile.</li>
  </ul>
  <h2>Images</h2>
  <p>When a shopper sends a photo to Mira, the image is passed once to the language model and dropped.
  <strong> We do not store shopper-uploaded images on Stylique servers.</strong></p>
  <h2>Who sees what</h2>
  <p>Brands see aggregate analytics about their own shoppers. Brands <strong>never</strong> see individual chat transcripts or
  per-shopper taste vectors. Ultimate-tier brands additionally see anonymised cross-brand benchmarks — never tied to any individual brand or shopper.</p>
  <h2>Data deletion (GDPR)</h2>
  <p>Stylique implements Shopify's mandatory <code>customers/data_request</code>, <code>customers/redact</code>, and
  <code>shop/redact</code> webhooks. When a store uninstalls or a shopper requests erasure, the associated data is exported or hard-deleted.</p>
  <h2>Your rights</h2>
  <p>Email <a href="mailto:privacy@stylique.fashion">privacy@stylique.fashion</a> to access, export, or delete the data tied to your shopper id.</p>
  <p class="meta">This policy will be expanded by counsel before public launch.</p>
</main></body></html>`;

export async function loader(_args: LoaderFunctionArgs) {
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
