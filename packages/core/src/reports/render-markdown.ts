// Markdown renderer for MonthlyReportData. Pure function, deterministic.
//
// Layout matches the 5-expert panel spec exactly:
//   1. Cover headline (the one number)
//   2. What Changed (3 deltas + 2 regressions)
//   3. Catalog Gaps & Near-Misses (with revenue-at-risk + try-on abandons)
//   4. Funnel & Conversion (with N alongside every number)
//   5. Bundles (4-condition gate, honest projection)
//   6. Voice of the Shopper (≥15 occurrence floor)
//   7. Methodology (CTO's page — N, window, exclusions)
//
// Honest framing rules (panel mandate):
//   - Round assisted revenue to nearest $100 when displaying ("$28.1k")
//   - NEVER hide a regression (every red appears in §2)
//   - NEVER quote lift % without N
//   - Sample sizes printed alongside every headline number

import type { MonthlyReportData } from "./monthly.js";

function money(cents: number, currency: string): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) {
    return `${currency} ${(dollars / 1_000_000).toFixed(1)}M`;
  }
  if (dollars >= 1_000) {
    return `${currency} ${(dollars / 1_000).toFixed(1)}k`;
  }
  return `${currency} ${Math.round(dollars).toLocaleString()}`;
}

function fmtDelta(p: number | null): string {
  if (p == null) return "(no prior data)";
  return `${p >= 0 ? "+" : ""}${p}%`;
}

function fmtRange(start: string, end: string): string {
  return `${start.slice(0, 10)} → ${end.slice(0, 10)}`;
}

const COLOR_LABEL: Record<MonthlyReportData["cover"]["headlineColor"], string> = {
  green: "🟢 Strong month",
  amber: "🟡 Mixed",
  red:   "🔴 Needs attention",
  neutral: "⚪ Establishing baseline",
};

