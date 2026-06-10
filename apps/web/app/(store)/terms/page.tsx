// Minimal terms stub. Replace with counsel-reviewed terms before public launch.

import Link from "next/link";

export const metadata = { title: "Terms · Stylique" };

export default function TermsPage() {
  return (
    <main className="lp-legal">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <header>
        <Link href="/" className="serif lp-legal__brand">Stylique<span>.</span></Link>
      </header>
      <article>
        <div className="lp-eyebrow"><span className="lp-eyebrow__dot" />Terms</div>
        <h1 className="serif">The short version.</h1>
        <p className="lede">
          Stylique is sold to fashion brands. By installing the Stylique app on your Shopify store you
          agree to the following. A full agreement reviewed by counsel will replace this stub before
          public launch.
        </p>

        <h2 className="serif">What we provide</h2>
        <ul>
          <li>An AI stylist and virtual try-on experience installed via your Shopify theme.</li>
          <li>Tier-based usage limits as documented on the pricing page.</li>
          <li>Brand-side analytics, recommendations, and an admin dashboard.</li>
        </ul>

        <h2 className="serif">What we ask of you</h2>
        <ul>
          <li>Don't misrepresent Stylique's output as a human stylist's professional advice on medical, allergy, or accessibility-critical fit.</li>
          <li>Honour your shoppers' privacy choices. We honour ours.</li>
          <li>Pay your invoices on the agreed cadence.</li>
        </ul>

        <h2 className="serif">Termination</h2>
        <p>
          Either side can terminate with 30 days' notice. On termination we will export your brand-side data on request and delete what you don't take.
        </p>

        <h2 className="serif">Liability</h2>
        <p>
          Stylique's liability under any single billing cycle is capped at the fees paid for that cycle. We are not liable for indirect or consequential damages.
        </p>

        <p className="meta mono">This stub will be replaced by full terms reviewed by counsel before public launch.</p>
      </article>
    </main>
  );
}

const STYLES = `
.lp-legal { max-width: 760px; margin: 0 auto; padding: 80px 32px 120px; }
.lp-legal header { margin-bottom: 64px; }
.lp-legal__brand { font-size: 20px; color: var(--text); }
.lp-legal__brand span { background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lp-legal h1 { font-size: clamp(36px, 5vw, 56px); margin: 14px 0 24px; line-height: 1.08; letter-spacing: -0.015em; font-weight: 400; }
.lp-legal h2 { font-size: 24px; margin: 40px 0 12px; font-weight: 400; }
.lp-legal p, .lp-legal li { font-size: 15px; line-height: 1.6; color: var(--mute); margin: 0 0 12px; }
.lp-legal ul { padding-left: 22px; margin: 0 0 24px; }
.lp-legal .lede { font-size: 17px; line-height: 1.55; color: var(--text); margin-bottom: 24px; }
.lp-legal .meta { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line); }
.lp-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 10.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--mute); font-family: var(--mono); }
.lp-eyebrow__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--electric); box-shadow: 0 0 10px var(--electric); }
`;
