// /app/reports/monthly — the in-app surface for Session 1.
//
// Reads the latest MonthlyReport for the shop. Renders the markdown the
// worker pre-generated (so what's on screen matches exactly what was
// emailed — no re-render risk). Also exposes a "generate now" action for
// the merchant to preview the current 30d on demand instead of waiting
// for the 1st.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { synthesizeMonthlyReport, renderMonthlyReportMarkdown } from "@stylique/core";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, shopifyDomain: true },
  });
  if (!shop) return json({ ok: false as const, error: "shop_not_installed" });

  const latest = await prisma.monthlyReport.findFirst({
    where: { shopId: shop.id },
    orderBy: { periodEnd: "desc" },
    select: { id: true, periodStart: true, periodEnd: true, generatedAt: true, markdown: true, dataJson: true },
  });
  const history = await prisma.monthlyReport.findMany({
    where: { shopId: shop.id },
    orderBy: { periodEnd: "desc" },
    take: 12,
    select: { id: true, periodStart: true, periodEnd: true },
  });

  return json({
    ok: true as const,
    shopDomain: shop.shopifyDomain,
    latest: latest
      ? {
          ...latest,
          periodStart: latest.periodStart.toISOString(),
          periodEnd:   latest.periodEnd.toISOString(),
          generatedAt: latest.generatedAt.toISOString(),
        }
      : null,
    history: history.map((h) => ({
      ...h,
      periodStart: h.periodStart.toISOString(),
      periodEnd:   h.periodEnd.toISOString(),
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const data = await synthesizeMonthlyReport(prisma, { shopId: shop.id });
  const markdown = renderMonthlyReportMarkdown(data);
  const periodEnd = new Date(data.period.end);
  const periodStart = new Date(data.period.start);

  // Upsert through the unique constraint so a same-period re-run replaces.
  await prisma.monthlyReport.upsert({
    where: { shopId_periodStart: { shopId: shop.id, periodStart } },
    update: { dataJson: data as unknown as object, markdown, periodEnd, generatedAt: new Date() },
    create: { shopId: shop.id, periodStart, periodEnd, dataJson: data as unknown as object, markdown },
  });
  return json({ ok: true, generatedAt: new Date().toISOString() });
}

export default function MonthlyReportPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const generating = nav.state !== "idle";

  if (!data.ok) {
    return <main style={pageStyle}><p>Shop not installed.</p></main>;
  }

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(244,242,238,0.6)" }}>Monthly report</div>
          <h1 style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 42, fontWeight: 400, margin: "8px 0" }}>{data.shopDomain}</h1>
        </div>
        <Form method="post">
          <button type="submit" disabled={generating} style={generateBtn(generating)}>
            {generating ? "Generating…" : data.latest ? "Re-generate for current 30d" : "Generate first report"}
          </button>
        </Form>
      </header>

      {actionData?.ok && "generatedAt" in actionData && (
        <div style={{ background: "rgba(78,196,158,0.12)", border: "1px solid rgba(78,196,158,0.4)", color: "#4EC49E", padding: "12px 16px", borderRadius: 8, marginBottom: 24 }}>
          Report regenerated at {new Date(actionData.generatedAt).toLocaleString()}. Refreshing…
        </div>
      )}

      {!data.latest && (
        <div style={emptyStateStyle}>
          <h2 style={{ fontFamily: "Georgia, serif", fontStyle: "italic", margin: "0 0 8px" }}>No reports yet</h2>
          <p style={{ color: "rgba(244,242,238,0.7)", lineHeight: 1.6 }}>
            Reports auto-generate on the <strong>1st of each month at 08:00 UTC</strong> covering the prior 30 days. You can also generate an on-demand preview using the button above — it'll show you exactly what your next month-1 report will look like, against today's data.
          </p>
        </div>
      )}

      {data.latest && (
        <article style={reportStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(244,242,238,0.6)", fontSize: 13, marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <span>Period: <strong>{data.latest.periodStart.slice(0, 10)} → {data.latest.periodEnd.slice(0, 10)}</strong></span>
            <span>Generated: <strong>{new Date(data.latest.generatedAt).toLocaleString()}</strong></span>
          </div>
          <div
            style={markdownStyle}
            dangerouslySetInnerHTML={{ __html: simpleMarkdown(data.latest.markdown) }}
          />
        </article>
      )}

      {data.history.length > 1 && (
        <section style={{ marginTop: 48 }}>
          <h3 style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(244,242,238,0.6)" }}>Prior reports</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {data.history.slice(1).map((h) => (
              <li key={h.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "12px 16px", color: "rgba(244,242,238,0.8)", fontSize: 14 }}>
                {h.periodStart.slice(0, 10)} → {h.periodEnd.slice(0, 10)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 1000,
  margin: "0 auto",
  padding: "48px 32px 96px",
  color: "#F4F2EE",
  background: "#0B0A0F",
  minHeight: "100vh",
};
const reportStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.025)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: "32px 36px",
};
const emptyStateStyle: React.CSSProperties = {
  background: "rgba(139,92,246,0.06)",
  border: "1px solid rgba(139,92,246,0.24)",
  borderRadius: 14,
  padding: "32px 36px",
  maxWidth: 640,
};
const markdownStyle: React.CSSProperties = {
  lineHeight: 1.7,
  fontSize: 15,
  color: "rgba(244,242,238,0.92)",
};
function generateBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg, #8B5CF6, #C7B8FF)",
    color: disabled ? "rgba(244,242,238,0.5)" : "#0E0A14",
    border: "none",
    borderRadius: 999,
    padding: "10px 18px",
    fontFamily: "monospace",
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

/**
 * Minimal markdown → HTML for the report body. We don't pull a full markdown
 * lib because the rendered output is server-generated, so the surface is
 * trusted and the dialect we use is small (headings, lists, tables, bold,
 * code, blockquote, hr). This stays small + auditable + zero deps.
 */
function simpleMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  let inTable = false;
  let tableHead = "";
  const flushList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const flushTable = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; tableHead = ""; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "---") { flushList(); flushTable(); out.push("<hr style='border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0'>"); continue; }
    if (line === "") { flushList(); flushTable(); continue; }
    if (line.startsWith("# "))   { flushList(); flushTable(); out.push(`<h1 style='font-family:Georgia,serif;font-style:italic;font-size:32px;margin:24px 0 12px;font-weight:400'>${esc(line.slice(2))}</h1>`); continue; }
    if (line.startsWith("## "))  { flushList(); flushTable(); out.push(`<h2 style='font-family:Georgia,serif;font-style:italic;font-size:24px;margin:36px 0 12px;font-weight:400'>${esc(line.slice(3))}</h2>`); continue; }
    if (line.startsWith("### ")) { flushList(); flushTable(); out.push(`<h3 style='font-size:18px;margin:20px 0 8px;font-weight:600'>${esc(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("> "))   { flushList(); flushTable(); out.push(`<blockquote style='border-left:3px solid #8B5CF6;padding:8px 16px;margin:12px 0;color:rgba(244,242,238,0.85);font-size:17px'>${formatInline(esc(line.slice(2)))}</blockquote>`); continue; }
    if (line.startsWith("|") && line.endsWith("|")) {
      flushList();
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      const isSep = cells.every((c) => /^:?-+:?$/.test(c));
      if (isSep) continue;
      if (!inTable) {
        inTable = true;
        tableHead = cells.map((c) => `<th style='text-align:left;padding:8px;border-bottom:1px solid rgba(255,255,255,0.16)'>${formatInline(esc(c))}</th>`).join("");
        out.push(`<table style='border-collapse:collapse;width:100%;margin:12px 0;font-size:14px'><thead><tr>${tableHead}</tr></thead><tbody>`);
      } else {
        out.push(`<tr>${cells.map((c) => `<td style='padding:8px;border-bottom:1px solid rgba(255,255,255,0.06)'>${formatInline(esc(c))}</td>`).join("")}</tr>`);
      }
      continue;
    } else { flushTable(); }
    if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul style='padding-left:24px;margin:8px 0'>"); inList = true; }
      out.push(`<li style='margin:4px 0'>${formatInline(esc(line.slice(2)))}</li>`);
      continue;
    } else { flushList(); }
    out.push(`<p style='margin:8px 0'>${formatInline(esc(line))}</p>`);
  }
  flushList(); flushTable();
  return out.join("\n");
}
function formatInline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code style='background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;font-size:0.92em'>$1</code>");
}