export function renderMonthlyReportMarkdown(d: MonthlyReportData): string {
  const lines: string[] = [];

  // ── COVER ──
  lines.push(`# Stylique monthly report — ${d.shop.domain}`);
  lines.push("");
  lines.push(`**Period:** ${fmtRange(d.period.start, d.period.end)} (vs. ${fmtRange(d.prior.start, d.prior.end)})`);
  lines.push("");
  lines.push(`## ${COLOR_LABEL[d.cover.headlineColor]}`);
  lines.push("");
  lines.push(`> ${d.cover.headlineSentence}`);
  lines.push("");
  if (d.cover.shareOfSessionsPct != null) {
    lines.push(`Stylique touched **${d.cover.shareOfSessionsPct}%** of all sessions this period.`);
    lines.push("");
  }

  // ── 2. WHAT CHANGED ──
  lines.push("## 2. What changed");
  lines.push("");
  if (d.whatChanged.deltas.length === 0 && d.whatChanged.regressions.length === 0) {
    lines.push("_No material movement vs prior period — this is your baseline month._");
  } else {
    if (d.whatChanged.deltas.length > 0) {
      lines.push("**Moved up:**");
      lines.push("");
      for (const m of d.whatChanged.deltas) {
        lines.push(`- **${m.metric}**: ${m.from.toLocaleString()} → ${m.to.toLocaleString()} (${fmtDelta(m.deltaPct)})`);
      }
      lines.push("");
    }
    if (d.whatChanged.regressions.length > 0) {
      lines.push("**Moved down (always shown, never hidden):**");
      lines.push("");
      for (const m of d.whatChanged.regressions) {
        lines.push(`- **${m.metric}**: ${m.from.toLocaleString()} → ${m.to.toLocaleString()} (${fmtDelta(m.deltaPct)})`);
      }
      lines.push("");
    }
  }

  // ── 3. CATALOG GAPS & NEAR-MISSES ──
  lines.push("## 3. Catalog gaps & near-misses");
  lines.push("");
  if (d.catalogGaps.topGaps.length === 0 && d.catalogGaps.tryonAbandons.length === 0) {
    lines.push("_Shoppers found what they were looking for. Nothing material to reorder this month._");
  } else {
    if (d.catalogGaps.topGaps.length > 0) {
      const totalAtRisk = d.catalogGaps.topGaps.reduce((s, g) => s + g.revenueAtRiskCents, 0);
      lines.push(`**${money(totalAtRisk, d.shop.currency)} left on the table** across ${d.catalogGaps.topGaps.length} categories shoppers asked for and you didn't have.`);
      lines.push("");
      lines.push("| Category | Asks | Revenue at risk | Sample queries |");
      lines.push("|---|---:|---:|---|");
      for (const g of d.catalogGaps.topGaps) {
        const samples = g.sampleQueries.slice(0, 2).map((q) => `"${q}"`).join(" · ") || "—";
        lines.push(`| ${g.category} | ${g.count} | ${money(g.revenueAtRiskCents, d.shop.currency)} | ${samples} |`);
      }
      lines.push("");
    }
    if (d.catalogGaps.tryonAbandons.length > 0) {
      lines.push("**Try-on abandons** (shoppers engaged the fitting room, didn't add to bag within 24h):");
      lines.push("");
      lines.push("| Product | Abandons | Revenue at risk |");
      lines.push("|---|---:|---:|");
      for (const t of d.catalogGaps.tryonAbandons) {
        lines.push(`| ${t.productName} | ${t.count} | ${money(t.revenueAtRiskCents, d.shop.currency)} |`);
      }
      lines.push("");
    }
  }

  // ── 4. FUNNEL & CONVERSION ──
  lines.push("## 4. Funnel & conversion");
  lines.push("");
  lines.push(`- Sessions: **${d.funnel.sessions.toLocaleString()}**`);
  lines.push(`- Stylique-touched: **${d.funnel.miraTouchedSessions.toLocaleString()}**`);
  lines.push(`- Add-to-bag events: **${d.funnel.atcEvents.toLocaleString()}**`);
  lines.push(`- Confirmed orders: **${d.funnel.confirmedOrders.toLocaleString()}**`);
  if (d.funnel.aovAssistedCents != null && d.funnel.aovBaselineCents != null) {
    lines.push("");
    lines.push(`**AOV split** (N alongside, per panel's mandate):`);
    lines.push(`- Stylique-assisted: **${money(d.funnel.aovAssistedCents, d.shop.currency)}** (n=${d.funnel.aovN.assisted})`);
    lines.push(`- Baseline: **${money(d.funnel.aovBaselineCents, d.shop.currency)}** (n=${d.funnel.aovN.baseline})`);
    if (d.funnel.liftPct != null) {
      lines.push(`- **Lift: ${fmtDelta(d.funnel.liftPct)}** (both sides ≥${200} orders — honest %)`);
    } else {
      lines.push(`- _Lift % not quoted: one side below ${200} orders. Re-check next month as volume builds._`);
    }
  }
  lines.push("");

  // ── 5. BUNDLES ──
  lines.push("## 5. Bundle opportunities");
  lines.push("");
  if (d.bundles.orphanAttachPairs.length === 0) {
    lines.push("_No pairs cleared the honest gate this period (co-engage ≥15 AND co-intent ≥5 AND co-purchase ≥3 AND not already a merchandised collection)._");
  } else {
    lines.push(`**${d.bundles.orphanAttachPairs.length} pair${d.bundles.orphanAttachPairs.length === 1 ? "" : "s"}** cleared the 4-condition gate (co-engage + co-intent + co-purchase + no existing collection). Each is a real bundle moment.`);
    lines.push("");
    lines.push("| A | B | Co-engaged | Co-intent | Co-bought | Projected attach |");
    lines.push("|---|---|---:|---:|---:|---:|");
    for (const p of d.bundles.orphanAttachPairs) {
      lines.push(`| ${p.aName} | ${p.bName} | ${p.coEngage} | ${p.coIntent} | ${p.coPurchase} | ${money(p.projectedAttachRevenueCents, d.shop.currency)} |`);
    }
    lines.push("");
  }

  // ── 6. VOICE ──
  lines.push("## 6. Voice of the shopper");
  lines.push("");
  if (d.voice.topThemes.length === 0) {
    lines.push(`_No themes cleared the ≥${d.methodology.minThemeOccurrences}-occurrence floor this period. Themes shown only when they survive statistical noise._`);
  } else {
    lines.push("**Top themes** (each backed by ≥15 conversations — no n=3 anecdotes):");
    lines.push("");
    for (const t of d.voice.topThemes) {
      lines.push(`- **${t.theme}** — ${t.count} mentions`);
    }
    lines.push("");
  }
  if (d.voice.returnsByReason.length > 0) {
    const totalReturns = d.voice.returnsByReason.reduce((s, r) => s + r.count, 0);
    lines.push(`**Returns by reason** (${totalReturns} returns this period):`);
    lines.push("");
    for (const r of d.voice.returnsByReason) {
      const human = r.reasonBucket.replace(/_/g, " ");
      lines.push(`- ${human}: ${r.count} (${r.sharePct}%)`);
    }
    lines.push("");
  }

  // ── 7. METHODOLOGY ──
  lines.push("## 7. Methodology & data quality");
  lines.push("");
  lines.push(`- Attribution window: **${d.methodology.attributionWindowDays} days** before checkout`);
  lines.push(`- Minimum orders to quote a lift %: **${d.methodology.minOrdersForLiftQuote}**`);
  lines.push(`- Minimum mentions to surface a theme: **${d.methodology.minThemeOccurrences}**`);
  lines.push("");
  lines.push("**Sample sizes (every section grounded in real N):**");
  lines.push("");
  for (const [k, v] of Object.entries(d.methodology.sampleSizes)) {
    lines.push(`- ${k}: ${v.toLocaleString()}`);
  }
  lines.push("");
  lines.push(`Generated: ${d.methodology.dataFreshnessAt}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("_This report is honestly framed and methodologically grounded. Every headline number survives the methodology page above. Regressions are never hidden. Lift % only appears when both sides clear the order-count floor._");
  return lines.join("\n");
}
