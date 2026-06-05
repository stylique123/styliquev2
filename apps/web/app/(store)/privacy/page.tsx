// Minimal privacy stub so the landing footer doesn't 404. Replace with real
// privacy policy before public launch.

import Link from "next/link";

export const metadata = { title: "Privacy · Stylique" };

export default function PrivacyPage() {
  return (
    <main className="lp-legal">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <header>
        <Link href="/" className="serif lp-legal__brand">Stylique<span>.</span></Link>
      </header>
      <article>
        <div className="lp-eyebrow"><span className="lp-eyebrow__dot" />Privacy</div>
        <h1 className="serif">What we collect. What we never share.</h1>
        <p className="lede">
          Stylique is a personal stylist embedded in fashion brand stores. We process the minimum
          shopper data needed to make Mira useful, we store it on the brand's behalf, and we never
          sell or rent it to a third party.
        </p>

        <h2 className="serif">What we collect</h2>
        <ul>
          <li>An anonymous shopper id (cookie) so Mira can remember a conversation across visits.</li>
          <li>Body type, height, weight, and fit preference if the shopper volunteers them.</li>
          <li>Chat history — the conversation thread between the shopper and Mira.</li>
          <li>Behaviour signals on the brand's storefront: opens, clicks, cart events, mood + model picks.</li>
          <li>Email + name if the shopper explicitly chooses to save their taste profile.</li>
        </ul>

        <h2 className="serif">Images</h2>
        <p>
          When a shopper sends a photo to Mira, the image is passed once to the language model and dropped.
          <strong> We do not store shopper-uploaded images on Stylique servers.</strong>
        </p>

        <h2 className="serif">Who sees what</h2>
        <p>
          Brands see aggregate analytics about their own shoppers. Brands <strong>never</strong> see individual chat transcripts or per-shopper taste vectors.
          Ultimate-tier brands additionally see anonymised cross-brand benchmarks — never tied to any individual brand or shopper.
        </p>

        <h2 className="serif">Your rights</h2>
        <p>
          Email <a href="mailto:privacy@stylique.fashion">privacy@stylique.fashion</a> to access, export, or delete the data tied to your shopper id.
        </p>

        <p className="meta mono">This stub will be replaced by a full policy reviewed by counsel before public launch.</p>
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
.lp-legal strong { color: var(--text); font-weight: 600; }
.lp-legal ul { padding-left: 22px; margin: 0 0 24px; }
.lp-legal a { color: var(--text); border-bottom: 1px solid var(--line-acc); }
.lp-legal .lede { font-size: 17px; line-height: 1.55; color: var(--text); margin-bottom: 24px; }
.lp-legal .meta { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line); }
.lp-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 10.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--mute); font-family: var(--mono); }
.lp-eyebrow__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--electric); box-shadow: 0 0 10px var(--electric); }
`;
