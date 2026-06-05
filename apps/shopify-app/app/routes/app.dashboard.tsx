// Stylique merchant dashboard — premium editorial dark surface.
//
// This file deliberately steps OFF Polaris. Polaris is brand-Shopify; we want
// fashion-magazine. The Shopify admin embeds this iframe and we paint it in
// our own paper.
//
// Single fetch on the server: buildOverview() returns the tier-shaped JSON.
// The page renders only what came back — Starter shoppers literally won't
// receive catalog/taste/benchmark sections in the payload.

import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { buildOverview } from "../lib/dashboard.server";
import type {
  StarterInsights,
  GrowthInsights,
  UltimateInsights,
} from "../lib/insights.server";
import type {
  FashionIntelligence,
  ExecCard,
  ColorRow,
  Trend,
} from "../lib/fashion-intelligence.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, shopifyDomain: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  // Assisted revenue — sum all MIRA_ASSISTED_ORDER events in the last 30 days.
  // Fix 8 — surface pending Studio sets that Mira triggered, so the admin can
  // act on them. The dock fires stylique:open-studio CustomEvent in the storefront
  // but that can't cross the embedded admin iframe; the badge below is the bridge.
  const [data, assistedRevenueRows, miraStudioPending] = await Promise.all([
    buildOverview({ shopId: shop.id, windowDays: 30 }),
    prisma.analyticsEvent.findMany({
      where: {
        shopId: shop.id,
        name: "MIRA_ASSISTED_ORDER",
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { payload: true },
    }),
    prisma.creativeSet.count({
      where: {
        shopId: shop.id,
        status: "PENDING",
        triggeredBy: { startsWith: "stylist_combo:" },
        createdAt: { gte: new Date(Date.now() - 86400_000) },
      },
    }),
  ]);

  const assistedRevenueCents = assistedRevenueRows.reduce((sum, row) => {
    const p = row.payload as { assistedRevenueCents?: number } | null;
    return sum + (p?.assistedRevenueCents ?? 0);
  }, 0);
  const assistedRevenueFormatted = `$${(assistedRevenueCents / 100).toFixed(0)}`;
  const assistedOrderCount = assistedRevenueRows.length;

  return json({
    shopDomain: shop.shopifyDomain,
    ...data,
    assistedRevenue: {
      formatted: assistedRevenueFormatted,
      orderCount: assistedOrderCount,
    },
    miraStudioPending,
  });
}

// ─── Tiny presentational helpers (kept inline so the file ships standalone) ─

const fmt = {
  num(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  },
  pct(n: number): string { return (n * 100).toFixed(1) + "%"; },
  share(n: number): string { return Math.round(n * 100) + "%"; },
};

function tierBadge(tier: string): string {
  if (tier === "STARTER") return "Starter";
  if (tier === "GROWTH") return "Growth";
  return "Ultimate";
}

function severityHue(sev: string): string {
  if (sev === "URGENT")    return "var(--sq-pink)";
  if (sev === "ATTENTION") return "var(--sq-electric)";
  return "var(--sq-mute)";
}

// ─── The page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const d = useLoaderData<typeof loader>();
  const brandName = d.shopDomain.replace(".myshopify.com", "");
  const [searchParams] = useSearchParams();
  const generatedCombo = searchParams.get("generated");
  const tier = d.plan.tier as "STARTER" | "GROWTH" | "ULTIMATE";

  return (
    <div className="sq-shell">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      {generatedCombo && (
        <div className="sq-toast" role="status" aria-live="polite">
          ✓ Creative queued for &ldquo;{decodeURIComponent(generatedCombo)}&rdquo;
        </div>
      )}

      {/* Fix 8 — Mira-triggered Studio sets pending review (last 24h) */}
      {d.miraStudioPending > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            margin: "12px 24px 0",
            padding: "12px 16px",
            background: "#1c1a27",
            border: "1px solid #5b4fff",
            borderRadius: 8,
            color: "var(--sq-text, #fff)",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <span>
            <span style={{ color: "#a78bfa", marginRight: 6 }}>✦</span>
            Mira requested {d.miraStudioPending} creative{d.miraStudioPending > 1 ? "s" : ""} in the last 24h
          </span>
          <a href="/app/studio" style={{ color: "#a78bfa", textDecoration: "underline" }}>
            Review in Studio →
          </a>
        </div>
      )}

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header className="sq-header">
        <div>
          <div className="sq-eyebrow">
            <span className="sq-eyebrow__dot" /> Stylique · {tierBadge(tier)}
          </div>
          <h1 className="sq-h1">
            <span className="serif">{brandName}</span>
            <em className="serif"> is learning.</em>
          </h1>
          <p className="sq-sub">Last 30 days · across Studio · Widget · Stylist</p>
        </div>
        <div className="sq-header__right">
          <div className="sq-window">
            <span className="mono">{d.headline.windowDays}d</span>
          </div>
          {/* Nav badge — red dot with urgent item count */}
          {d.insightsBadgeCount > 0 && (
            <div className="sq-insights-badge" title={`${d.insightsBadgeCount} items need attention`}>
              {d.insightsBadgeCount}
            </div>
          )}
        </div>
      </header>

      {/* ─── Plan usage rail ────────────────────────────────────────── */}
      <UsageRail usage={d.plan.usage} />

      {/* ─────────────────────────────────────────────────────────────
          TIER-DIFFERENTIATED INSIGHTS
          Each tier renders its own section. Lower tiers see blurred
          previews of locked sections with an upgrade prompt overlay.
      ──────────────────────────────────────────────────────────────── */}

      {/* ─── STARTER: 3 KPI cards + conversion rate ─────────────────── */}
      <StarterInsightsPanel insights={d.insights as StarterInsights} />

      {/* ─── GROWTH: adds catalog gaps, combo perf, size drift, returns, sentiment ─ */}
      {tier === "GROWTH" || tier === "ULTIMATE" ? (
        <GrowthInsightsPanel insights={d.insights as GrowthInsights} />
      ) : (
        <LockedInsightsTeaser
          title="Catalog intelligence · Combo analytics · Sentiment themes"
          description="See which products shoppers asked for but you don't carry, how every combo is converting, and what your shoppers really feel — updated daily."
          ctaLabel="Upgrade to Growth"
          tier="GROWTH"
        />
      )}

      {/* ─── ULTIMATE: trend velocity, restocking, segments, creative perf ─ */}
      {tier === "ULTIMATE" ? (
        <UltimateInsightsPanel insights={d.insights as UltimateInsights} />
      ) : (
        <LockedInsightsTeaser
          title="Trend forecasting · Restocking predictions · Customer segments"
          description="See emerging trends across the Stylique network before they peak, predict stockouts weeks ahead, and identify your highest-value shoppers."
          ctaLabel="Upgrade to Ultimate"
          tier="ULTIMATE"
        />
      )}

      {/* ─── Headline KPIs ───────────────────────────────────────────── */}
      <section className="sq-grid sq-grid--kpis">
        <KpiCard label="Chat sessions" value={fmt.num(d.headline.chatSessions)} sub={`${fmt.num(d.headline.chatTurns)} turns`} accent="electric" />
        <KpiCard label="Combos proposed" value={fmt.num(d.headline.combosProposed)} sub="AI-curated looks" accent="pink" />
        <KpiCard label="Added to bag" value={fmt.num(d.headline.cartConfirmed)} sub={`from ${fmt.num(d.headline.combosProposed || 1)} combos`} accent="electric" />
        <KpiCard label="Try-on sessions" value={fmt.num(d.headline.tryOnSessions)} sub={`${fmt.num(d.headline.fitSubmitted)} fit checks`} accent="pink" />
        <KpiCard label="Creatives generated" value={fmt.num(d.headline.creativesGenerated)} sub="Studio" accent="electric" />
        <KpiCard label="Saved profiles" value={fmt.num(d.headline.signupsClaimed)} sub="email captured" accent="pink" />
      </section>

      {/* ─── Cart Attribution Funnel ─────────────────────────────────── */}
      <section className="sq-grid sq-grid--kpis">
        <KpiCard label="Mira-driven carts" value={fmt.num(d.headline.cartFromMira ?? 0)} sub="from chat recommendations" accent="electric" />
        <KpiCard label="Try-on carts" value={fmt.num(d.headline.cartFromTryon ?? 0)} sub="shopper saw it on model first" accent="pink" />
        <KpiCard label="Style guide carts" value={fmt.num(d.headline.cartFromWidgetStyle ?? 0)} sub="from Complete the Look" accent="electric" />
      </section>

      {/* ─── Mira-assisted revenue ───────────────────────────────────── */}
      <MiraAssistedRevenueCard
        formatted={d.assistedRevenue.formatted}
        orderCount={d.assistedRevenue.orderCount}
      />

      {/* ─── Fashion Intelligence — the four pillars (hero) ──────────── */}
      <FashionIntelligenceSection intel={d.fashionIntelligence} />

      {/* ─── Per-module deep-dive sections ───────────────────────────── */}
      <MiraModuleCard
        funnel={d.stylist.funnel}
        topCombos={d.stylist.topCombos}
        assistedRevenue={d.assistedRevenue}
        chatSessions={d.headline.chatSessions}
      />
      <VtoModuleCard
        widgetFunnel={d.widget.funnel}
        tryon={d.widget.tryon}
      />
      <SizeModuleCard fitSubmitted={d.headline.fitSubmitted} />
      {d.studio && <StudioModuleCard studio={d.studio} />}
      <EcosystemSection />

      {/* ─── Stylist + Widget side-by-side ───────────────────────────── */}
      <section className="sq-grid sq-grid--split">
        <StylistFunnelCard funnel={d.stylist.funnel} topCombos={d.stylist.topCombos} />
        <WidgetCard funnel={d.widget.funnel} moods={d.widget.topMoods} models={d.widget.topModels} tryon={d.widget.tryon} />
      </section>

      {/* ─── Studio (always — feature flag in payload) ───────────────── */}
      {d.studio && <StudioCard data={d.studio} />}

      {/* ─── Catalog gaps (Growth+) ──────────────────────────────────── */}
      {d.catalog && <CatalogGapCard catalog={d.catalog} />}

      {/* ─── Brand taste profile (Growth+) ───────────────────────────── */}
      {d.taste && <TasteProfileCard taste={d.taste} />}

      {/* ─── Shopper Conversations / sentiment (all tiers) ───────────── */}
      <ShopperConversationsCard sentiment={d.sentiment} />

      {/* ─── Network benchmarks (Ultimate) ───────────────────────────── */}
      {d.benchmarks && d.benchmarks.length > 0 && <BenchmarkCard benchmarks={d.benchmarks} />}

      {/* ─── Beauty Intelligence (beauty brandMode only) ─────────────── */}
      {d.beauty && <BeautyIntelligenceCard beauty={d.beauty} />}

      {/* ─── Ingredient Trends (beauty brandMode only) ───────────────── */}
      {d.beauty && <IngredientTrendsCard ingredientTrends={d.beauty.ingredientTrends} />}

      {/* ─── Recommendations feed (tier-filtered server-side) ────────── */}
      <RecommendationsFeed recs={d.recs} />

      <footer className="sq-footer mono">
        Stylique · {brandName} · {d.plan.analyticsLevel} analytics
      </footer>
    </div>
  );
}

// ─── Tier-differentiated insight panels ──────────────────────────────────

