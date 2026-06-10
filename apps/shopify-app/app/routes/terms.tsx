// /terms — Shopify App Store listing requires a reachable terms-of-service page at
// the URL declared in shopify.app.toml (terms_of_service_url). Served from the
// Shopify app origin so the declared URL always returns 200 even if apps/web
// deploys separately (panel P1). Loader-only HTML — no React/runtime.
import type { LoaderFunctionArgs } from "@remix-run/node";

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Terms · Stylique</title>
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
  <div class="eyebrow">Terms of Service</div>
  <h1>The deal, in plain language.</h1>
  <p class="lede">Stylique provides an AI stylist, virtual try-on, and merchandising intelligence to Shopify
  merchants. By installing the app you agree to these terms.</p>
  <h2>The service</h2>
  <p>Stylique embeds the Mira stylist and virtual try-on on your storefront. Merchant analytics and workflow tools
  are provided through the separate Stylique merchant workspace. Features and usage limits depend on your subscription tier.</p>
  <h2>Acceptable use</h2>
  <p>You agree not to misuse the service, attempt to extract another merchant's data, or use Stylique to violate Shopify's
  terms or applicable law. We may suspend access for abuse.</p>
  <h2>Data &amp; privacy</h2>
  <p>Our handling of shopper and merchant data is described in our <a href="/privacy">Privacy Policy</a>. Shopper chat
  transcripts and per-shopper taste vectors are never shared with other merchants.</p>
  <h2>Billing</h2>
  <p>Paid tiers are billed through Shopify's billing system. You can change or cancel your subscription from the app at any time;
  access to paid features ends when the subscription lapses.</p>
  <h2>Availability &amp; liability</h2>
  <p>The service is provided "as is" without warranty. Stylique is not liable for indirect or consequential damages. AI-generated
  styling, sizing, and imagery are suggestions, not guarantees of fit or outcome.</p>
  <h2>Contact</h2>
  <p>Questions: <a href="mailto:support@stylique.fashion">support@stylique.fashion</a>.</p>
  <p class="meta">These terms will be expanded by counsel before public launch.</p>
</main></body></html>`;

export async function loader(_args: LoaderFunctionArgs) {
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