function StarterInsightsPanel({ insights }: { insights: StarterInsights }) {
  const { weeklyStats, topProducts, catalogGapCount, stylistUptime } = insights;
  const uptimeColor =
    stylistUptime === "healthy" ? "#6EE7B7" :
    stylistUptime === "degraded" ? "#FCD34D" : "#FCA5A5";

  return (
    <section className="sq-insights-section sq-mb">
      <header className="sq-insights-head">
        <h2 className="serif">This week at a glance</h2>
        <span className="sq-tag">All tiers</span>
      </header>

      {/* 3 KPI cards */}
      <div className="sq-grid sq-grid--kpis sq-mb-sm">
        <KpiCard
          label="Conversations"
          value={fmt.num(weeklyStats.conversations)}
          sub="7-day window"
          accent="electric"
        />
        <KpiCard
          label="Add-to-carts"
          value={fmt.num(weeklyStats.addToCarts)}
          sub="from chat sessions"
          accent="pink"
        />
        <KpiCard
          label="Try-on renders"
          value={fmt.num(weeklyStats.tryOnRenders)}
          sub="completed renders"
          accent="electric"
        />
      </div>

      {/* Conversion rate highlight + uptime + gap count */}
      <div className="sq-grid sq-grid--kpis sq-mb-sm">
        <div className="sq-card sq-kpi sq-kpi--electric">
          <div className="sq-kpi__label">Conversion rate</div>
          <div className="sq-kpi__value serif" style={{ color: "var(--sq-electric)" }}>
            {fmt.pct(weeklyStats.conversionRate)}
          </div>
          <div className="sq-kpi__sub mono">add-to-carts ÷ conversations</div>
        </div>
        <div className="sq-card sq-kpi sq-kpi--electric">
          <div className="sq-kpi__label">Stylist status</div>
          <div className="sq-kpi__value serif" style={{ fontSize: "28px", color: uptimeColor }}>
            {stylistUptime}
          </div>
          <div className="sq-kpi__sub mono">last 24 hours</div>
        </div>
        {catalogGapCount > 0 && (
          <div className="sq-card sq-kpi sq-kpi--pink">
            <div className="sq-kpi__label">Catalog gaps</div>
            <div className="sq-kpi__value serif">{fmt.num(catalogGapCount)}</div>
            <div className="sq-kpi__sub mono">shoppers asked, you don't carry</div>
          </div>
        )}
      </div>

      {/* Top products */}
      {topProducts.length > 0 && (
        <div className="sq-card">
          <header className="sq-card__head">
            <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Top products this week</h3>
          </header>
          <table className="sq-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="sq-table__num">Clicks</th>
                <th className="sq-table__num">Carts</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p) => (
                <tr key={p.title}>
                  <td className="serif">{p.title}</td>
                  <td className="sq-table__num mono">{fmt.num(p.clicks)}</td>
                  <td className="sq-table__num mono">{fmt.num(p.carts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function GrowthInsightsPanel({ insights }: { insights: GrowthInsights }) {
  const { catalogGapsWithIntent, comboPerformance, sizeDistribution, returnRateByCategory, sentimentSummary } = insights;

  return (
    <section className="sq-insights-section sq-mb">
      <header className="sq-insights-head">
        <h2 className="serif">Catalog intelligence &amp; conversion</h2>
        <span className="sq-tag sq-tag--growth">Growth</span>
      </header>

      {/* Catalog gaps with intent */}
      {catalogGapsWithIntent.length > 0 && (
        <div className="sq-card sq-mb-sm">
          <header className="sq-card__head">
            <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Catalog gaps — purchase intent signal</h3>
            <span className="sq-tag">7d</span>
          </header>
          <table className="sq-table">
            <thead>
              <tr>
                <th>Shopper query</th>
                <th className="sq-table__num">Searches</th>
                <th className="sq-table__num">Revenue leak est.</th>
                <th>Urgency</th>
              </tr>
            </thead>
            <tbody>
              {catalogGapsWithIntent.slice(0, 8).map((g) => (
                <tr key={g.query}>
                  <td className="serif">{g.query}</td>
                  <td className="sq-table__num mono">{g.searchCount}</td>
                  <td className="sq-table__num mono">${Math.round(g.revenueLeakEstimate)}</td>
                  <td>
                    <span className={`sq-urgency sq-urgency--${g.urgencyLevel}`}>
                      {g.urgencyLevel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Combo performance */}
      {comboPerformance.length > 0 && (
        <div className="sq-card sq-mb-sm">
          <header className="sq-card__head">
            <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Combo performance</h3>
            <span className="sq-tag">30d</span>
          </header>
          <table className="sq-table">
            <thead>
              <tr>
                <th>Combo</th>
                <th className="sq-table__num">Proposals</th>
                <th className="sq-table__num">Click rate</th>
                <th className="sq-table__num">Add-all rate</th>
                <th className="sq-table__num">Try-on rate</th>
              </tr>
            </thead>
            <tbody>
              {comboPerformance.slice(0, 6).map((c) => (
                <tr key={c.comboName}>
                  <td className="serif">{c.comboName}</td>
                  <td className="sq-table__num mono">{c.proposalCount}</td>
                  <td className="sq-table__num mono">{fmt.pct(c.clickRate)}</td>
                  <td className="sq-table__num mono">{fmt.pct(c.addAllRate)}</td>
                  <td className="sq-table__num mono">{fmt.pct(c.tryOnRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Size distribution */}
      <div className="sq-grid sq-grid--split sq-mb-sm">
        <div className="sq-card">
          <header className="sq-card__head">
            <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Size distribution</h3>
            {sizeDistribution.driftAlert && (
              <span className="sq-drift-alert">⚠ Drift detected</span>
            )}
          </header>
          {Object.keys(sizeDistribution.currentWeek).length === 0 ? (
            <p className="sq-empty-state">No fit submissions yet this week.</p>
          ) : (
            <>
              <SizeDistributionBars
                current={sizeDistribution.currentWeek}
                previous={sizeDistribution.previousWeek}
              />
              {sizeDistribution.driftAlert && (
                <p className="sq-drift-detail mono">{sizeDistribution.driftDetails}</p>
              )}
            </>
          )}
        </div>

        {/* Sentiment summary */}
        <div className="sq-card">
          <header className="sq-card__head">
            <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Sentiment summary</h3>
            <span className="sq-tag">30d</span>
          </header>
          <div className="sq-sentiment-bar" style={{ marginBottom: "12px" }}>
            <div style={{ width: `${sentimentSummary.positivePercent}%`, background: "#6EE7B7" }} />
            <div style={{ width: `${100 - sentimentSummary.positivePercent - sentimentSummary.negativePercent}%`, background: "#94A3B8" }} />
            <div style={{ width: `${sentimentSummary.negativePercent}%`, background: "#FCA5A5" }} />
          </div>
          <div className="sq-sentiment-legend" style={{ marginBottom: "12px" }}>
            <span>✦ {sentimentSummary.positivePercent.toFixed(1)}% positive</span>
            <span>✕ {sentimentSummary.negativePercent.toFixed(1)}% negative</span>
            <span>· {sentimentSummary.foundItemRate.toFixed(1)}% found item</span>
          </div>
          {sentimentSummary.topThemes.length > 0 && (
            <div className="sq-themes">
              {sentimentSummary.topThemes.map((t) => (
                <span key={t} className="sq-theme-chip">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Return rate by category */}
      {returnRateByCategory.length > 0 && (
        <div className="sq-card">
          <header className="sq-card__head">
            <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Return rate by category</h3>
            <span className="sq-tag">30d</span>
          </header>
          <table className="sq-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="sq-table__num">Return rate</th>
                <th className="sq-table__num">Returns</th>
                <th>Top reason</th>
              </tr>
            </thead>
            <tbody>
              {returnRateByCategory.map((r) => (
                <tr key={r.category}>
                  <td className="serif">{r.category}</td>
                  <td className="sq-table__num mono">{fmt.pct(r.returnRate)}</td>
                  <td className="sq-table__num mono">{r.returnCount}</td>
                  <td className="mono" style={{ color: "var(--sq-mute)" }}>{r.topReturnReason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UltimateInsightsPanel({ insights }: { insights: UltimateInsights }) {
  const { trendVelocity, restockingPredictions, customerSegments, creativePerformance } = insights;

  return (
    <section className="sq-insights-section sq-mb">
      <header className="sq-insights-head">
        <h2 className="serif">Network intelligence &amp; forecasting</h2>
        <span className="sq-tag sq-tag--ultimate">Ultimate</span>
      </header>

      {/* Trend velocity */}
      {trendVelocity.length > 0 && (
        <div className="sq-card sq-mb-sm">
          <header className="sq-card__head">
            <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Trend velocity · Stylique network</h3>
            <span className="sq-tag">k-anon ≥3 brands</span>
          </header>
          <div className="sq-trend-chips">
            {trendVelocity.map((t) => (
              <div
                key={t.attribute}
                className={`sq-trend-chip sq-trend-chip--${t.recommendation}`}
                title={`+${t.networkMentionGrowth}% network · ${t.brandMentionCount} in your store`}
              >
                <span className="sq-trend-chip__attr serif">{t.attribute}</span>
                <span className="sq-trend-chip__stat mono">
                  {t.networkMentionGrowth >= 0 ? "+" : ""}{t.networkMentionGrowth}%
                </span>
              </div>
            ))}
          </div>
          <div className="sq-trend-legend mono">
            <span className="sq-trend-legend--stock">● stock now</span>
            <span className="sq-trend-legend--watch">● watch</span>
            <span className="sq-trend-legend--decline">● declining</span>
          </div>
        </div>
      )}

      {/* Restocking predictions */}
      {restockingPredictions.length > 0 && (
        <div className="sq-card sq-mb-sm">
          <header className="sq-card__head">
            <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Restocking predictions</h3>
            <span className="sq-tag">demand velocity</span>
          </header>
          <table className="sq-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="sq-table__num">Velocity / week</th>
                <th className="sq-table__num">Stockout in</th>
                <th>Confidence</th>
                <th className="sq-table__num">Reorder qty</th>
              </tr>
            </thead>
            <tbody>
              {restockingPredictions.map((r) => (
                <tr key={r.productId}>
                  <td className="serif">{r.productTitle}</td>
                  <td className="sq-table__num mono">{r.currentVelocity} carts</td>
                  <td className="sq-table__num mono">
                    <span className={r.predictedStockoutDays < 14 ? "sq-urgent-text" : ""}>
                      {r.predictedStockoutDays}d
                    </span>
                  </td>
                  <td>
                    <span className={`sq-confidence sq-confidence--${r.confidence}`}>
                      {r.confidence}
                    </span>
                  </td>
                  <td className="sq-table__num mono">{r.suggestedReorderQuantity} units</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Customer segments */}
      <div className="sq-grid sq-grid--split sq-mb-sm">
        <div className="sq-card">
          <header className="sq-card__head">
            <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Customer segments</h3>
          </header>
          <div className="sq-mini-kpis">
            <MiniKpi label="VIP / repeat" value={customerSegments.highRepeat} />
            <MiniKpi label="Single purchase" value={customerSegments.singlePurchase} />
            <MiniKpi label="High engagement, no buy" value={customerSegments.highEngagementNoPurchase} />
          </div>
          {customerSegments.topSegmentInsight && (
            <p className="sq-segment-insight serif">{customerSegments.topSegmentInsight}</p>
          )}
        </div>

        {/* Creative performance */}
        {creativePerformance.length > 0 && (
          <div className="sq-card">
            <header className="sq-card__head">
              <h3 className="serif" style={{ fontSize: "18px", margin: 0 }}>Creative performance</h3>
              <span className="sq-tag">24h attribution</span>
            </header>
            <table className="sq-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th className="sq-table__num">Clicks</th>
                  <th className="sq-table__num">Conv. rate</th>
                </tr>
              </thead>
              <tbody>
                {creativePerformance.slice(0, 5).map((c) => (
                  <tr key={c.creativeSetId}>
                    <td className="serif">{c.topPerformingStyle ?? c.kind}</td>
                    <td className="sq-table__num mono">{c.pdpClickThrough}</td>
                    <td className="sq-table__num mono">{fmt.pct(c.conversionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** Blurred teaser shown to lower-tier brands for locked sections. */
function LockedInsightsTeaser({
  title,
  description,
  ctaLabel,
  tier,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  tier: "GROWTH" | "ULTIMATE";
}) {
  return (
    <div className="sq-locked-teaser sq-mb">
      {/* Blurred preview rows — decorative, not interactive */}
      <div className="sq-locked-teaser__blur" aria-hidden="true">
        <div className="sq-locked-teaser__row" style={{ width: "72%" }} />
        <div className="sq-locked-teaser__row" style={{ width: "55%" }} />
        <div className="sq-locked-teaser__row" style={{ width: "85%" }} />
        <div className="sq-locked-teaser__row" style={{ width: "40%" }} />
      </div>
      <div className="sq-locked-teaser__overlay">
        <div className="sq-locked-teaser__inner">
          <span className={`sq-tag sq-tag--${tier.toLowerCase()}`}>{tierBadge(tier)}</span>
          <h3 className="serif sq-locked-teaser__title">{title}</h3>
          <p className="sq-locked-teaser__desc">{description}</p>
          <a href="/app/settings/plan" className="sq-rec__cta sq-locked-teaser__cta">
            {ctaLabel} →
          </a>
        </div>
      </div>
    </div>
  );
}

/** CSS bar chart for size distribution — no chart library needed. */
function SizeDistributionBars({
  current,
  previous,
}: {
  current: Record<string, number>;
  previous: Record<string, number>;
}) {
  const sizes = [...new Set([...Object.keys(current), ...Object.keys(previous)])].sort();
  const maxVal = Math.max(1, ...Object.values(current), ...Object.values(previous));
  return (
    <div className="sq-size-bars">
      {sizes.map((s) => {
        const curr = current[s] ?? 0;
        const prev = previous[s] ?? 0;
        return (
          <div key={s} className="sq-size-bar-group">
            <div className="sq-size-bar-label mono">{s}</div>
            <div className="sq-size-bar-tracks">
              <div
                className="sq-size-bar sq-size-bar--current"
                style={{ width: `${(curr / maxVal) * 100}%` }}
                title={`This week: ${curr}`}
              />
              <div
                className="sq-size-bar sq-size-bar--previous"
                style={{ width: `${(prev / maxVal) * 100}%` }}
                title={`Last week: ${prev}`}
              />
            </div>
            <div className="sq-size-bar-count mono">{curr}</div>
          </div>
        );
      })}
      <div className="sq-size-bar-legend mono">
        <span className="sq-size-bar-legend--curr">■ this week</span>
        <span className="sq-size-bar-legend--prev">■ last week</span>
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────

function UsageRail({ usage }: { usage: Record<string, { used: number; cap: number | null; remaining: number | null }> }) {
  // Friendly labels — order matters; we surface the metrics most likely to be capped first.
  const order: Array<[string, string]> = [
    ["CREATIVE_GENERATED", "Studio creatives"],
    ["TRYON_PERSONAL", "Personal try-on"],
    ["FIT_RECOMMENDATION", "Fit recommendations"],
    ["STYLE_RECOMMENDATION", "Style recommendations"],
  ];
  return (
    <section className="sq-rail">
      {order.map(([metric, label]) => {
        const u = usage[metric];
        if (!u) return null;
        const pct = u.cap == null ? 0 : Math.min(100, (u.used / u.cap) * 100);
        const isUnlimited = u.cap == null;
        return (
          <div className="sq-rail__item" key={metric}>
            <div className="sq-rail__row">
              <span className="sq-rail__label">{label}</span>
              <span className="sq-rail__count mono">
                {fmt.num(u.used)}{isUnlimited ? " · unlimited" : ` / ${fmt.num(u.cap!)}`}
              </span>
            </div>
            <div className="sq-rail__bar">
              <span className="sq-rail__fill" style={{ width: isUnlimited ? "100%" : `${pct}%`, opacity: isUnlimited ? 0.35 : 1 }} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: "electric" | "pink" }) {
  return (
    <div className={`sq-card sq-kpi sq-kpi--${accent}`}>
      <div className="sq-kpi__label">{label}</div>
      <div className="sq-kpi__value serif">{value}</div>
      <div className="sq-kpi__sub mono">{sub}</div>
    </div>
  );
}

function StylistFunnelCard({ funnel, topCombos }: {
  funnel: { opened: number; messaged: number; combosShown: number; productClicked: number; cartConfirmed: number };
  topCombos: Array<{ name: string; proposed: number; clicked: number; ctr: number; productIds?: string[] }>;
}) {
  const stages: Array<[string, number]> = [
    ["Opened the stylist",     funnel.opened],
    ["Sent a message",         funnel.messaged],
    ["Saw a combo",            funnel.combosShown],
    ["Clicked a product",      funnel.productClicked],
    ["Added to bag",           funnel.cartConfirmed],
  ];
  const max = Math.max(1, ...stages.map(([, n]) => n));
  return (
    <div className="sq-card">
      <header className="sq-card__head">
        <h2 className="serif">The Stylist conversation</h2>
        <span className="sq-tag">AI agent</span>
      </header>
      <ol className="sq-funnel">
        {stages.map(([label, n], i) => {
          const w = (n / max) * 100;
          const prev = i > 0 ? stages[i - 1][1] : null;
          const drop = prev && prev > 0 ? Math.round((n / prev) * 100) : null;
          return (
            <li key={label} className="sq-funnel__row">
              <div className="sq-funnel__label">{label}</div>
              <div className="sq-funnel__track">
                <span className="sq-funnel__bar" style={{ width: `${w}%` }} />
              </div>
              <div className="sq-funnel__count mono">{fmt.num(n)}{drop != null && i > 0 && <span className="sq-funnel__rate"> · {drop}%</span>}</div>
            </li>
          );
        })}
      </ol>
      {topCombos.length > 0 && (
        <div className="sq-subblock">
          <div className="sq-subblock__title">Top combos</div>
          <ul className="sq-combo-list">
            {topCombos.slice(0, 4).map((c) => (
              <li key={c.name}>
                <span className="sq-combo-list__name serif">{c.name}</span>
                <span className="sq-combo-list__count mono">{c.proposed}×</span>
                {(c.productIds ?? []).length > 0 && (
                  <Form method="post" action="/app/studio/generate-from-combo" className="sq-combo-list__form">
                    <input type="hidden" name="comboName" value={c.name} />
                    <input type="hidden" name="productIds" value={(c.productIds ?? []).join(",")} />
                    <button type="submit" className="sq-btn-ghost-sm">
                      Generate Studio creative →
                    </button>
                  </Form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function WidgetCard({ funnel, moods, models, tryon }: {
  funnel: { opened: number; experienceChosen: number; modelSelected: number; fitSubmitted: number; styleViewed: number; moodSelected: number };
  moods: Array<{ moodId: string; count: number }>;
  models: Array<{ modelId: string; count: number }>;
  tryon: { requested: number; completed: number; failed: number; successRate: number | null; p50LatencyMs: number | null; providerKey: string };
}) {
  const engineLabel = tryon.providerKey === "replicate-idm-vton" || tryon.providerKey === "vertex-vto-001"
    ? "Photorealistic"
    : tryon.providerKey === "replicate-catvton"
      ? "High quality"
      : "Style preview";
  return (
    <div className="sq-card">
      <header className="sq-card__head">
        <h2 className="serif">Try-on, fit &amp; the look</h2>
        <span className="sq-tag">Widget</span>
      </header>
      <div className="sq-mini-kpis">
        <MiniKpi label="Opened" value={funnel.opened} />
        <MiniKpi label="Model picked" value={funnel.modelSelected} />
        <MiniKpi label="Fit checks" value={funnel.fitSubmitted} />
        <MiniKpi label="Look viewed" value={funnel.styleViewed} />
      </div>

      {/* VTO render strip — Sprint 6 / D34. Provider label is honest about
          what the brand actually has live; success-rate + p50 are useful when
          comparing engines or diagnosing provider hiccups. */}
      <div className="sq-tryon-strip">
        <div className="sq-tryon-strip__head">
          <span className="mono">VTO renders · {engineLabel}</span>
          <a className="sq-tryon-strip__link mono" href="/app/settings/tryon">Configure →</a>
        </div>
        <div className="sq-mini-kpis sq-mini-kpis--inset">
          <MiniKpi label="Completed" value={tryon.completed} />
          <MiniKpi label="Success rate" value={tryon.successRate ?? 0} suffix={tryon.successRate == null ? "—" : "%"} />
          <MiniKpi label="p50 latency" value={tryon.p50LatencyMs ?? 0} suffix={tryon.p50LatencyMs == null ? "—" : "ms"} />
          <MiniKpi label="Failed" value={tryon.failed} />
        </div>
      </div>

      <div className="sq-split">
        <Distribution title="Top moods" items={moods.map((m) => ({ label: m.moodId.replace(/-/g, " "), value: m.count }))} />
        <Distribution title="Top models" items={models.map((m) => ({ label: m.modelId, value: m.count }))} />
      </div>
    </div>
  );
}

function MiraAssistedRevenueCard({ formatted, orderCount }: { formatted: string; orderCount: number }) {
  return (
    <div className="sq-card sq-card--assisted">
      <header className="sq-card__head">
        <h2 className="serif">Mira-assisted revenue</h2>
        <span className="sq-tag">Last 30 days</span>
      </header>
      <div className="sq-assisted-kpi">
        <div className="sq-assisted-kpi__amount serif">{formatted}</div>
        <div className="sq-assisted-kpi__sub mono">
          {orderCount} order{orderCount !== 1 ? "s" : ""} converted via Mira recommendations
        </div>
        <div className="sq-assisted-kpi__desc">
          Items added to cart via Mira chat or combo cards that converted to fulfilled purchases.
        </div>
      </div>
    </div>
  );
}

// ─── Per-module deep-dive cards ──────────────────────────────────────────

function MiraModuleCard({
  funnel,
  topCombos,
  assistedRevenue,
  chatSessions,
}: {
  funnel: { opened: number; messaged: number; combosShown: number; productClicked: number; cartConfirmed: number };
  topCombos: Array<{ name: string; proposed: number; clicked: number; ctr: number; productIds?: string[] }>;
  assistedRevenue: { formatted: string; orderCount: number };
  chatSessions: number;
}) {
  const steps: Array<{ label: string; n: number }> = [
    { label: "Stylist opened", n: funnel.opened },
    { label: "Sent a message", n: funnel.messaged },
    { label: "Combo shown", n: funnel.combosShown },
    { label: "Added to cart", n: funnel.cartConfirmed },
  ];
  const base = Math.max(1, funnel.opened);
  const timeSavedHours = Math.round((chatSessions * 4) / 60);
  const moneySaved = timeSavedHours * 80;

  return (
    <section className="sq-module-card sq-mb">
      <header className="sq-card__head">
        <h2 className="serif">Mira — AI Stylist</h2>
        <span className="sq-tag sq-tag--module-mira">Module deep-dive</span>
      </header>

      <div className="sq-module-card__sub">Conversations → Cart funnel</div>
      <ol className="sq-funnel-steps">
        {steps.map((s, i) => {
          const pct = Math.round((s.n / base) * 100);
          const prev = i > 0 ? steps[i - 1].n : null;
          const drop = prev && prev > 0 ? Math.round((s.n / prev) * 100) : null;
          return (
            <li key={s.label} className="sq-funnel-steps__row">
              <div className="sq-funnel-steps__label">{s.label}</div>
              <div className="sq-funnel-steps__track">
                <span className="sq-funnel-steps__bar" style={{ width: `${pct}%` }} />
              </div>
              <div className="sq-funnel-steps__right mono">
                {fmt.num(s.n)}
                {drop != null && i > 0 && <span className="sq-funnel-steps__rate"> · {drop}%</span>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="sq-savings-row">
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">{assistedRevenue.formatted}</div>
          <div className="sq-savings-tile__label">Assisted revenue · {assistedRevenue.orderCount} orders · last 30 days</div>
        </div>
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">{fmt.num(timeSavedHours)}h</div>
          <div className="sq-savings-tile__label">Saved on manual styling consultations</div>
          <div className="sq-savings-tile__detail mono">{fmt.num(chatSessions)} sessions × 4 min avg · ${fmt.num(moneySaved)} saved at $80/hr freelance rate</div>
        </div>
      </div>

      {topCombos.length > 0 && (
        <>
          <div className="sq-module-card__sub sq-module-card__sub--mt">Top combos performance</div>
          <table className="sq-table">
            <thead>
              <tr>
                <th>Combo</th>
                <th className="sq-table__num">Proposals</th>
                <th className="sq-table__num">CTR %</th>
                <th className="sq-table__num">Add-all rate</th>
              </tr>
            </thead>
            <tbody>
              {topCombos.slice(0, 5).map((c) => (
                <tr key={c.name}>
                  <td className="serif">{c.name}</td>
                  <td className="sq-table__num mono">{fmt.num(c.proposed)}</td>
                  <td className="sq-table__num mono">{(c.ctr * 100).toFixed(1)}%</td>
                  <td className="sq-table__num mono">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function VtoModuleCard({
  widgetFunnel,
  tryon,
}: {
  widgetFunnel: { opened: number; experienceChosen: number; modelSelected: number; fitSubmitted: number; styleViewed: number; moodSelected: number };
  tryon: { requested: number; completed: number; failed: number; successRate: number | null; p50LatencyMs: number | null; providerKey: string };
}) {
  const steps: Array<{ label: string; n: number }> = [
    { label: "Widget opened", n: widgetFunnel.opened },
    { label: "Experience chosen", n: widgetFunnel.experienceChosen },
    { label: "Render requested", n: tryon.requested },
    { label: "Render completed", n: tryon.completed },
  ];
  const base = Math.max(1, widgetFunnel.opened);
  const estConvRate = 0.04;
  const fewerReturns = Math.round(tryon.completed * 0.18);
  const cacSaved = Math.round(tryon.completed * estConvRate * 12);

  return (
    <section className="sq-module-card sq-mb">
      <header className="sq-card__head">
        <h2 className="serif">Virtual Try-On</h2>
        <span className="sq-tag sq-tag--module-vto">Module deep-dive</span>
      </header>

      <div className="sq-module-card__sub">Try-on funnel</div>
      <ol className="sq-funnel-steps">
        {steps.map((s, i) => {
          const pct = Math.round((s.n / base) * 100);
          const prev = i > 0 ? steps[i - 1].n : null;
          const drop = prev && prev > 0 ? Math.round((s.n / prev) * 100) : null;
          return (
            <li key={s.label} className="sq-funnel-steps__row">
              <div className="sq-funnel-steps__label">{s.label}</div>
              <div className="sq-funnel-steps__track">
                <span className="sq-funnel-steps__bar" style={{ width: `${pct}%` }} />
              </div>
              <div className="sq-funnel-steps__right mono">
                {fmt.num(s.n)}
                {drop != null && i > 0 && <span className="sq-funnel-steps__rate"> · {drop}%</span>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="sq-savings-row sq-savings-row--3">
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">
            {tryon.successRate != null ? `${tryon.successRate.toFixed(1)}%` : "—"}
          </div>
          <div className="sq-savings-tile__label">Render success rate</div>
        </div>
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">
            {tryon.p50LatencyMs != null ? `${tryon.p50LatencyMs}ms` : "—"}
          </div>
          <div className="sq-savings-tile__label">p50 render latency</div>
        </div>
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">{fmt.num(fewerReturns)}</div>
          <div className="sq-savings-tile__label">Fewer returns est.</div>
          <div className="sq-savings-tile__detail mono">{fmt.num(tryon.completed)} renders × 18% industry benchmark</div>
        </div>
      </div>

      <div className="sq-savings-row">
        <div className="sq-savings-tile sq-savings-tile--full">
          <div className="sq-savings-tile__value serif">${fmt.num(cacSaved)}</div>
          <div className="sq-savings-tile__label">Ad spend efficiency — CAC saved</div>
          <div className="sq-savings-tile__detail mono">{fmt.num(tryon.completed)} renders × {(estConvRate * 100).toFixed(0)}% est. conversion × $12 avg CAC saved per buying VTO user</div>
        </div>
      </div>
    </section>
  );
}

function SizeModuleCard({ fitSubmitted }: { fitSubmitted: number }) {
  const avgOrderValue = 85;
  const returnReductionRate = 0.22;
  const savingsEst = Math.round(fitSubmitted * returnReductionRate * avgOrderValue);

  return (
    <section className="sq-module-card sq-mb">
      <header className="sq-card__head">
        <h2 className="serif">Smart Sizing</h2>
        <span className="sq-tag sq-tag--module-size">Module deep-dive</span>
      </header>

      <div className="sq-savings-row">
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">{fmt.num(fitSubmitted)}</div>
          <div className="sq-savings-tile__label">Fit submissions · last 30 days</div>
        </div>
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">${fmt.num(savingsEst)}</div>
          <div className="sq-savings-tile__label">Returns reduction from size accuracy</div>
          <div className="sq-savings-tile__detail mono">
            {fmt.num(fitSubmitted)} submissions × 22% return reduction × $85 avg order value
          </div>
        </div>
      </div>

      <div className="sq-module-card__notice mono">
        Size distribution drift alerts appear here when weekly fit data accumulates. Check the Growth insights panel for current drift signals.
      </div>
    </section>
  );
}

function StudioModuleCard({ studio }: {
  studio: { setsGenerated: number; creativesGenerated: number; pendingFromRecommendations: number; sourcedFromCombos: number };
}) {
  const costPerAgencyShoot = 450;
  const creativeSavings = studio.setsGenerated * costPerAgencyShoot;

  return (
    <section className="sq-module-card sq-mb">
      <header className="sq-card__head">
        <h2 className="serif">Creative Studio</h2>
        <span className="sq-tag sq-tag--module-studio">Module deep-dive</span>
      </header>

      <div className="sq-savings-row sq-savings-row--3">
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">{fmt.num(studio.setsGenerated)}</div>
          <div className="sq-savings-tile__label">Sets generated</div>
        </div>
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">{fmt.num(studio.creativesGenerated)}</div>
          <div className="sq-savings-tile__label">Creatives generated</div>
        </div>
        <div className="sq-savings-tile">
          <div className="sq-savings-tile__value serif">{fmt.num(studio.pendingFromRecommendations)}</div>
          <div className="sq-savings-tile__label">Pending from recommendations</div>
        </div>
      </div>

      <div className="sq-savings-row">
        <div className="sq-savings-tile sq-savings-tile--full sq-savings-tile--highlight">
          <div className="sq-savings-tile__value serif">${fmt.num(creativeSavings)}</div>
          <div className="sq-savings-tile__label">Creative cost savings vs. agency shoots</div>
          <div className="sq-savings-tile__detail mono">{fmt.num(studio.setsGenerated)} sets × $450 standard agency shoot rate</div>
        </div>
      </div>
    </section>
  );
}

function EcosystemSection() {
  const flows: Array<{ from: string; arrow: string; to: string }> = [
    { from: "Mira", arrow: "taste data", to: "Creative Studio" },
    { from: "VTO", arrow: "body data", to: "Smart Sizing" },
    { from: "Smart Sizing", arrow: "confidence", to: "Mira" },
    { from: "Mira", arrow: "combos", to: "VTO" },
  ];

  return (
    <section className="sq-ecosystem sq-mb">
      <header className="sq-ecosystem__head">
        <h2 className="serif">One Ecosystem — Each Module Feeds the Next</h2>
        <span className="sq-tag">Data flywheel</span>
      </header>
      <div className="sq-ecosystem__flows">
        {flows.map((f) => (
          <div key={`${f.from}-${f.to}`} className="sq-ecosystem__flow">
            <div className="sq-ecosystem__node serif">{f.from}</div>
            <div className="sq-ecosystem__arrow">
              <span className="sq-ecosystem__arrow-line" />
              <span className="sq-ecosystem__arrow-label mono">{f.arrow}</span>
              <span className="sq-ecosystem__arrow-head">›</span>
            </div>
            <div className="sq-ecosystem__node serif">{f.to}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MiniKpi({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="sq-mini">
      <div className="sq-mini__value serif">{suffix === "—" ? "—" : fmt.num(value)}{suffix && suffix !== "—" ? <span className="sq-mini__suffix">{suffix}</span> : null}</div>
      <div className="sq-mini__label">{label}</div>
    </div>
  );
}

function Distribution({ title, items }: { title: string; items: Array<{ label: string; value: number }> }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total) return (
    <div className="sq-dist">
      <div className="sq-dist__title">{title}</div>
      <div className="sq-dist__empty">No data yet — comes alive on first shopper interaction.</div>
    </div>
  );
  return (
    <div className="sq-dist">
      <div className="sq-dist__title">{title}</div>
      <ul>
        {items.slice(0, 5).map((it) => {
          const w = (it.value / total) * 100;
          return (
            <li key={it.label}>
              <div className="sq-dist__row">
                <span className="sq-dist__label">{it.label}</span>
                <span className="sq-dist__count mono">{Math.round(w)}%</span>
              </div>
              <div className="sq-dist__bar"><span style={{ width: `${w}%` }} /></div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StudioCard({ data }: { data: { setsGenerated: number; creativesGenerated: number; pendingFromRecommendations: number; sourcedFromCombos: number } }) {
  return (
    <section className="sq-card sq-studio">
      <header className="sq-card__head">
        <h2 className="serif">Creative Studio</h2>
        <span className="sq-tag">Studio</span>
      </header>
      <div className="sq-mini-kpis">
        <MiniKpi label="Sets" value={data.setsGenerated} />
        <MiniKpi label="Creatives" value={data.creativesGenerated} />
        <MiniKpi label="From recommendations" value={data.pendingFromRecommendations} />
        <MiniKpi label="From combos" value={data.sourcedFromCombos} />
      </div>
    </section>
  );
}

function CatalogGapCard({ catalog }: { catalog: { topQueries: Array<{ query: string; count: number }>; gaps: Array<{ query: string; count: number; lastSeen: Date | string }> } }) {
  if (!catalog.topQueries.length && !catalog.gaps.length) return null;
  return (
    <section className="sq-card">
      <header className="sq-card__head">
        <h2 className="serif">What shoppers are looking for</h2>
        <span className="sq-tag">Catalog intelligence</span>
      </header>
      <div className="sq-split">
        <div>
          <div className="sq-subblock__title">Top queries</div>
          <ul className="sq-querylist">
            {catalog.topQueries.slice(0, 8).map((q) => (
              <li key={q.query}><span className="serif">{q.query}</span><span className="mono">{q.count}×</span></li>
            ))}
            {catalog.topQueries.length === 0 && <li className="sq-empty">No shopper queries yet.</li>}
          </ul>
        </div>
        <div>
          <div className="sq-subblock__title sq-subblock__title--alert">Gaps — they asked, you didn't have it</div>
          <ul className="sq-querylist sq-querylist--gap">
            {catalog.gaps.slice(0, 8).map((g) => (
              <li key={g.query}>
                <span className="serif">{g.query}</span>
                <span className="mono">{g.count}×</span>
              </li>
            ))}
            {catalog.gaps.length === 0 && <li className="sq-empty">No gaps detected this window. Strong catalog coverage.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}

function TasteProfileCard({ taste }: { taste: { topColorFamilies: Array<{ key: string; share: number }>; topSilhouettes: Array<{ key: string; share: number }>; topCategories: Array<{ key: string; share: number }>; sampleSize: number } }) {
  if (!taste.sampleSize) return null;
  return (
    <section className="sq-card">
      <header className="sq-card__head">
        <h2 className="serif">Your shoppers' taste</h2>
        <span className="sq-tag">{taste.sampleSize} profiles</span>
      </header>
      <div className="sq-taste">
        <TasteLane title="Color families" items={taste.topColorFamilies} />
        <TasteLane title="Silhouettes" items={taste.topSilhouettes} />
        <TasteLane title="Categories" items={taste.topCategories} />
      </div>
    </section>
  );
}

function TasteLane({ title, items }: { title: string; items: Array<{ key: string; share: number }> }) {
  return (
    <div className="sq-lane">
      <div className="sq-lane__title">{title}</div>
      {items.slice(0, 4).map((it) => (
        <div className="sq-lane__row" key={it.key}>
          <div className="sq-lane__bar"><span style={{ width: `${it.share * 100}%` }} /></div>
          <div className="sq-lane__label"><span className="serif">{it.key}</span><span className="mono"> · {fmt.share(it.share)}</span></div>
        </div>
      ))}
    </div>
  );
}

function ShopperConversationsCard({ sentiment }: {
  sentiment: {
    totalAnalyzed: number;
    positive: number;
    neutral: number;
    negative: number;
    topThemes: Array<{ theme: string; count: number }>;
    recentSummaries: Array<{ summary: string; sentiment: string; date: Date | string }>;
  };
}) {
  if (sentiment.totalAnalyzed === 0) {
    return (
      <section className="sq-card">
        <header className="sq-card__head">
          <h2 className="serif">Shopper Conversations</h2>
          <span className="sq-tag">Sentiment</span>
        </header>
        <p className="sq-empty-state">Conversations will be analyzed nightly once shoppers start chatting.</p>
      </section>
    );
  }

  const total = sentiment.totalAnalyzed;
  const posW = Math.round((sentiment.positive / total) * 100);
  const neuW = Math.round((sentiment.neutral / total) * 100);
  const negW = 100 - posW - neuW; // avoid rounding gaps

  return (
    <section className="sq-card">
      <header className="sq-card__head">
        <h2 className="serif">Shopper Conversations</h2>
        <span className="sq-tag">{fmt.num(total)} analyzed · 30d</span>
      </header>

      {/* Sentiment bar */}
      <div className="sq-sentiment-bar">
        <div style={{ width: `${posW}%`, background: "#6EE7B7" }} />
        <div style={{ width: `${neuW}%`, background: "#94A3B8" }} />
        <div style={{ width: `${negW}%`, background: "#FCA5A5" }} />
      </div>
      <div className="sq-sentiment-legend">
        <span>✦ {fmt.num(sentiment.positive)} positive</span>
        <span>· {fmt.num(sentiment.neutral)} neutral</span>
        <span>✕ {fmt.num(sentiment.negative)} needs attention</span>
      </div>

      {/* Top themes */}
      {sentiment.topThemes.length > 0 && (
        <div className="sq-themes">
          {sentiment.topThemes.map((t) => (
            <span key={t.theme} className="sq-theme-chip">{t.theme} ({t.count})</span>
          ))}
        </div>
      )}

      {/* Recent summaries */}
      {sentiment.recentSummaries.length > 0 && (
        <div className="sq-summaries">
          {sentiment.recentSummaries.map((s, i) => (
            <div key={i} className="sq-summary-row">
              <span className={`sq-dot sq-dot-${s.sentiment}`} />
              <span>{s.summary}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BenchmarkCard({ benchmarks }: { benchmarks: Array<{ dimension: string; brandValue: number; percentile: number; network: { p50: number; p75: number; p90: number; sampleBrands: number } }> }) {
  const labels: Record<string, string> = {
    combo_ctr: "Combo → cart rate",
    signup_rate: "Signup capture",
    fit_to_cart_rate: "Fit → cart rate",
    chat_volume: "Stylist activity",
    tryon_volume: "Try-on activity",
    creative_volume: "Studio output",
  };
  return (
    <section className="sq-card sq-bench">
      <header className="sq-card__head">
        <h2 className="serif">Where you stand on the Stylique network</h2>
        <span className="sq-tag">Ultimate · anonymized</span>
      </header>
      <ul className="sq-bench__list">
        {benchmarks.map((b) => (
          <li className="sq-bench__row" key={b.dimension}>
            <div className="sq-bench__label">{labels[b.dimension] ?? b.dimension}</div>
            <div className="sq-bench__track">
              <span className="sq-bench__p50" />
              <span className="sq-bench__p75" />
              <span className="sq-bench__p90" />
              <span className="sq-bench__you" style={{ left: `${b.percentile}%` }} />
            </div>
            <div className="sq-bench__pct mono">p{Math.round(b.percentile)}</div>
          </li>
        ))}
      </ul>
      <div className="sq-bench__legend mono">p50 · p75 · p90 · you</div>
    </section>
  );
}

function RecommendationsFeed({ recs }: { recs: Array<{ id: string; kind: string; severity: string; surface: string; title: string; body: string; actionUrl: string | null; ctaLabel: string | null }> }) {
  // Client-interactive subtree. We use useState to fold a row away the moment
  // the brand dismisses or marks it taken — they don't want to see it again
  // and the server already recorded it.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const visible = recs.filter((r) => !hidden.has(r.id));
  if (!visible.length) {
    return (
      <section className="sq-card sq-empty-block">
        <h2 className="serif">No recommendations right now</h2>
        <p>{recs.length === 0
          ? "Once your shoppers log a few interactions, Stylique will surface the moves that move the needle."
          : "You're caught up. Stylique generates new ones nightly as shopper signal accumulates."}</p>
      </section>
    );
  }

  const act = async (id: string, verb: "dismiss" | "taken", actionUrl?: string | null) => {
    setHidden((s) => new Set(s).add(id));
    try {
      await fetch(`/api/admin/recommendations/${id}/${verb}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      // Surface a quiet rollback if it fails — most likely a tab disconnect.
      setHidden((s) => { const n = new Set(s); n.delete(id); return n; });
    }
    if (verb === "taken" && actionUrl) {
      if (actionUrl.startsWith("http")) window.open(actionUrl, "_blank", "noopener,noreferrer");
      else window.location.assign(actionUrl);
    }
  };

  return (
    <section className="sq-card">
      <header className="sq-card__head">
        <h2 className="serif">Recommendations for this week</h2>
        <span className="sq-tag">{visible.length}</span>
      </header>
      <ul className="sq-recs">
        {visible.map((r) => (
          <li className="sq-rec" key={r.id}>
            <div className="sq-rec__bar" style={{ background: severityHue(r.severity) }} />
            <div className="sq-rec__body">
              <div className="sq-rec__meta mono">{r.surface.toLowerCase()} · {r.severity.toLowerCase()}</div>
              <div className="sq-rec__title serif">{r.title}</div>
              <p className="sq-rec__copy">{r.body}</p>
              <div className="sq-rec__row">
                {r.ctaLabel && (
                  <button className="sq-rec__cta" type="button" onClick={() => act(r.id, "taken", r.actionUrl)}>
                    {r.ctaLabel} →
                  </button>
                )}
                <button className="sq-rec__ghost" type="button" onClick={() => act(r.id, "dismiss")}>
                  Dismiss
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Beauty Intelligence card ─────────────────────────────────────────────

function BeautyIntelligenceCard({ beauty }: {
  beauty: {
    topConcerns: Array<{ concern: string; count: number }>;
    replenishmentDueSoon: number;
    shadeGapCount: number;
  };
}) {
  const maxCount = beauty.topConcerns[0]?.count ?? 1;
  return (
    <section className="sq-card" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 className="sq-card__title">Beauty Intelligence</h2>
          <p className="sq-card__sub">Skin profiles · Shade requests · Replenishment signals</p>
        </div>
        <span style={{
          background: "linear-gradient(135deg,#f472b6,#a78bfa)",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          padding: "4px 10px",
          borderRadius: 20,
          textTransform: "uppercase",
        }}>Beauty Mode</span>
      </div>

      {/* 3-column stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
        {[
          {
            label: "Shade gaps",
            value: beauty.shadeGapCount,
            sub: "shades shoppers asked for",
            color: "var(--sq-pink)",
          },
          {
            label: "Replenishment due",
            value: beauty.replenishmentDueSoon,
            sub: "shoppers within 14-day window",
            color: "var(--sq-electric)",
          },
          {
            label: "Top concern",
            value: beauty.topConcerns[0]?.concern ?? "—",
            sub: beauty.topConcerns[0] ? `${beauty.topConcerns[0].count} shoppers` : "no data yet",
            color: "var(--sq-pink)",
          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} style={{
            background: "var(--sq-surface,#14111A)",
            borderRadius: 10,
            padding: "14px 16px",
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <p style={{ fontSize: 11, color: "var(--sq-mute,#888)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</p>
            <p style={{ fontSize: typeof value === "number" ? 28 : 18, fontWeight: 700, color, lineHeight: 1.1, marginBottom: 4 }}>{typeof value === "number" ? fmt.num(value) : value}</p>
            <p style={{ fontSize: 12, color: "var(--sq-mute,#888)" }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Top concerns bar chart */}
      {beauty.topConcerns.length > 0 && (
        <div>
          <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--sq-mute,#888)", marginBottom: 10 }}>Top skin concerns</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {beauty.topConcerns.map(({ concern, count }) => (
              <div key={concern} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--sq-text,#fff)", minWidth: 100, textTransform: "capitalize" }}>{concern.replace(/_/g, " ")}</span>
                <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.round((count / maxCount) * 100)}%`,
                    background: "linear-gradient(90deg,#f472b6,#a78bfa)",
                    borderRadius: 3,
                  }} />
                </div>
                <span className="mono" style={{ fontSize: 12, color: "var(--sq-mute,#888)", minWidth: 28, textAlign: "right" }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {beauty.topConcerns.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--sq-mute,#888)", textAlign: "center", padding: "16px 0" }}>
          No skin profiles captured yet. Concern data populates as shoppers complete the Beauty widget.
        </p>
      )}

      {beauty.replenishmentDueSoon > 0 && (
        <div style={{ marginTop: 20, padding: "12px 14px", background: "rgba(244,114,182,0.08)", border: "1px solid rgba(244,114,182,0.2)", borderRadius: 8 }}>
          <p style={{ fontSize: 13, color: "#f9a8d4" }}>
            <strong>{beauty.replenishmentDueSoon}</strong> shopper{beauty.replenishmentDueSoon > 1 ? "s are" : " is"} entering the replenishment window.{" "}
            <span style={{ color: "var(--sq-mute,#888)" }}>
              Consider a targeted email or loyalty nudge for repeat purchase.
            </span>
          </p>
        </div>
      )}
    </section>
  );
}

// ─── Ingredient Trends card ───────────────────────────────────────────────

type IngredientTrendItem = {
  ingredient: string;
  count: number;
  trend: "rising" | "stable" | "falling";
  recent30: number;
  prior30: number;
};

type IngredientTrendsData = {
  top5: IngredientTrendItem[];
  gapIngredients: string[];
};

function IngredientTrendsCard({ ingredientTrends }: { ingredientTrends: IngredientTrendsData }) {
  const { top5, gapIngredients } = ingredientTrends;
  const maxCount = top5[0]?.count ?? 1;

  const trendArrow = (t: IngredientTrendItem["trend"]) => {
    if (t === "rising")  return { symbol: "↑", color: "#6EE7B7" };
    if (t === "falling") return { symbol: "↓", color: "#FCA5A5" };
    return { symbol: "→", color: "var(--sq-mute,#888)" };
  };

  return (
    <section className="sq-card" style={{ marginBottom: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 className="sq-card__title">Ingredient Trends</h2>
          <p className="sq-card__sub">What shoppers are searching for · last 90 days</p>
        </div>
        <span style={{
          background: "linear-gradient(135deg,#f472b6,#a78bfa)",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          padding: "4px 10px",
          borderRadius: 20,
          textTransform: "uppercase",
        }}>Beauty Intelligence · Ingredients</span>
      </div>

      {top5.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--sq-mute,#888)", textAlign: "center", padding: "16px 0" }}>
          No ingredient queries yet. Data populates as shoppers search in the beauty chat.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: gapIngredients.length > 0 ? 24 : 0 }}>
          {top5.map((item) => {
            const barPct = Math.round((item.count / maxCount) * 100);
            const { symbol, color } = trendArrow(item.trend);
            return (
              <div key={item.ingredient} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* Trend arrow */}
                <span style={{ fontSize: 16, color, fontWeight: 700, minWidth: 18, textAlign: "center" }}>
                  {symbol}
                </span>
                {/* Ingredient name */}
                <span style={{
                  fontSize: 13,
                  color: "var(--sq-text,#fff)",
                  minWidth: 130,
                  textTransform: "capitalize",
                  fontFamily: "inherit",
                }}>
                  {item.ingredient}
                </span>
                {/* Bar */}
                <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${barPct}%`,
                    background: item.trend === "rising"
                      ? "linear-gradient(90deg,#34d399,#6ee7b7)"
                      : item.trend === "falling"
                      ? "linear-gradient(90deg,#f87171,#fca5a5)"
                      : "linear-gradient(90deg,#8B5CF6,#a78bfa)",
                    borderRadius: 3,
                    transition: "width .5s cubic-bezier(.2,.8,.2,1)",
                  }} />
                </div>
                {/* Count + recent/prior */}
                <span className="mono" style={{ fontSize: 12, color: "var(--sq-mute,#888)", minWidth: 28, textAlign: "right" }}>
                  {item.count}
                </span>
                <span className="mono" style={{ fontSize: 10, color: "var(--sq-mute-2,#5a5663)", minWidth: 72, whiteSpace: "nowrap" }}>
                  {item.recent30}↗ / {item.prior30}↗ prev
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Gap ingredients */}
      {gapIngredients.length > 0 && (
        <div>
          <p style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--sq-pink,#e879c8)",
            marginBottom: 10,
          }}>
            Missing from catalog — shoppers searched, you don&apos;t carry
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {gapIngredients.map((kw) => (
              <span key={kw} style={{
                fontSize: 11,
                padding: "3px 10px",
                borderRadius: 999,
                background: "rgba(232,121,200,0.08)",
                border: "1px solid rgba(232,121,200,0.3)",
                color: "#f9a8d4",
                textTransform: "capitalize",
                fontFamily: "inherit",
              }}>
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Styles (scoped via .sq-shell ancestor) ──────────────────────────────

// ════════════════════════════════════════════════════════════════════════
//  FASHION INTELLIGENCE — the four pillars (production, prop-driven)
//  Consumer · Conversion · Fit & Confidence · Style & Merchandising.
//  Same shape + look as the demo (apps/web), but data comes from the loader
//  (buildOverview → getFashionIntelligence, shopId-scoped, tier-gated). Every
//  number names a merchandising/marketing decision (§11). Uses the production
//  --sq- token names + literal font stacks (no demo unprefixed vars).
// ════════════════════════════════════════════════════════════════════════

const FI_MONO = '"JetBrains Mono", ui-monospace, monospace';
const FI_SERIF = '"Instrument Serif", "Cormorant Garamond", Georgia, serif';
const FI_SANS = '"Manrope", ui-sans-serif, system-ui, sans-serif';
const FI_TEAL = "#7FE3C0";
const FI_AMBER = "#E8A86B";
const FI_RED = "#E89090";

const FI_TONE_COLOR: Record<ExecCard["tone"], string> = {
  loved: "var(--sq-pink)",
  growing: "var(--sq-electric)",
  converting: FI_TEAL,
  watch: FI_AMBER,
};
const FI_SIGNAL_LABEL: Record<ColorRow["signal"], string> = {
  converter: "converts",
  curiosity: "curiosity",
  steady: "steady",
  sleeper: "sleeper",
};
const FI_SIGNAL_COLOR: Record<ColorRow["signal"], string> = {
  converter: FI_TEAL,
  curiosity: FI_AMBER,
  steady: "var(--sq-electric)",
  sleeper: "var(--sq-mute)",
};

function FITrendArrow({ trend, deltaPct }: { trend: Trend; deltaPct?: number }) {
  const glyph = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const color = trend === "up" ? FI_TEAL : trend === "down" ? FI_RED : "var(--sq-mute)";
  return (
    <span style={{ fontFamily: FI_MONO, fontSize: 11, color, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
      {glyph}
      {typeof deltaPct === "number" ? ` ${deltaPct > 0 ? "+" : ""}${deltaPct}%` : ""}
    </span>
  );
}

function FIPanel({
  tag,
  title,
  blurb,
  accent,
  children,
}: {
  tag: string;
  title: string;
  blurb?: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#161616",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 3,
        padding: "28px 26px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div>
        <span style={{ fontFamily: FI_MONO, fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: accent }}>
          {tag}
        </span>
        <h3 style={{ fontFamily: FI_SERIF, fontSize: 24, fontStyle: "italic", fontWeight: 400, margin: "8px 0 0" }}>{title}</h3>
        {blurb && (
          <p style={{ fontFamily: FI_SANS, fontSize: 12.5, color: "var(--sq-mute)", margin: "8px 0 0", lineHeight: 1.55 }}>{blurb}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function FIShareBar({ label, share, color, trend, deltaPct }: { label: string; share: number; color: string; trend?: Trend; deltaPct?: number }) {
  // `share` is a 0–1 ratio. Render as a whole-number percentage.
  const p = Math.round(share * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: FI_SANS, fontSize: 13, color: "var(--sq-text)", textTransform: "capitalize" }}>{label}</span>
        <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          {trend && <FITrendArrow trend={trend} deltaPct={deltaPct} />}
          <span style={{ fontFamily: FI_MONO, fontSize: 12, color: "var(--sq-mute)" }}>{p}%</span>
        </span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, p)}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function FIRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontFamily: FI_SANS, fontSize: 12.5, color: "var(--sq-mute)" }}>{k}</span>
      <span style={{ fontFamily: FI_MONO, fontSize: 12.5, color: "var(--sq-text)", whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}

function FIMiniStat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{ flex: "1 1 130px", background: "#1A1A1A", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 3, padding: "16px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontFamily: FI_MONO, fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "var(--sq-mute)" }}>{label}</span>
      <span style={{ fontFamily: FI_SERIF, fontSize: 30, fontStyle: "italic", lineHeight: 1, color: accent }}>{value}</span>
      <span style={{ fontFamily: FI_SANS, fontSize: 11, color: "var(--sq-mute)" }}>{sub}</span>
    </div>
  );
}

// A subtle inline upgrade hint shown where a pillar is gated off for this tier.
function FILockedHint({ tier, label }: { tier: string; label: string }) {
  return (
    <FIPanel tag="Locked" title={label} accent="var(--sq-mute)" blurb={`Available on ${tier}. Upgrade to unlock this intelligence.`}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: FI_MONO, fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "var(--sq-mute)" }}>
          ✦ {tier}
        </span>
      </div>
    </FIPanel>
  );
}

function FashionIntelligenceSection({ intel }: { intel: FashionIntelligence }) {
  const fi = intel;
  const c = fi.consumer;
  const cv = fi.conversion;
  const ft = fi.fit;
  const st = fi.style;
  const g = fi.gates;
  const upTo = (need: "GROWTH" | "ULTIMATE") => need;

  const maxColorTried = c.colors.reduce((m, x) => Math.max(m, x.tried), 1);
  const maxColorBought = c.colors.reduce((m, x) => Math.max(m, x.purchased), 1);
  const maxStyled = st.mostStyledNotSold.reduce((m, x) => Math.max(m, x.gap), 1);

  const panelStack: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };

  return (
    <div style={{ marginBottom: 56 }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: FI_MONO, fontSize: 10, letterSpacing: "0.4em", textTransform: "uppercase", color: "var(--sq-pink)" }}>
          Fashion intelligence
        </span>
        <span style={{ fontFamily: FI_MONO, fontSize: 10, color: "var(--sq-mute)", letterSpacing: "0.15em" }}>
          {fi.dataMode === "live+modelled"
            ? `${fmt.num(fi.realSignalCount)} live signals + modelled`
            : "modelled · awaiting live signals"}
        </span>
      </div>
      <h2 style={{ fontFamily: FI_SERIF, fontSize: 30, fontStyle: "italic", fontWeight: 400, margin: "0 0 8px" }}>
        Who&rsquo;s shopping, and what converts.
      </h2>
      <p style={{ fontFamily: FI_SANS, fontSize: 14, color: "var(--sq-mute)", margin: "0 0 28px", maxWidth: 620, lineHeight: 1.6 }}>
        Four pillars from every Mira conversation and try-on: who your shoppers are, what turns into
        revenue, where fit confidence breaks, and which pieces are quietly winning.
      </p>

      {/* Executive summary cards — the at-a-glance hero row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
        {fi.exec.map((e) => {
          const col = FI_TONE_COLOR[e.tone];
          return (
            <div
              key={e.label}
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.07)",
                borderTop: `2px solid ${col}`,
                borderRadius: 3,
                padding: "22px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span style={{ fontFamily: FI_MONO, fontSize: 9.5, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--sq-mute)" }}>
                {e.label}
              </span>
              <span style={{ fontFamily: FI_SERIF, fontSize: 26, fontStyle: "italic", lineHeight: 1.1, color: col }}>{e.value}</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: FI_SANS, fontSize: 11.5, color: "var(--sq-mute)", lineHeight: 1.4 }}>{e.sub}</span>
                {e.trend && <FITrendArrow trend={e.trend} deltaPct={e.deltaPct} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Two-column: left overview rail · right detailed pillars */}
      <div className="sq-intel-grid">
        {/* ── LEFT RAIL — overview ─────────────────────────────── */}
        <div style={panelStack}>
          <FIPanel tag="Overview" title="Style registers" accent="var(--sq-electric)" blurb="The aesthetic your shoppers actually gravitate to.">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {c.styleMap.slice(0, 6).map((s) => (
                <FIShareBar key={s.style} label={s.style} share={s.share} color="var(--sq-electric)" trend={s.trend} deltaPct={s.deltaPct} />
              ))}
            </div>
          </FIPanel>
          {g.conversion ? (
            <FIPanel tag="Overview" title="Conversion snapshot" accent={FI_TEAL} blurb="The money: try-on lifts purchase the most.">
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
                  <div>
                    <div style={{ fontFamily: FI_SERIF, fontSize: 40, fontStyle: "italic", lineHeight: 1, color: FI_TEAL }}>
                      {Math.round(cv.tryOnPurchaseRate * 100)}%
                    </div>
                    <div style={{ fontFamily: FI_MONO, fontSize: 10, color: "var(--sq-mute)", letterSpacing: "0.15em", marginTop: 6 }}>WITH TRY-ON</div>
                  </div>
                  <div style={{ paddingBottom: 4 }}>
                    <div style={{ fontFamily: FI_SERIF, fontSize: 24, fontStyle: "italic", lineHeight: 1, color: "var(--sq-mute)" }}>
                      {Math.round(cv.baselinePurchaseRate * 100)}%
                    </div>
                    <div style={{ fontFamily: FI_MONO, fontSize: 10, color: "var(--sq-mute)", letterSpacing: "0.15em", marginTop: 6 }}>WITHOUT</div>
                  </div>
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <div style={{ fontFamily: FI_SERIF, fontSize: 28, fontStyle: "italic", color: "var(--sq-pink)", lineHeight: 1 }}>
                      {cv.tryOnLiftX.toFixed(1)}×
                    </div>
                    <div style={{ fontFamily: FI_MONO, fontSize: 9.5, color: "var(--sq-mute)", letterSpacing: "0.12em", marginTop: 6 }}>LIFT</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
                  <FIRow k="Bought a recommended bundle" v={`${Math.round(cv.bundlePurchaseRate * 100)}%`} />
                  <FIRow k="Added an AI-suggested item" v={`${Math.round(cv.aiSuggestedAddRate * 100)}%`} />
                  <FIRow k="Full-look bundles convert" v={`${cv.fullLookMultiplier.toFixed(1)}× better`} />
                  <FIRow k="Stylist users spend" v={`+${Math.round(cv.stylistSpendLift * 100)}%`} />
                </div>
              </div>
            </FIPanel>
          ) : (
            <FILockedHint tier={upTo("GROWTH")} label="Conversion snapshot" />
          )}
        </div>

        {/* ── MAIN — detailed pillars ───────────────────────────── */}
        <div style={panelStack}>
          {/* PILLAR 1 — colour heat-map */}
          {g.colors ? (
            <FIPanel
              tag="Pillar 01 · Consumer"
              title="Colour: curiosity vs. conversion"
              accent="var(--sq-electric)"
              blurb="What gets tried (the left bar) isn't always what sells (the right). Separate the show-stoppers from the close-rate."
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                {c.colors.slice(0, 9).map((col) => (
                  <div key={col.color} style={{ background: "#1A1A1A", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", background: col.hex, border: "1px solid rgba(255,255,255,0.18)", flexShrink: 0 }} />
                    <span style={{ fontFamily: FI_SANS, fontSize: 13, color: "var(--sq-text)", textTransform: "capitalize", width: 92, flexShrink: 0 }}>{col.color}</span>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                        <div style={{ width: `${Math.round((col.tried / maxColorTried) * 100)}%`, height: "100%", background: "var(--sq-electric)", borderRadius: 3 }} />
                      </div>
                      <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                        <div style={{ width: `${Math.round((col.purchased / maxColorBought) * 100)}%`, height: "100%", background: "var(--sq-pink)", borderRadius: 3 }} />
                      </div>
                    </div>
                    <span style={{ fontFamily: FI_MONO, fontSize: 11, color: "var(--sq-mute)", width: 38, textAlign: "right", flexShrink: 0 }}>
                      {Math.round(col.convertRate * 100)}%
                    </span>
                    <span style={{ fontFamily: FI_MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: FI_SIGNAL_COLOR[col.signal], width: 64, textAlign: "right", flexShrink: 0 }}>
                      {FI_SIGNAL_LABEL[col.signal]}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 16, fontFamily: FI_MONO, fontSize: 9.5, letterSpacing: "0.1em", color: "var(--sq-mute)" }}>
                <span><span style={{ color: "var(--sq-electric)" }}>▬</span> tried</span>
                <span><span style={{ color: "var(--sq-pink)" }}>▬</span> purchased</span>
                <span>% = converts of tried</span>
              </div>
            </FIPanel>
          ) : (
            <FILockedHint tier={upTo("GROWTH")} label="Colour: curiosity vs. conversion" />
          )}

          {/* PILLAR 1 — sizing + fit + occasion */}
          <div className="sq-intel-pair">
            <FIPanel tag="Consumer" title="Sizing & fit" accent="var(--sq-electric)">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {c.topSizes.slice(0, 5).map((s) => (
                  <FIShareBar key={s.size} label={s.size} share={s.share} color="var(--sq-electric)" />
                ))}
              </div>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {c.fitPrefs.slice(0, 3).map((f) => (
                  <FIShareBar key={f.pref} label={f.pref} share={f.share} color="var(--sq-pink)" />
                ))}
              </div>
              <p style={{ fontFamily: FI_SANS, fontSize: 12.5, color: "var(--sq-text)", fontStyle: "italic", margin: 0, lineHeight: 1.5, borderLeft: "2px solid var(--sq-pink)", paddingLeft: 12 }}>
                {c.bodyInsight}
              </p>
            </FIPanel>
            {g.occasions ? (
              <FIPanel tag="Consumer" title="The why — occasions" accent="var(--sq-electric)">
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {c.occasions.slice(0, 6).map((o) => (
                    <FIShareBar key={o.occasion} label={o.occasion} share={o.share} color="var(--sq-electric)" trend={o.trend} deltaPct={o.deltaPct} />
                  ))}
                </div>
              </FIPanel>
            ) : (
              <FILockedHint tier={upTo("GROWTH")} label="The why — occasions" />
            )}
          </div>

          {c.combos.length > 0 && (
            <FIPanel tag="Consumer" title="What they combine" accent="var(--sq-electric)" blurb="The pairings shoppers build into a look — your natural bundle candidates.">
              <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                {c.combos.slice(0, 5).map((cb) => (
                  <div key={cb.label} style={{ background: "#1A1A1A", padding: "13px 15px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontFamily: FI_SANS, fontSize: 13, color: "var(--sq-text)" }}>{cb.pieces.join("  +  ")}</span>
                    <span style={{ display: "flex", gap: 14, alignItems: "baseline", flexShrink: 0 }}>
                      <span style={{ fontFamily: FI_MONO, fontSize: 11, color: "var(--sq-mute)" }}>{cb.count}×</span>
                      <span style={{ fontFamily: FI_SERIF, fontSize: 16, fontStyle: "italic", color: "var(--sq-pink)" }}>${fmt.num(cb.aov)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </FIPanel>
          )}

          {/* PILLAR 2 — Conversion: confidence + drop-off */}
          {g.conversion && (
            <div className="sq-intel-pair">
              <FIPanel tag="Pillar 02 · Conversion" title="Buying confidence" accent={FI_TEAL} blurb="A composite of try-on, size-acceptance and recommendation-follow signals.">
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <div style={{ fontFamily: FI_SERIF, fontSize: 52, fontStyle: "italic", lineHeight: 1, color: FI_TEAL }}>{cv.confidenceScore}</div>
                  <div style={{ fontFamily: FI_MONO, fontSize: 10, color: "var(--sq-mute)", letterSpacing: "0.15em", lineHeight: 1.5 }}>/ 100<br />SHOPPER<br />CONFIDENCE</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
                  {cv.confidenceDrivers.map((dr) => (
                    <FIShareBar key={dr.label} label={dr.label} share={dr.weight} color={FI_TEAL} />
                  ))}
                </div>
              </FIPanel>
              <FIPanel tag="Conversion" title="Where they drop off" accent={FI_AMBER} blurb="The friction points to fix first.">
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {cv.dropOff.map((dr) => (
                    <FIShareBar key={dr.stage} label={dr.stage} share={dr.lossPct} color={FI_AMBER} />
                  ))}
                </div>
              </FIPanel>
            </div>
          )}

          {/* PILLAR 3 — Fit & confidence */}
          {g.fit ? (
            <FIPanel
              tag="Pillar 03 · Fit & confidence"
              title="The return-reduction weapon"
              accent={FI_TEAL}
              blurb="Size confidence and the products causing fit hesitation — the leading indicator of returns."
            >
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <FIMiniStat label="Size confidence" value={`${ft.sizeConfidence}%`} sub="accept the recommendation" accent={FI_TEAL} />
                <FIMiniStat
                  label="Return risk"
                  value={`${ft.returnRiskScore}`}
                  sub={`${ft.returnRiskLevel} · /100`}
                  accent={ft.returnRiskLevel === "low" ? FI_TEAL : ft.returnRiskLevel === "moderate" ? FI_AMBER : FI_RED}
                />
              </div>
              <p style={{ fontFamily: FI_SANS, fontSize: 12.5, color: "var(--sq-text)", fontStyle: "italic", margin: 0, lineHeight: 1.5, borderLeft: `2px solid ${FI_AMBER}`, paddingLeft: 12 }}>
                Top driver: {ft.topReturnDriver}
              </p>
              <div>
                <span style={{ fontFamily: FI_MONO, fontSize: 9.5, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--sq-mute)" }}>Fit confusion by product</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {ft.productFit.slice(0, 5).map((p) => (
                    <div key={p.handle} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontFamily: FI_SANS, fontSize: 12.5, color: "var(--sq-text)", width: 130, flexShrink: 0 }}>{p.name}</span>
                      <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                        <div style={{ width: `${Math.round(p.confusion * 100)}%`, height: "100%", background: p.confusion > 0.5 ? FI_RED : p.confusion > 0.3 ? FI_AMBER : FI_TEAL, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontFamily: FI_MONO, fontSize: 10.5, color: "var(--sq-mute)", width: 36, textAlign: "right", flexShrink: 0 }}>{Math.round(p.confusion * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <p style={{ fontFamily: FI_SANS, fontSize: 12, color: "var(--sq-mute)", margin: 0 }}>Best-fitting audience: <span style={{ color: "var(--sq-text)" }}>{ft.bestAudience}</span></p>
            </FIPanel>
          ) : (
            <FILockedHint tier={upTo("ULTIMATE")} label="Fit & confidence — the return-reduction weapon" />
          )}

          {/* PILLAR 4 — Style & merchandising */}
          {g.style ? (
            <>
              <div className="sq-intel-pair">
                <FIPanel tag="Pillar 04 · Merchandising" title="Most styled, not yet sold" accent="var(--sq-pink)" blurb="High styling interest, low sales rank — tomorrow's winners to protect in stock.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {st.mostStyledNotSold.slice(0, 5).map((s) => (
                      <div key={s.handle} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontFamily: FI_SANS, fontSize: 12.5, color: "var(--sq-text)", flex: 1, minWidth: 0 }}>{s.name}</span>
                        <div style={{ width: 90, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, flexShrink: 0 }}>
                          <div style={{ width: `${Math.round((s.gap / maxStyled) * 100)}%`, height: "100%", background: "var(--sq-pink)", borderRadius: 3 }} />
                        </div>
                        <span style={{ fontFamily: FI_MONO, fontSize: 10, color: "var(--sq-mute)", whiteSpace: "nowrap", flexShrink: 0 }}>+{s.gap}</span>
                      </div>
                    ))}
                  </div>
                </FIPanel>
                <FIPanel tag="Merchandising" title="Emerging trends" accent="var(--sq-pink)" blurb="Direction of travel across colour, cut, fit and material.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                    {st.emergingTrends.slice(0, 7).map((t) => (
                      <div key={t.label} style={{ background: "#1A1A1A", padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontFamily: FI_SANS, fontSize: 13, color: "var(--sq-text)" }}>{t.label}</span>
                        <FITrendArrow trend={t.direction} deltaPct={t.deltaPct} />
                      </div>
                    ))}
                  </div>
                </FIPanel>
              </div>

              {st.compatibility.length > 0 && (
                <FIPanel tag="Merchandising" title="Outfit compatibility" accent="var(--sq-pink)" blurb="The pairings that lift basket size when shown together.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                    {st.compatibility.slice(0, 5).map((p) => (
                      <div key={p.pair.join("|")} style={{ background: "#1A1A1A", padding: "12px 15px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontFamily: FI_SANS, fontSize: 12.5, color: "var(--sq-text)" }}>{p.pair[0]}  +  {p.pair[1]}</span>
                        <span style={{ display: "flex", gap: 14, alignItems: "baseline", flexShrink: 0 }}>
                          <span style={{ fontFamily: FI_MONO, fontSize: 10.5, color: "var(--sq-mute)" }}>{Math.round(p.score * 100)}% match</span>
                          <span style={{ fontFamily: FI_SERIF, fontSize: 16, fontStyle: "italic", color: FI_TEAL }}>+{Math.round(p.lift * 100)}% AOV</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </FIPanel>
              )}

              {st.collections.length > 0 && (
                <FIPanel tag="Merchandising" title="Collections by audience" accent="var(--sq-pink)">
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                    {st.collections.slice(0, 5).map((cl) => (
                      <div key={cl.collection} style={{ background: "#1A1A1A", padding: "13px 15px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontFamily: FI_SANS, fontSize: 13, color: "var(--sq-text)" }}>{cl.collection}</div>
                          <div style={{ fontFamily: FI_MONO, fontSize: 10, color: "var(--sq-mute)", letterSpacing: "0.08em", marginTop: 4 }}>
                            {cl.topAge} · {cl.topOccasion} · {cl.topStyle}
                          </div>
                        </div>
                        <span style={{ fontFamily: FI_SERIF, fontSize: 20, fontStyle: "italic", color: "var(--sq-electric)", flexShrink: 0 }}>{Math.round(cl.share * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </FIPanel>
              )}
            </>
          ) : (
            <FILockedHint tier={upTo("ULTIMATE")} label="Style & merchandising intelligence" />
          )}
        </div>
      </div>

      <style>{`
        .sq-intel-grid { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); gap: 12px; align-items: start; }
        .sq-intel-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        @media (max-width: 900px) {
          .sq-intel-grid { grid-template-columns: 1fr; }
          .sq-intel-pair { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --sq-bg: #08070A;
  --sq-surface: #14111A;
  --sq-surface-2: rgba(255,255,255,0.025);
  --sq-line: rgba(255,255,255,0.08);
  --sq-line-2: rgba(255,255,255,0.14);
  --sq-line-accent: rgba(201,181,255,0.35);
  --sq-text: #F4F2EE;
  --sq-mute: #8E8A99;
  --sq-mute-2: #5A5663;
  --sq-electric: #8B5CF6;
  --sq-pink: #E879C8;
  --sq-grad: linear-gradient(135deg, #8B5CF6 0%, #C26BE6 55%, #E879C8 100%);
  --sq-grad-soft: linear-gradient(135deg, rgba(139,92,246,.18) 0%, rgba(232,121,200,.10) 100%);
  --sq-shadow: 0 24px 60px rgba(0,0,0,.55);
}

.sq-shell {
  font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
  background: var(--sq-bg);
  color: var(--sq-text);
  min-height: 100vh;
  padding: 32px 36px 64px;
  position: relative;
  overflow-x: hidden;
}
.sq-shell::before {
  content: ""; position: absolute; inset: -10% -10% auto -10%; height: 360px;
  background: radial-gradient(60% 60% at 50% 0%, rgba(139,92,246,.18) 0%, rgba(232,121,200,.04) 50%, rgba(0,0,0,0) 80%);
  pointer-events: none; z-index: 0;
}
.sq-shell > * { position: relative; z-index: 1; }

.serif { font-family: "Instrument Serif", "Cormorant Garamond", Georgia, serif; font-weight: 400; }
.mono  { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; letter-spacing: .3px; color: var(--sq-mute); }

/* ─── Header ────────────────────────────────────────────────────────── */
.sq-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--sq-line); }
.sq-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 10.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--sq-mute); margin-bottom: 8px; }
.sq-eyebrow__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--sq-electric); box-shadow: 0 0 8px var(--sq-electric); }
.sq-h1 { font-size: 56px; line-height: 1; letter-spacing: -0.5px; margin: 0; font-weight: 400; }
.sq-h1 em { font-style: italic; background: var(--sq-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-sub { font-size: 13px; color: var(--sq-mute); margin: 12px 0 0; }
.sq-window { padding: 8px 14px; border: 1px solid var(--sq-line-2); border-radius: 999px; background: var(--sq-surface-2); }

/* ─── Usage rail ────────────────────────────────────────────────────── */
.sq-rail { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 32px; }
.sq-rail__item { padding: 14px 16px; border: 1px solid var(--sq-line); border-radius: 14px; background: var(--sq-surface); }
.sq-rail__row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.sq-rail__label { font-size: 12px; color: var(--sq-mute); }
.sq-rail__count { font-size: 12px; color: var(--sq-text); }
.sq-rail__bar { height: 4px; background: rgba(255,255,255,.05); border-radius: 999px; overflow: hidden; }
.sq-rail__fill { display: block; height: 100%; background: var(--sq-grad); border-radius: 999px; transition: width .4s cubic-bezier(.2,.8,.2,1); }

/* ─── Card grid ─────────────────────────────────────────────────────── */
.sq-grid { display: grid; gap: 18px; margin-bottom: 18px; }
.sq-grid--kpis { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.sq-grid--split { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); }

.sq-card { padding: 24px; border: 1px solid var(--sq-line); border-radius: 18px; background: var(--sq-surface); box-shadow: var(--sq-shadow); }
.sq-card__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; gap: 16px; flex-wrap: wrap; }
.sq-card__head h2 { font-size: 22px; margin: 0; font-weight: 400; }
.sq-tag { font-size: 10.5px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--sq-mute); padding: 4px 10px; border: 1px solid var(--sq-line-2); border-radius: 999px; }

/* ─── KPI ───────────────────────────────────────────────────────────── */
.sq-kpi { position: relative; overflow: hidden; padding: 22px 24px; }
.sq-kpi__label { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--sq-mute); margin-bottom: 14px; }
.sq-kpi__value { font-size: 44px; line-height: 1; margin-bottom: 8px; }
.sq-kpi__sub { font-size: 11px; color: var(--sq-mute); }
.sq-kpi::after { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--sq-electric); opacity: .35; }
.sq-kpi--pink::after { background: var(--sq-pink); }

/* ─── Funnel ────────────────────────────────────────────────────────── */
.sq-funnel { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
.sq-funnel__row { display: grid; grid-template-columns: 160px 1fr 80px; align-items: center; gap: 14px; }
.sq-funnel__label { font-size: 13px; color: var(--sq-text); }
.sq-funnel__track { height: 14px; background: rgba(255,255,255,.04); border-radius: 4px; overflow: hidden; }
.sq-funnel__bar { display: block; height: 100%; background: var(--sq-grad); border-radius: 4px; transition: width .6s cubic-bezier(.2,.8,.2,1); }
.sq-funnel__count { font-size: 12.5px; color: var(--sq-text); text-align: right; }
.sq-funnel__rate { color: var(--sq-mute); }
.sq-subblock { margin-top: 22px; padding-top: 18px; border-top: 1px dashed var(--sq-line); }
.sq-subblock__title { font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--sq-mute); margin-bottom: 12px; }
.sq-subblock__title--alert { color: var(--sq-pink); }
.sq-combo-list { list-style: none; padding: 0; margin: 0; }
.sq-combo-list li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--sq-line); font-size: 14px; flex-wrap: wrap; }
.sq-combo-list__name { color: var(--sq-text); flex: 1; }
.sq-combo-list__form { display: contents; }
.sq-btn-ghost-sm { font-size: 11px; color: var(--sq-mute); border: 1px solid var(--sq-line-2); padding: 4px 10px; background: transparent; border-radius: 999px; cursor: pointer; font-family: inherit; letter-spacing: .3px; transition: color .15s, border-color .15s; white-space: nowrap; }
.sq-btn-ghost-sm:hover { color: var(--sq-text); border-color: var(--sq-line-accent); }

/* ─── Widget mini KPIs + distributions ─────────────────────────────── */
.sq-mini-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 16px; margin-bottom: 22px; }
.sq-mini { padding: 12px 14px; border: 1px solid var(--sq-line); border-radius: 12px; background: var(--sq-surface-2); }
.sq-mini__value { font-size: 22px; line-height: 1; margin-bottom: 4px; }
.sq-mini__label { font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--sq-mute); }
.sq-mini__suffix { font-size: 12px; color: var(--sq-mute); margin-left: 2px; }
.sq-tryon-strip { margin: -4px 0 22px; padding: 14px 16px; border: 1px solid var(--sq-line); border-radius: 12px; background: var(--sq-surface-2); }
.sq-tryon-strip__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sq-tryon-strip__link { color: var(--sq-mute); text-decoration: none; }
.sq-tryon-strip__link:hover { color: var(--sq-text); }
.sq-mini-kpis--inset { margin-bottom: 0; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.sq-mini-kpis--inset .sq-mini { padding: 10px 12px; background: rgba(255,255,255,.02); }
.sq-mini-kpis--inset .sq-mini__value { font-size: 18px; }
.sq-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
.sq-dist__title { font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--sq-mute); margin-bottom: 12px; }
.sq-dist ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.sq-dist__row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; text-transform: capitalize; }
.sq-dist__bar { height: 6px; background: rgba(255,255,255,.04); border-radius: 999px; overflow: hidden; }
.sq-dist__bar span { display: block; height: 100%; background: var(--sq-grad); border-radius: 999px; transition: width .6s cubic-bezier(.2,.8,.2,1); }
.sq-dist__empty { font-size: 12px; color: var(--sq-mute-2); padding: 16px 0; }

/* ─── Catalog gap list ─────────────────────────────────────────────── */
.sq-querylist { list-style: none; padding: 0; margin: 0; }
.sq-querylist li { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed var(--sq-line); font-size: 14px; }
.sq-querylist--gap li { color: var(--sq-text); }
.sq-querylist--gap li .serif::before { content: "↗ "; color: var(--sq-pink); margin-right: 4px; }
.sq-empty { font-size: 12px; color: var(--sq-mute-2); padding: 16px 0; }

/* ─── Taste lanes ──────────────────────────────────────────────────── */
.sq-taste { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 28px; }
.sq-lane__title { font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--sq-mute); margin-bottom: 14px; }
.sq-lane__row { display: grid; grid-template-columns: 1fr; gap: 6px; margin-bottom: 12px; }
.sq-lane__bar { height: 22px; border-radius: 4px; background: rgba(255,255,255,.04); overflow: hidden; }
.sq-lane__bar span { display: block; height: 100%; background: var(--sq-grad-soft); border-left: 2px solid var(--sq-electric); transition: width .6s cubic-bezier(.2,.8,.2,1); }
.sq-lane__label { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; text-transform: capitalize; }

/* ─── Benchmark band ───────────────────────────────────────────────── */
.sq-bench__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
.sq-bench__row { display: grid; grid-template-columns: 200px 1fr 60px; align-items: center; gap: 14px; }
.sq-bench__label { font-size: 13px; }
.sq-bench__track { position: relative; height: 28px; border-radius: 6px; background: linear-gradient(to right, rgba(255,255,255,.02), rgba(255,255,255,.06)); border: 1px solid var(--sq-line); overflow: visible; }
.sq-bench__p50, .sq-bench__p75, .sq-bench__p90 { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--sq-line-2); }
.sq-bench__p50 { left: 50%; }
.sq-bench__p75 { left: 75%; }
.sq-bench__p90 { left: 90%; }
.sq-bench__you { position: absolute; top: -4px; bottom: -4px; width: 4px; background: var(--sq-pink); border-radius: 4px; box-shadow: 0 0 12px var(--sq-pink); transform: translateX(-50%); }
.sq-bench__pct { font-size: 13px; color: var(--sq-text); text-align: right; }
.sq-bench__legend { margin-top: 14px; text-align: right; font-size: 10.5px; }

/* ─── Recommendations feed ────────────────────────────────────────── */
.sq-recs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
.sq-rec { display: grid; grid-template-columns: 3px 1fr; gap: 18px; padding: 16px 18px; background: var(--sq-surface-2); border: 1px solid var(--sq-line); border-radius: 14px; transition: border-color .2s, transform .2s; }
.sq-rec:hover { border-color: var(--sq-line-accent); transform: translateY(-1px); }
.sq-rec__bar { border-radius: 4px; }
.sq-rec__meta { font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--sq-mute); margin-bottom: 6px; }
.sq-rec__title { font-size: 19px; margin-bottom: 6px; }
.sq-rec__copy { font-size: 13px; color: var(--sq-mute); margin: 0 0 12px; line-height: 1.5; }
.sq-rec__row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.sq-rec__cta { font-size: 13px; color: var(--sq-text); border: 0; padding: 8px 14px; background: var(--sq-grad); border-radius: 999px; display: inline-flex; align-items: center; box-shadow: 0 6px 14px rgba(139,92,246,.35), inset 0 1px 0 rgba(255,255,255,.18); transition: filter .2s, transform .2s; cursor: pointer; font-family: inherit; }
.sq-rec__cta:hover { filter: brightness(1.08); transform: translateY(-1px); }
.sq-rec__ghost { font-size: 12.5px; color: var(--sq-mute); border: 1px solid var(--sq-line-2); padding: 7px 14px; background: transparent; border-radius: 999px; cursor: pointer; font-family: inherit; transition: color .15s, border-color .15s; }
.sq-rec__ghost:hover { color: var(--sq-text); border-color: var(--sq-line-accent); }

.sq-empty-block { text-align: center; padding: 48px 24px; }
.sq-empty-block h2 { font-size: 28px; margin: 0 0 8px; font-weight: 400; }
.sq-empty-block p { font-size: 13px; color: var(--sq-mute); margin: 0; }

/* ─── Shopper Conversations / Sentiment ──────────────────────────── */
.sq-empty-state { font-size: 13px; color: var(--sq-mute); margin: 0; }
.sq-sentiment-bar { display: flex; flex-direction: row; height: 6px; border-radius: 3px; overflow: hidden; margin-bottom: 10px; }
.sq-sentiment-bar > div { flex-shrink: 0; }
.sq-sentiment-legend { display: flex; gap: 16px; font-size: 11px; color: var(--sq-mute); margin-bottom: 4px; }
.sq-themes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.sq-theme-chip { font-size: 10.5px; border: 1px solid var(--sq-line-2); border-radius: 20px; padding: 2px 8px; color: var(--sq-mute); background: var(--sq-surface-2); }
.sq-summaries { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.sq-summary-row { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--sq-text); }
.sq-dot { display: inline-block; width: 6px; height: 6px; border-radius: 999px; flex-shrink: 0; }
.sq-dot-positive { background: #6EE7B7; }
.sq-dot-neutral  { background: #94A3B8; }
.sq-dot-negative { background: #FCA5A5; }

.sq-footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--sq-line); text-align: center; }

/* ─── Toast — Studio creative queued confirmation ──────────────────── */
@keyframes sq-toast-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes sq-toast-out { 0% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
.sq-toast {
  position: fixed; bottom: 24px; right: 24px; z-index: 9999;
  padding: 10px 18px; border-radius: 12px;
  background: var(--sq-surface); border: 1px solid rgba(120, 220, 160, .45);
  color: #B6F0C8; font-size: 13px; font-family: inherit;
  box-shadow: 0 8px 24px rgba(0,0,0,.55);
  animation: sq-toast-in .25s ease, sq-toast-out 4s ease forwards;
  pointer-events: none;
}

/* ─── Insights badge (nav dot) ────────────────────────────────────── */
.sq-header__right { display: flex; align-items: center; gap: 12px; }
.sq-insights-badge {
  min-width: 22px; height: 22px; padding: 0 6px;
  background: #EF4444; color: #fff;
  font-size: 11px; font-weight: 700;
  border-radius: 999px; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 10px rgba(239,68,68,.55);
}

/* ─── Insights panels ─────────────────────────────────────────────── */
.sq-insights-section { margin-bottom: 32px; }
.sq-insights-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; gap: 16px; flex-wrap: wrap; }
.sq-insights-head h2 { font-size: 24px; margin: 0; font-weight: 400; }
.sq-mb { margin-bottom: 32px; }
.sq-mb-sm { margin-bottom: 18px; }
.sq-tag--growth { border-color: rgba(52,211,153,.4); color: #34D399; }
.sq-tag--ultimate { border-color: rgba(232,121,200,.4); color: var(--sq-pink); }

/* ─── Table ────────────────────────────────────────────────────────── */
.sq-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.sq-table th { font-size: 10.5px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--sq-mute); font-weight: 500; padding: 8px 0; border-bottom: 1px solid var(--sq-line); text-align: left; }
.sq-table td { padding: 10px 0; border-bottom: 1px dashed var(--sq-line); color: var(--sq-text); vertical-align: middle; }
.sq-table__num { text-align: right; }
.sq-table tr:last-child td { border-bottom: none; }

/* ─── Urgency badges ───────────────────────────────────────────────── */
.sq-urgency { font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; font-weight: 600; }
.sq-urgency--high { background: rgba(239,68,68,.15); color: #FCA5A5; border: 1px solid rgba(239,68,68,.3); }
.sq-urgency--medium { background: rgba(251,191,36,.12); color: #FCD34D; border: 1px solid rgba(251,191,36,.25); }
.sq-urgency--low { background: var(--sq-surface-2); color: var(--sq-mute); border: 1px solid var(--sq-line); }

/* ─── Confidence badges ────────────────────────────────────────────── */
.sq-confidence { font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; font-weight: 600; }
.sq-confidence--high { background: rgba(52,211,153,.12); color: #6EE7B7; border: 1px solid rgba(52,211,153,.25); }
.sq-confidence--medium { background: rgba(251,191,36,.12); color: #FCD34D; border: 1px solid rgba(251,191,36,.25); }
.sq-confidence--low { background: var(--sq-surface-2); color: var(--sq-mute); border: 1px solid var(--sq-line); }
.sq-urgent-text { color: #FCA5A5; font-weight: 600; }

/* ─── Trend chips ──────────────────────────────────────────────────── */
.sq-trend-chips { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.sq-trend-chip { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; border: 1px solid; cursor: default; }
.sq-trend-chip--stock_now { border-color: rgba(52,211,153,.4); background: rgba(52,211,153,.07); }
.sq-trend-chip--watch { border-color: rgba(251,191,36,.35); background: rgba(251,191,36,.06); }
.sq-trend-chip--declining { border-color: rgba(239,68,68,.3); background: rgba(239,68,68,.05); }
.sq-trend-chip__attr { font-size: 14px; color: var(--sq-text); }
.sq-trend-chip__stat { font-size: 11px; color: var(--sq-mute); }
.sq-trend-chip--stock_now .sq-trend-chip__attr { color: #6EE7B7; }
.sq-trend-chip--watch .sq-trend-chip__attr { color: #FCD34D; }
.sq-trend-chip--declining .sq-trend-chip__attr { color: #FCA5A5; }
.sq-trend-legend { display: flex; gap: 16px; font-size: 10.5px; }
.sq-trend-legend--stock { color: #6EE7B7; }
.sq-trend-legend--watch { color: #FCD34D; }
.sq-trend-legend--decline { color: #FCA5A5; }

/* ─── Segment insight ──────────────────────────────────────────────── */
.sq-segment-insight { font-size: 14px; color: var(--sq-text); margin: 12px 0 0; padding: 12px 16px; background: var(--sq-grad-soft); border-radius: 10px; border: 1px solid var(--sq-line-accent); line-height: 1.5; }

/* ─── Size distribution bars ───────────────────────────────────────── */
.sq-size-bars { display: flex; flex-direction: column; gap: 10px; }
.sq-size-bar-group { display: grid; grid-template-columns: 32px 1fr 36px; align-items: center; gap: 10px; }
.sq-size-bar-label { font-size: 11.5px; color: var(--sq-mute); text-align: right; }
.sq-size-bar-tracks { display: flex; flex-direction: column; gap: 3px; }
.sq-size-bar { height: 7px; border-radius: 3px; transition: width .6s cubic-bezier(.2,.8,.2,1); min-width: 2px; }
.sq-size-bar--current { background: var(--sq-grad); }
.sq-size-bar--previous { background: rgba(255,255,255,.15); }
.sq-size-bar-count { font-size: 11px; color: var(--sq-mute); }
.sq-size-bar-legend { display: flex; gap: 12px; margin-top: 8px; font-size: 10.5px; padding-left: 42px; }
.sq-size-bar-legend--curr { color: var(--sq-electric); }
.sq-size-bar-legend--prev { color: var(--sq-mute-2); }
.sq-drift-alert { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #FCD34D; border: 1px solid rgba(251,191,36,.3); border-radius: 999px; padding: 3px 10px; }
.sq-drift-detail { font-size: 12px; color: #FCD34D; margin: 10px 0 0; padding: 8px 12px; border: 1px dashed rgba(251,191,36,.3); border-radius: 8px; }

/* ─── Locked teaser (blurred preview + upgrade overlay) ────────────── */
.sq-locked-teaser { position: relative; border-radius: 18px; overflow: hidden; border: 1px solid var(--sq-line); background: var(--sq-surface); padding: 28px 24px 90px; }
.sq-locked-teaser__blur { opacity: 0.22; filter: blur(4px); pointer-events: none; display: flex; flex-direction: column; gap: 16px; }
.sq-locked-teaser__row { height: 22px; border-radius: 4px; background: var(--sq-grad-soft); border: 1px solid var(--sq-line-2); }
.sq-locked-teaser__overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(8,7,10,.7) 0%, rgba(8,7,10,.9) 100%); backdrop-filter: blur(2px); }
.sq-locked-teaser__inner { text-align: center; padding: 24px; max-width: 520px; }
.sq-locked-teaser__title { font-size: 22px; margin: 12px 0 10px; }
.sq-locked-teaser__desc { font-size: 13px; color: var(--sq-mute); margin: 0 0 20px; line-height: 1.6; }
.sq-locked-teaser__cta { display: inline-flex; text-decoration: none; }

/* ─── Reduced motion ──────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

/* ─── Responsive ──────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .sq-shell { padding: 20px; }
  .sq-h1 { font-size: 36px; }
  .sq-header { flex-direction: column; align-items: flex-start; }
  .sq-funnel__row { grid-template-columns: 120px 1fr 64px; }
  .sq-bench__row { grid-template-columns: 110px 1fr 48px; }
  .sq-funnel-steps__row { grid-template-columns: 120px 1fr 64px; }
  .sq-savings-row { flex-direction: column; }
  .sq-ecosystem__flows { flex-direction: column; gap: 12px; }
  /* KPI grid: 2-col on tablet. */
  .sq-grid--kpis { grid-template-columns: repeat(2, 1fr); }
  /* Split section: stack vertically. */
  .sq-grid--split { grid-template-columns: 1fr; }
}

/* Small mobile — Shopify admin on phone */
@media (max-width: 480px) {
  .sq-shell { padding: 14px; }
  .sq-h1 { font-size: 26px; }
  /* Single-column KPIs on phones. */
  .sq-grid--kpis { grid-template-columns: 1fr; }
  /* Funnel rows: tighten columns. */
  .sq-funnel__row { grid-template-columns: 90px 1fr 52px; font-size: 12px; }
  .sq-bench__row { grid-template-columns: 80px 1fr 40px; }
  .sq-funnel-steps__row { grid-template-columns: 90px 1fr 52px; }
  /* Card padding reduction. */
  .sq-card, .sq-module-card, .sq-ecosystem { padding: 16px; }
  /* Savings tiles: stack. */
  .sq-savings-row { flex-direction: column; }
  .sq-savings-tile { min-width: 0; }
  /* Hide less-important table column on very narrow screens. */
  .sq-table th:nth-child(4),
  .sq-table td:nth-child(4) { display: none; }
  /* Insights teaser. */
  .sq-locked-teaser { padding: 16px; }
}

/* ─── Module deep-dive cards ──────────────────────────────────────── */
.sq-module-card {
  padding: 28px 28px 24px;
  border: 1px solid var(--sq-line-accent);
  border-radius: 18px;
  background: var(--sq-surface);
  box-shadow: var(--sq-shadow);
  position: relative;
  overflow: hidden;
}
.sq-module-card::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; height: 2px;
  background: var(--sq-grad);
  opacity: .55;
}
.sq-module-card__sub {
  font-size: 10.5px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--sq-mute);
  margin-bottom: 14px;
}
.sq-module-card__sub--mt { margin-top: 22px; padding-top: 18px; border-top: 1px dashed var(--sq-line); }
.sq-module-card__notice {
  margin-top: 18px;
  padding: 10px 14px;
  border: 1px dashed var(--sq-line);
  border-radius: 8px;
  font-size: 11.5px;
  color: var(--sq-mute);
}

.sq-tag--module-mira  { border-color: rgba(139,92,246,.4);  color: #A78BFA; }
.sq-tag--module-vto   { border-color: rgba(232,121,200,.4); color: var(--sq-pink); }
.sq-tag--module-size  { border-color: rgba(52,211,153,.4);  color: #34D399; }
.sq-tag--module-studio { border-color: rgba(251,191,36,.4); color: #FCD34D; }

/* ─── Mini funnel steps (used inside module cards) ────────────────── */
.sq-funnel-steps {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sq-funnel-steps__row {
  display: grid;
  grid-template-columns: 160px 1fr 80px;
  align-items: center;
  gap: 12px;
}
.sq-funnel-steps__label { font-size: 13px; color: var(--sq-text); }
.sq-funnel-steps__track {
  height: 10px;
  background: rgba(255,255,255,.04);
  border-radius: 4px;
  overflow: hidden;
}
.sq-funnel-steps__bar {
  display: block;
  height: 100%;
  background: var(--sq-grad);
  border-radius: 4px;
  transition: width .6s cubic-bezier(.2,.8,.2,1);
}
.sq-funnel-steps__right { font-size: 12.5px; color: var(--sq-text); text-align: right; }
.sq-funnel-steps__rate { color: var(--sq-mute); }

/* ─── Savings tiles row ───────────────────────────────────────────── */
.sq-savings-row {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.sq-savings-row--3 .sq-savings-tile { flex: 1 1 0; min-width: 140px; }
.sq-savings-tile {
  flex: 1 1 0;
  min-width: 180px;
  padding: 16px 18px;
  border: 1px solid var(--sq-line);
  border-radius: 14px;
  background: var(--sq-surface-2);
}
.sq-savings-tile--full { flex: 1 1 100%; }
.sq-savings-tile--highlight {
  border-color: rgba(139,92,246,.35);
  background: rgba(139,92,246,.07);
}
.sq-savings-tile__value {
  font-size: 32px;
  line-height: 1;
  margin-bottom: 6px;
  background: var(--sq-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.sq-savings-tile--3 .sq-savings-tile__value { font-size: 26px; }
.sq-savings-tile__label {
  font-size: 12px;
  color: var(--sq-text);
  margin-bottom: 4px;
}
.sq-savings-tile__detail {
  font-size: 10.5px;
  color: var(--sq-mute);
  margin-top: 4px;
  line-height: 1.5;
}

/* ─── Ecosystem section ───────────────────────────────────────────── */
.sq-ecosystem {
  padding: 28px;
  border: 1px solid var(--sq-line);
  border-radius: 18px;
  background: var(--sq-surface);
  box-shadow: var(--sq-shadow);
}
.sq-ecosystem__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  gap: 16px;
  flex-wrap: wrap;
}
.sq-ecosystem__head h2 { font-size: 22px; margin: 0; font-weight: 400; }
.sq-ecosystem__flows {
  display: flex;
  gap: 8px;
  align-items: stretch;
  flex-wrap: wrap;
}
.sq-ecosystem__flow {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 1 1 auto;
  min-width: 240px;
  padding: 14px 16px;
  border: 1px solid var(--sq-line);
  border-radius: 12px;
  background: var(--sq-surface-2);
}
.sq-ecosystem__node {
  font-size: 15px;
  color: var(--sq-text);
  white-space: nowrap;
  padding: 4px 10px;
  border: 1px solid var(--sq-line-accent);
  border-radius: 8px;
  background: rgba(139,92,246,.08);
}
.sq-ecosystem__arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  gap: 2px;
  padding: 0 8px;
  position: relative;
}
.sq-ecosystem__arrow-line {
  display: block;
  height: 1px;
  width: 100%;
  background: var(--sq-line-2);
}
.sq-ecosystem__arrow-label {
  font-size: 10px;
  color: var(--sq-mute);
  letter-spacing: .8px;
  text-transform: uppercase;
  white-space: nowrap;
}
.sq-ecosystem__arrow-head {
  font-size: 18px;
  color: var(--sq-electric);
  line-height: 1;
  margin-top: -2px;
}
`;
