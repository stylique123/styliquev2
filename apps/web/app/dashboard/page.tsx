"use client";

// /dashboard — Brand admin overview.
// Reads token from localStorage/cookie, fetches overview from Shopify app,
// and renders a clean editorial dark dashboard.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SHOPIFY_APP_URL } from "../lib/config";

const TOKEN_KEY = "sq_dashboard_token";
const SHOP_KEY = "sq_dashboard_shop";

// ─── Types ────────────────────────────────────────────────────────────────

interface HeadlineKpis {
  chatSessions: number;
  chatTurns: number;
  combosProposed: number;
  cartConfirmed: number;
  tryOnSessions: number;
  fitSubmitted: number;
  signupsClaimed: number;
  windowDays: number;
}

interface OverviewData {
  shopDomain: string;
  plan: {
    tier: string;
    analyticsLevel: string;
    usage: Record<string, { used: number; cap: number | null; remaining: number | null }>;
  };
  headline: HeadlineKpis;
  assistedRevenue: {
    formatted: string;
    orderCount: number;
  };
}

// ─── Learning-loop types (the moat — see /api/mira/insights) ────────────────

interface CatalogGap {
  category: string;
  count: number;
  intensity: number;
  reason: string;
  examples: string[];
  lastAsked: string;
}
interface NearMiss {
  category: string;
  attribute: string;
  count: number;
  intensity: number;
  reason: string;
  examples: string[];
  lastAsked: string;
}
interface IntentCount {
  intent: string;
  count: number;
}
interface InsightSummary {
  totalConversations: number;
  metCount: number;
  unmetCount: number;
  discoveryHitRate: number;
  surfacedCount: number;
  convertedCount: number;
  conversionRate: number;
  catalogGaps: CatalogGap[];
  nearMisses: NearMiss[];
  topIntents: IntentCount[];
  recentUnmet: { query: string; reason: string; ts: string }[];
  generatedAt: string;
}

// ─── Try-on render-health types (the second loop — see /api/tryon/insights) ──

interface ErrorClass {
  errorCode: string;
  count: number;
  intensity: number;
  remediation: string | null;
  lastSeen: string;
  examples: { handle: string | null; mode: string; ts: string }[];
}
interface RecentFailure {
  ts: string;
  mode: string;
  errorCode: string;
  handle: string | null;
  remediation: string | null;
}
interface TryonInsightSummary {
  totalRenders: number;
  okCount: number;
  errorCount: number;
  errorRate: number;
  cacheHitRate: number;
  liveRenders: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  byMode: { mode: string; total: number; errors: number }[];
  errorClasses: ErrorClass[];
  recentFailures: RecentFailure[];
  topRemediation: string | null;
  generatedAt: string;
}

// ─── Fashion-intelligence types (see /api/mira/intelligence) ────────────────

type Trend = "up" | "down" | "flat";
interface ColorRow {
  color: string;
  hex: string;
  tried: number;
  purchased: number;
  abandoned: number;
  saved: number;
  convertRate: number;
  signal: "converter" | "curiosity" | "steady" | "sleeper";
}
interface StyleShare { style: string; share: number; trend: Trend; deltaPct: number }
interface SizeShare { size: string; share: number }
interface FitShare { pref: string; share: number }
interface OccasionShare { occasion: string; share: number; trend: Trend; deltaPct: number }
interface ComboRow { label: string; pieces: string[]; count: number; aov: number }
interface ConsumerIntel {
  styleMap: StyleShare[];
  colors: ColorRow[];
  topSizes: SizeShare[];
  fitPrefs: FitShare[];
  bodyInsight: string;
  occasions: OccasionShare[];
  combos: ComboRow[];
}
interface DropOffStage { stage: string; lossPct: number }
interface ConversionIntel {
  tryOnPurchaseRate: number;
  baselinePurchaseRate: number;
  tryOnLiftX: number;
  bundleIntentRate?: number;
  aiSuggestedCartRate?: number;
  bundlePurchaseRate: number;
  aiSuggestedAddRate: number;
  confidenceScore: number;
  confidenceDrivers: { label: string; weight: number }[];
  dropOff: DropOffStage[];
  fullLookMultiplier: number;
  stylistSpendLift: number;
}
interface FitProductRow { handle: string; name: string; confusion: number; note: string }
interface FitIntel {
  sizeConfidence: number;
  returnRiskScore: number;
  returnRiskLevel: "low" | "moderate" | "elevated";
  topReturnDriver: string;
  productFit: FitProductRow[];
  bestAudience: string;
}
interface StyledRow { handle: string; name: string; styledRank: number; soldRank: number; gap: number }
interface CompatRow { pair: [string, string]; score: number; lift: number }
interface CollectionPerf { collection: string; share: number; topAge: string; topOccasion: string; topStyle: string }
interface TrendRow { label: string; direction: Trend; deltaPct: number; kind: "color" | "cut" | "fit" | "material" }
interface StyleIntel {
  mostStyledNotSold: StyledRow[];
  compatibility: CompatRow[];
  collections: CollectionPerf[];
  emergingTrends: TrendRow[];
}
interface ExecCard {
  label: string;
  value: string;
  sub: string;
  source?: "measured" | "mixed" | "modelled" | "insufficient_data";
  sourceDetail?: string;
  trend?: Trend;
  deltaPct?: number;
  tone: "loved" | "growing" | "converting" | "watch";
}
interface FashionIntelligence {
  generatedAt: string;
  dataMode: "live+modelled" | "modelled";
  realSignalCount: number;
  exec: ExecCard[];
  consumer: ConsumerIntel;
  conversion: ConversionIntel;
  fit: FitIntel;
  style: StyleIntel;
  learning: InsightSummary;
}

const INTENT_LABELS: Record<string, string> = {
  discover: "Open discovery",
  occasion: "Dressing for an occasion",
  specific: "A specific piece",
  size: "Sizing & fit",
  fabric: "Fabric & care",
  price: "Price / budget",
  look: "Complete the look",
  try_on: "See it on",
  support: "Returns & support",
  greeting: "Saying hello",
  other: "Other",
};

// ─── Format helpers ───────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent = "electric",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "electric" | "pink";
}) {
  return (
    <div
      style={{
        background: "#161616",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 3,
        padding: "28px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "var(--mute)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--serif)",
          fontSize: 40,
          fontStyle: "italic",
          lineHeight: 1,
          color: accent === "electric" ? "var(--electric)" : "var(--pink)",
        }}
      >
        {value}
      </span>
      {sub && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--mute)",
            letterSpacing: "0.2em",
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

function ModuleCard({
  tag,
  name,
  kpis,
  accent,
  linkHref,
  linkLabel,
}: {
  tag: string;
  name: string;
  kpis: Array<{ label: string; value: string }>;
  accent: "electric" | "pink";
  linkHref?: string;
  linkLabel?: string;
}) {
  const accentColor = accent === "electric" ? "var(--electric)" : "var(--pink)";
  return (
    <div
      style={{
        background: "#161616",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 3,
        padding: "32px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: accentColor,
          }}
        >
          {tag}
        </span>
        <h3
          style={{
            fontFamily: "var(--serif)",
            fontSize: 26,
            fontStyle: "italic",
            fontWeight: 400,
            margin: "8px 0 0",
          }}
        >
          {name}
        </h3>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 1,
          background: "rgba(255,255,255,0.05)",
        }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{
              background: "#1A1A1A",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span
              style={{
                fontFamily: "var(--serif)",
                fontSize: 28,
                fontStyle: "italic",
                color: accentColor,
                lineHeight: 1,
              }}
            >
              {k.value}
            </span>
            <span
              style={{
                fontFamily: "var(--sans)",
                fontSize: 12,
                color: "var(--mute)",
              }}
            >
              {k.label}
            </span>
          </div>
        ))}
      </div>
      {linkHref && (
        <Link
          href={linkHref}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "var(--mute)",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            paddingBottom: 4,
            alignSelf: "flex-start",
          }}
        >
          {linkLabel ?? "View details →"}
        </Link>
      )}
    </div>
  );
}

// ─── Fashion-intelligence UI primitives ────────────────────────────────────

const TONE_COLOR: Record<ExecCard["tone"], string> = {
  loved: "var(--pink)",
  growing: "var(--electric)",
  converting: "#7FE3C0",
  watch: "#E8A86B",
};
const SOURCE_LABEL: Record<NonNullable<ExecCard["source"]>, string> = {
  measured: "Measured",
  mixed: "Measured + modelled",
  modelled: "Modelled",
  insufficient_data: "Collecting",
};
const SIGNAL_LABEL: Record<ColorRow["signal"], string> = {
  converter: "converts",
  curiosity: "curiosity",
  steady: "steady",
  sleeper: "sleeper",
};
const SIGNAL_COLOR: Record<ColorRow["signal"], string> = {
  converter: "#7FE3C0",
  curiosity: "#E8A86B",
  steady: "var(--electric)",
  sleeper: "var(--mute)",
};

function TrendArrow({ trend, deltaPct }: { trend: Trend; deltaPct?: number }) {
  const glyph = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const color = trend === "up" ? "#7FE3C0" : trend === "down" ? "#E89090" : "var(--mute)";
  return (
    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
      {glyph}
      {typeof deltaPct === "number" ? ` ${deltaPct > 0 ? "+" : ""}${deltaPct}%` : ""}
    </span>
  );
}

function IntelPanel({
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
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: accent }}>
          {tag}
        </span>
        <h3 style={{ fontFamily: "var(--serif)", fontSize: 24, fontStyle: "italic", fontWeight: 400, margin: "8px 0 0" }}>{title}</h3>
        {blurb && (
          <p style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--mute)", margin: "8px 0 0", lineHeight: 1.55 }}>{blurb}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// One labelled horizontal share bar (style map, sizes, fit prefs, occasions).
function ShareBar({ label, share, color, trend, deltaPct }: { label: string; share: number; color: string; trend?: Trend; deltaPct?: number }) {
  // `share` is a 0–1 ratio. Render as a whole-number percentage.
  const pct = Math.round(share * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--text)", textTransform: "capitalize" }}>{label}</span>
        <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          {trend && <TrendArrow trend={trend} deltaPct={deltaPct} />}
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--mute)" }}>{pct}%</span>
        </span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

// ─── Fashion Intelligence — the four pillars ────────────────────────────────
// Consumer · Conversion · Fit & Confidence · Style & Merchandising. Every
// number names a merchandising or marketing decision (CLAUDE.md §11). Reads
// same-origin from /api/mira/intelligence, live. Distributions are grounded in
// the real catalog + real learning-loop signals; modelled where signal is thin
// (dataMode tells the brand which) — never faked as observed when it isn't.

function FashionIntelligenceSection() {
  const [fi, setFi] = useState<FashionIntelligence | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    async function go() {
      try {
        const res = await fetch("/api/mira/intelligence", { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as FashionIntelligence;
        if (alive) setFi(json);
      } catch {
        if (alive) setFi(null);
      } finally {
        if (alive) setLoaded(true);
      }
    }
    void go();
    return () => {
      alive = false;
    };
  }, []);

  if (loaded && !fi) return null;

  const c = fi?.consumer;
  const cv = fi?.conversion;
  const ft = fi?.fit;
  const st = fi?.style;
  const maxColorTried = c ? c.colors.reduce((m, x) => Math.max(m, x.tried), 1) : 1;
  const maxColorBought = c ? c.colors.reduce((m, x) => Math.max(m, x.purchased), 1) : 1;
  const maxStyled = st ? st.mostStyledNotSold.reduce((m, x) => Math.max(m, x.gap), 1) : 1;

  const panelStack: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };

  return (
    <div style={{ marginBottom: 56 }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.4em", textTransform: "uppercase", color: "var(--pink)" }}>
          Fashion intelligence
        </span>
        {fi && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", letterSpacing: "0.15em" }}>
            {fi.dataMode === "live+modelled"
              ? `${fmt(fi.realSignalCount)} live signals + modelled`
              : "modelled · awaiting live signals"}
          </span>
        )}
      </div>
      <h2 style={{ fontFamily: "var(--serif)", fontSize: 30, fontStyle: "italic", fontWeight: 400, margin: "0 0 8px" }}>
        Who&rsquo;s shopping, and what converts.
      </h2>
      <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--mute)", margin: "0 0 28px", maxWidth: 620, lineHeight: 1.6 }}>
        Four pillars from every Mira conversation and try-on: who your shoppers are, what turns into
        revenue, where fit confidence breaks, and which pieces are quietly winning.
      </p>

      {!fi && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 3, height: 120 }} />
          ))}
        </div>
      )}

      {fi && (
        <>
          {/* Executive summary cards — the at-a-glance hero row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
            {fi.exec.map((e) => {
              const col = TONE_COLOR[e.tone];
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
                  <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--mute)" }}>
                    {e.label}
                  </span>
                  {e.source && (
                    <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: e.source === "measured" ? "#7FE3C0" : "#E8A86B" }}>
                      {SOURCE_LABEL[e.source]}
                    </span>
                  )}
                  <span style={{ fontFamily: "var(--serif)", fontSize: 26, fontStyle: "italic", lineHeight: 1.1, color: col }}>{e.value}</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--mute)", lineHeight: 1.4 }}>{e.sub}</span>
                    {e.trend && <TrendArrow trend={e.trend} deltaPct={e.deltaPct} />}
                  </div>
                  {e.sourceDetail && (
                    <span style={{ fontFamily: "var(--sans)", fontSize: 10.5, color: "var(--mute)", lineHeight: 1.45 }}>{e.sourceDetail}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Two-column: left overview rail · right detailed pillars */}
          <div className="sq-intel-grid">
            {/* ── LEFT RAIL — overview ─────────────────────────────── */}
            <div style={panelStack}>
              {c && (
                <IntelPanel tag="Overview" title="Style registers" accent="var(--electric)" blurb="The aesthetic your shoppers actually gravitate to.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {c.styleMap.slice(0, 6).map((s) => (
                      <ShareBar key={s.style} label={s.style} share={s.share} color="var(--electric)" trend={s.trend} deltaPct={s.deltaPct} />
                    ))}
                  </div>
                </IntelPanel>
              )}
              {cv && (
                <IntelPanel tag="Overview" title="Conversion snapshot" accent="#7FE3C0" blurb="The money: try-on lifts purchase the most.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
                      <div>
                        <div style={{ fontFamily: "var(--serif)", fontSize: 40, fontStyle: "italic", lineHeight: 1, color: "#7FE3C0" }}>
                          {Math.round(cv.tryOnPurchaseRate * 100)}%
                        </div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", letterSpacing: "0.15em", marginTop: 6 }}>WITH TRY-ON</div>
                      </div>
                      <div style={{ paddingBottom: 4 }}>
                        <div style={{ fontFamily: "var(--serif)", fontSize: 24, fontStyle: "italic", lineHeight: 1, color: "var(--mute)" }}>
                          {Math.round(cv.baselinePurchaseRate * 100)}%
                        </div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", letterSpacing: "0.15em", marginTop: 6 }}>WITHOUT</div>
                      </div>
                      <div style={{ marginLeft: "auto", textAlign: "right" }}>
                        <div style={{ fontFamily: "var(--serif)", fontSize: 28, fontStyle: "italic", color: "var(--pink)", lineHeight: 1 }}>
                          {cv.tryOnLiftX.toFixed(1)}×
                        </div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--mute)", letterSpacing: "0.12em", marginTop: 6 }}>LIFT</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
                      <Row k="Asked for a recommended bundle" v={`${Math.round((cv.bundleIntentRate ?? cv.bundlePurchaseRate) * 100)}%`} />
                      <Row k="Added an AI-suggested item" v={`${Math.round((cv.aiSuggestedCartRate ?? cv.aiSuggestedAddRate) * 100)}%`} />
                      <Row k="Full-look bundles convert" v={`${cv.fullLookMultiplier.toFixed(1)}× better`} />
                      <Row k="Stylist users spend" v={`+${Math.round(cv.stylistSpendLift * 100)}%`} />
                    </div>
                  </div>
                </IntelPanel>
              )}
            </div>

            {/* ── MAIN — detailed pillars ───────────────────────────── */}
            <div style={panelStack}>
              {/* PILLAR 1 — Consumer intelligence: colour heat-map */}
              {c && (
                <IntelPanel
                  tag="Pillar 01 · Consumer"
                  title="Colour: curiosity vs. conversion"
                  accent="var(--electric)"
                  blurb="What gets tried (the left bar) isn't always what sells (the right). Separate the show-stoppers from the close-rate."
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                    {c.colors.slice(0, 9).map((col) => (
                      <div key={col.color} style={{ background: "#1A1A1A", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ width: 16, height: 16, borderRadius: "50%", background: col.hex, border: "1px solid rgba(255,255,255,0.18)", flexShrink: 0 }} />
                        <span style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--text)", textTransform: "capitalize", width: 92, flexShrink: 0 }}>{col.color}</span>
                        {/* tried bar */}
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                            <div style={{ width: `${Math.round((col.tried / maxColorTried) * 100)}%`, height: "100%", background: "var(--electric)", borderRadius: 3 }} />
                          </div>
                          <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                            <div style={{ width: `${Math.round((col.purchased / maxColorBought) * 100)}%`, height: "100%", background: "var(--pink)", borderRadius: 3 }} />
                          </div>
                        </div>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mute)", width: 38, textAlign: "right", flexShrink: 0 }}>
                          {Math.round(col.convertRate * 100)}%
                        </span>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: SIGNAL_COLOR[col.signal], width: 64, textAlign: "right", flexShrink: 0 }}>
                          {SIGNAL_LABEL[col.signal]}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 16, fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--mute)" }}>
                    <span><span style={{ color: "var(--electric)" }}>▬</span> tried</span>
                    <span><span style={{ color: "var(--pink)" }}>▬</span> purchased</span>
                    <span>% = converts of tried</span>
                  </div>
                </IntelPanel>
              )}

              {/* PILLAR 1 — sizing + fit + occasion + combos */}
              {c && (
                <div className="sq-intel-pair">
                  <IntelPanel tag="Consumer" title="Sizing & fit" accent="var(--electric)">
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {c.topSizes.slice(0, 5).map((s) => (
                        <ShareBar key={s.size} label={s.size} share={s.share} color="var(--electric)" />
                      ))}
                    </div>
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      {c.fitPrefs.slice(0, 3).map((f) => (
                        <ShareBar key={f.pref} label={f.pref} share={f.share} color="var(--pink)" />
                      ))}
                    </div>
                    <p style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--text)", fontStyle: "italic", margin: 0, lineHeight: 1.5, borderLeft: "2px solid var(--pink)", paddingLeft: 12 }}>
                      {c.bodyInsight}
                    </p>
                  </IntelPanel>
                  <IntelPanel tag="Consumer" title="The why — occasions" accent="var(--electric)">
                    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                      {c.occasions.slice(0, 6).map((o) => (
                        <ShareBar key={o.occasion} label={o.occasion} share={o.share} color="var(--electric)" trend={o.trend} deltaPct={o.deltaPct} />
                      ))}
                    </div>
                  </IntelPanel>
                </div>
              )}

              {c && c.combos.length > 0 && (
                <IntelPanel tag="Consumer" title="What they combine" accent="var(--electric)" blurb="The pairings shoppers build into a look — your natural bundle candidates.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                    {c.combos.slice(0, 5).map((cb) => (
                      <div key={cb.label} style={{ background: "#1A1A1A", padding: "13px 15px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--text)" }}>{cb.pieces.join("  +  ")}</span>
                        <span style={{ display: "flex", gap: 14, alignItems: "baseline", flexShrink: 0 }}>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mute)" }}>{cb.count}×</span>
                          <span style={{ fontFamily: "var(--serif)", fontSize: 16, fontStyle: "italic", color: "var(--pink)" }}>${fmt(cb.aov)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </IntelPanel>
              )}

              {/* PILLAR 2 — Conversion: confidence + drop-off */}
              {cv && (
                <div className="sq-intel-pair">
                  <IntelPanel tag="Pillar 02 · Conversion" title="Buying confidence" accent="#7FE3C0" blurb="A composite of try-on, size-acceptance and recommendation-follow signals.">
                    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                      <div style={{ fontFamily: "var(--serif)", fontSize: 52, fontStyle: "italic", lineHeight: 1, color: "#7FE3C0" }}>{cv.confidenceScore}</div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", letterSpacing: "0.15em", lineHeight: 1.5 }}>/ 100<br />SHOPPER<br />CONFIDENCE</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 9, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
                      {cv.confidenceDrivers.map((d) => (
                        <ShareBar key={d.label} label={d.label} share={d.weight} color="#7FE3C0" />
                      ))}
                    </div>
                  </IntelPanel>
                  <IntelPanel tag="Conversion" title="Where they drop off" accent="#E8A86B" blurb="The friction points to fix first.">
                    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                      {cv.dropOff.map((d) => (
                        <ShareBar key={d.stage} label={d.stage} share={d.lossPct} color="#E8A86B" />
                      ))}
                    </div>
                  </IntelPanel>
                </div>
              )}

              {/* PILLAR 3 — Fit & confidence: return-risk weapon */}
              {ft && (
                <IntelPanel
                  tag="Pillar 03 · Fit & confidence"
                  title="The return-reduction weapon"
                  accent="#7FE3C0"
                  blurb="Size confidence and the products causing fit hesitation — the leading indicator of returns."
                >
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <MiniStat label="Size confidence" value={`${ft.sizeConfidence}%`} sub="accept the recommendation" accent="#7FE3C0" />
                    <MiniStat
                      label="Return risk"
                      value={`${ft.returnRiskScore}`}
                      sub={`${ft.returnRiskLevel} · /100`}
                      accent={ft.returnRiskLevel === "low" ? "#7FE3C0" : ft.returnRiskLevel === "moderate" ? "#E8A86B" : "#E89090"}
                    />
                  </div>
                  <p style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--text)", fontStyle: "italic", margin: 0, lineHeight: 1.5, borderLeft: "2px solid #E8A86B", paddingLeft: 12 }}>
                    Top driver: {ft.topReturnDriver}
                  </p>
                  <div>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--mute)" }}>Fit confusion by product</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                      {ft.productFit.slice(0, 5).map((p) => (
                        <div key={p.handle} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--text)", width: 130, flexShrink: 0 }}>{p.name}</span>
                          <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                            <div style={{ width: `${Math.round(p.confusion * 100)}%`, height: "100%", background: p.confusion > 0.5 ? "#E89090" : p.confusion > 0.3 ? "#E8A86B" : "#7FE3C0", borderRadius: 3 }} />
                          </div>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--mute)", width: 36, textAlign: "right", flexShrink: 0 }}>{Math.round(p.confusion * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--mute)", margin: 0 }}>Best-fitting audience: <span style={{ color: "var(--text)" }}>{ft.bestAudience}</span></p>
                </IntelPanel>
              )}

              {/* PILLAR 4 — Style & merchandising */}
              {st && (
                <div className="sq-intel-pair">
                  <IntelPanel tag="Pillar 04 · Merchandising" title="Most styled, not yet sold" accent="var(--pink)" blurb="High styling interest, low sales rank — tomorrow's winners to protect in stock.">
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {st.mostStyledNotSold.slice(0, 5).map((s) => (
                        <div key={s.handle} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--text)", flex: 1, minWidth: 0 }}>{s.name}</span>
                          <div style={{ width: 90, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, flexShrink: 0 }}>
                            <div style={{ width: `${Math.round((s.gap / maxStyled) * 100)}%`, height: "100%", background: "var(--pink)", borderRadius: 3 }} />
                          </div>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", whiteSpace: "nowrap", flexShrink: 0 }}>+{s.gap}</span>
                        </div>
                      ))}
                    </div>
                  </IntelPanel>
                  <IntelPanel tag="Merchandising" title="Emerging trends" accent="var(--pink)" blurb="Direction of travel across colour, cut, fit and material.">
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                      {st.emergingTrends.slice(0, 7).map((t) => (
                        <div key={t.label} style={{ background: "#1A1A1A", padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--text)" }}>{t.label}</span>
                          <TrendArrow trend={t.direction} deltaPct={t.deltaPct} />
                        </div>
                      ))}
                    </div>
                  </IntelPanel>
                </div>
              )}

              {st && st.compatibility.length > 0 && (
                <IntelPanel tag="Merchandising" title="Outfit compatibility" accent="var(--pink)" blurb="The pairings that lift basket size when shown together.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                    {st.compatibility.slice(0, 5).map((p) => (
                      <div key={p.pair.join("|")} style={{ background: "#1A1A1A", padding: "12px 15px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--text)" }}>{p.pair[0]}  +  {p.pair[1]}</span>
                        <span style={{ display: "flex", gap: 14, alignItems: "baseline", flexShrink: 0 }}>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--mute)" }}>{Math.round(p.score * 100)}% match</span>
                          <span style={{ fontFamily: "var(--serif)", fontSize: 16, fontStyle: "italic", color: "#7FE3C0" }}>+{Math.round(p.lift * 100)}% AOV</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </IntelPanel>
              )}

              {st && st.collections.length > 0 && (
                <IntelPanel tag="Merchandising" title="Collections by audience" accent="var(--pink)">
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "rgba(255,255,255,0.05)" }}>
                    {st.collections.slice(0, 5).map((cl) => (
                      <div key={cl.collection} style={{ background: "#1A1A1A", padding: "13px 15px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--text)" }}>{cl.collection}</div>
                          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", letterSpacing: "0.08em", marginTop: 4 }}>
                            {cl.topAge} · {cl.topOccasion} · {cl.topStyle}
                          </div>
                        </div>
                        <span style={{ fontFamily: "var(--serif)", fontSize: 20, fontStyle: "italic", color: "var(--electric)", flexShrink: 0 }}>{Math.round(cl.share * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </IntelPanel>
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
        </>
      )}
    </div>
  );
}

// Small key/value row used in the conversion snapshot.
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--mute)" }}>{k}</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--text)", whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}

// Compact stat block for the fit pillar.
function MiniStat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{ flex: "1 1 130px", background: "#1A1A1A", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 3, padding: "16px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "var(--mute)" }}>{label}</span>
      <span style={{ fontFamily: "var(--serif)", fontSize: 30, fontStyle: "italic", lineHeight: 1, color: accent }}>{value}</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", letterSpacing: "0.1em", textTransform: "capitalize" }}>{sub}</span>
    </div>
  );
}

// The learning loop — the moat, made visible ────────────────────────────────
// This is what the brand is actually paying for: every Mira conversation
// surfaces what shoppers want that the store can't serve yet (catalog gaps →
// reorder/stock/price decisions), what they come to Mira for (intents), and
// how often discovery actually lands (hit-rate). Each block names the decision
// it informs (CLAUDE.md §11). Reads same-origin from /api/mira/insights, live.

function LearningLoopSection() {
  const [ins, setIns] = useState<InsightSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    async function go() {
      try {
        const res = await fetch("/api/mira/insights", { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as InsightSummary;
        if (alive) setIns(json);
      } catch {
        if (alive) setIns(null);
      } finally {
        if (alive) setLoaded(true);
      }
    }
    void go();
    return () => {
      alive = false;
    };
  }, []);

  const hitPct = ins ? Math.round(ins.discoveryHitRate * 100) : 0;
  const convPct = ins ? Math.round(ins.conversionRate * 100) : 0;
  const maxIntent = ins?.topIntents.reduce((m, i) => Math.max(m, i.count), 0) ?? 0;
  const maxGapIntensity = ins?.catalogGaps.reduce((m, g) => Math.max(m, g.intensity), 0) ?? 0;
  const empty = loaded && (!ins || ins.totalConversations === 0);

  return (
    <div style={{ marginBottom: 48 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6 }}>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: "var(--electric)",
          }}
        >
          The learning loop
        </span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", letterSpacing: "0.15em" }}>
          live from Mira conversations
        </span>
      </div>
      <h2
        style={{
          fontFamily: "var(--serif)",
          fontSize: 30,
          fontStyle: "italic",
          fontWeight: 400,
          margin: "0 0 8px",
        }}
      >
        What your shoppers are asking for.
      </h2>
      <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--mute)", margin: "0 0 28px", maxWidth: 560, lineHeight: 1.6 }}>
        Every conversation teaches the store. Below is the demand Mira couldn&rsquo;t serve from your
        current catalog — the clearest signal of what to stock next.
      </p>

      {empty && (
        <div
          style={{
            background: "#161616",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 3,
            padding: "40px 28px",
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--mute)",
          }}
        >
          No conversations yet. Open the{" "}
          <Link href="/demo" style={{ color: "var(--electric)", borderBottom: "1px solid rgba(139,92,246,0.4)" }}>
            demo store
          </Link>{" "}
          and talk to Mira — every message you send shows up here as a learning signal.
        </div>
      )}

      {ins && ins.totalConversations > 0 && (
        <>
          {/* Three headline learning numbers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 28,
            }}
          >
            <KpiCard label="Conversations learned from" value={fmt(ins.totalConversations)} sub="shopper turns" accent="electric" />
            <KpiCard label="Discovery hit-rate" value={`${hitPct}%`} sub="demand we could serve" accent="pink" />
            <KpiCard
              label="Recommendation → bag"
              value={ins.surfacedCount > 0 ? `${convPct}%` : "—"}
              sub={`${fmt(ins.convertedCount)} of ${fmt(ins.surfacedCount)} surfaced`}
              accent="pink"
            />
            <KpiCard label="Unmet requests" value={fmt(ins.unmetCount)} sub="catalog gaps to act on" accent="electric" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            {/* Catalog gaps — ranked, the reorder decision */}
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(232,121,200,0.2)",
                borderRadius: 3,
                padding: "28px 26px",
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--pink)" }}>
                Catalog gaps → what to stock next
              </span>
              <span style={{ display: "block", fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--mute)", marginTop: 6, fontStyle: "italic" }}>
                Ranked by demand intensity — recent asks weigh more than old ones.
              </span>
              {ins.catalogGaps.length === 0 ? (
                <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--mute)", margin: "18px 0 0" }}>
                  No gaps yet — Mira served every request from your catalog. 🎯
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 18, background: "rgba(255,255,255,0.05)" }}>
                  {ins.catalogGaps.slice(0, 8).map((g) => (
                    <div key={g.category} style={{ background: "#1A1A1A", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontFamily: "var(--sans)", fontSize: 15, color: "var(--text)", textTransform: "capitalize" }}>
                          {g.category}
                        </span>
                        <span style={{ fontFamily: "var(--serif)", fontSize: 22, fontStyle: "italic", color: "var(--pink)", lineHeight: 1, whiteSpace: "nowrap" }}>
                          {g.count}×
                        </span>
                      </div>
                      <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--mute)", lineHeight: 1.5 }}>
                        {g.reason}
                      </span>
                      {g.examples.length > 0 && (
                        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
                          &ldquo;{g.examples[0]}&rdquo;
                          {g.examples.length > 1 ? ` +${g.examples.length - 1} more` : ""}
                        </span>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${maxGapIntensity ? Math.max(8, (g.intensity / maxGapIntensity) * 100) : 0}%`,
                              background: "linear-gradient(90deg,#EC4899,#8B5CF6)",
                              borderRadius: 2,
                            }}
                          />
                        </div>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
                          {g.intensity >= maxGapIntensity && maxGapIntensity > 0 ? "hot now · " : ""}
                          {timeAgo(g.lastAsked)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Intent histogram — what shoppers come to Mira for */}
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 3,
                padding: "28px 26px",
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--electric)" }}>
                What shoppers come to Mira for
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>
                {ins.topIntents.slice(0, 7).map((i) => (
                  <div key={i.intent} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--sans)", fontSize: 13, color: "var(--text)" }}>
                      <span>{INTENT_LABELS[i.intent] ?? i.intent}</span>
                      <span style={{ color: "var(--mute)", fontFamily: "var(--mono)", fontSize: 12 }}>{i.count}</span>
                    </div>
                    <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${maxIntent ? Math.max(6, (i.count / maxIntent) * 100) : 0}%`,
                          background: "var(--grad, linear-gradient(90deg,#8B5CF6,#EC4899))",
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Near-misses — "almost had it", the sharpest reorder hints */}
          {ins.nearMisses.length > 0 && (
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(139,92,246,0.22)",
                borderRadius: 3,
                padding: "28px 26px",
                marginTop: 12,
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--electric)" }}>
                Almost had it → one attribute from a sale
              </span>
              <span style={{ display: "block", fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--mute)", marginTop: 6, fontStyle: "italic" }}>
                You stock the category but not the exact cut/colour they wanted. The cheapest gap to close.
              </span>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 1,
                  marginTop: 18,
                  background: "rgba(255,255,255,0.05)",
                }}
              >
                {ins.nearMisses.slice(0, 6).map((n) => (
                  <div key={`${n.category}-${n.attribute}`} style={{ background: "#1A1A1A", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontFamily: "var(--sans)", fontSize: 14.5, color: "var(--text)" }}>
                        <span style={{ textTransform: "capitalize" }}>{n.category}</span>
                        <span style={{ color: "var(--mute)" }}> · missing </span>
                        <span style={{ color: "var(--electric)", fontStyle: "italic" }}>{n.attribute}</span>
                      </span>
                      <span style={{ fontFamily: "var(--serif)", fontSize: 20, fontStyle: "italic", color: "var(--electric)", lineHeight: 1, whiteSpace: "nowrap" }}>
                        {n.count}×
                      </span>
                    </div>
                    <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--mute)", lineHeight: 1.5 }}>
                      {n.reason}
                    </span>
                    {n.examples.length > 0 && (
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
                        &ldquo;{n.examples[0]}&rdquo;
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent unmet feed — the raw demand, verbatim */}
          {ins.recentUnmet.length > 0 && (
            <div
              style={{
                background: "#141414",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 3,
                padding: "22px 26px",
                marginTop: 12,
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--mute)" }}>
                Recent requests we couldn&rsquo;t fill
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                {ins.recentUnmet.slice(0, 6).map((u, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontFamily: "var(--serif)", fontSize: 15, fontStyle: "italic", color: "var(--text)", flex: 1 }}>
                      &ldquo;{u.query}&rdquo;
                    </span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
                      {timeAgo(u.ts)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── The second loop — try-on render health, made fixable ──────────────────
// The founder asked: "Keep logs of this … I should be able to see even in
// dashboard … this should be also a loop and some error comes. We should be
// able to fix it … automatically learn from this." This block IS that loop:
// it reads /api/tryon/insights live, ranks the failure classes by recency-
// weighted intensity (so the thing breaking RIGHT NOW floats to the top), and
// prints the concrete remediation for each — the self-healing hint. Cache-hit
// rate + latency name the cost/perf decision; error-rate names the trust one.

const ERR_LABELS: Record<string, string> = {
  no_api_key: "Missing API key",
  render_failed: "Model error / rejection",
  render_no_image: "No image returned",
  no_garment: "No garment image",
  invalid_asset: "Blocked asset path",
  rate_limited: "Rate limited",
  invalid_input: "Malformed request",
  muse_args: "Muse args missing",
  ok: "OK",
};

function TryonHealthSection() {
  const [ins, setIns] = useState<TryonInsightSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    async function go() {
      try {
        const res = await fetch("/api/tryon/insights", { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as TryonInsightSummary;
        if (alive) setIns(json);
      } catch {
        if (alive) setIns(null);
      } finally {
        if (alive) setLoaded(true);
      }
    }
    void go();
    return () => {
      alive = false;
    };
  }, []);

  const errPct = ins ? Math.round(ins.errorRate * 1000) / 10 : 0;
  const cachePct = ins ? Math.round(ins.cacheHitRate * 1000) / 10 : 0;
  const maxIntensity = ins?.errorClasses.reduce((m, e) => Math.max(m, e.intensity), 0) ?? 0;
  const empty = loaded && (!ins || ins.totalRenders === 0);

  return (
    <div style={{ marginBottom: 48 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6 }}>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: "var(--pink)",
          }}
        >
          Try-on render health
        </span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", letterSpacing: "0.15em" }}>
          live from the render pipeline
        </span>
      </div>
      <h2
        style={{
          fontFamily: "var(--serif)",
          fontSize: 30,
          fontStyle: "italic",
          fontWeight: 400,
          margin: "0 0 8px",
        }}
      >
        When a render breaks, here&rsquo;s how to fix it.
      </h2>
      <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--mute)", margin: "0 0 28px", maxWidth: 560, lineHeight: 1.6 }}>
        Every try-on attempt is logged. The failure classes below are ranked by how hot they are right
        now — the top one carries the concrete fix to apply first.
      </p>

      {empty && (
        <div
          style={{
            background: "#161616",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 3,
            padding: "40px 28px",
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--mute)",
          }}
        >
          No renders yet. Open the{" "}
          <Link href="/demo" style={{ color: "var(--pink)", borderBottom: "1px solid rgba(236,72,153,0.4)" }}>
            demo store
          </Link>{" "}
          and try a garment on a muse — every render shows up here with its latency, cache status, and on
          failure, the fix.
        </div>
      )}

      {ins && ins.totalRenders > 0 && (
        <>
          {/* Four headline health numbers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 28,
            }}
          >
            <KpiCard label="Total renders" value={fmt(ins.totalRenders)} sub={`${fmt(ins.liveRenders)} live · rest cached`} accent="electric" />
            <KpiCard label="Error rate" value={`${errPct}%`} sub={`${fmt(ins.errorCount)} failed of ${fmt(ins.totalRenders)}`} accent="pink" />
            <KpiCard label="Cache-hit rate" value={`${cachePct}%`} sub="provider calls avoided" accent="electric" />
            <KpiCard
              label="Median latency"
              value={ins.p50LatencyMs != null ? `${(ins.p50LatencyMs / 1000).toFixed(1)}s` : "—"}
              sub={ins.p95LatencyMs != null ? `p95 ${(ins.p95LatencyMs / 1000).toFixed(1)}s` : "live renders"}
              accent="pink"
            />
          </div>

          {/* Top remediation banner — the single highest-priority fix right now */}
          {ins.topRemediation && (
            <div
              style={{
                background: "linear-gradient(90deg,rgba(236,72,153,0.08),rgba(139,92,246,0.05))",
                border: "1px solid rgba(236,72,153,0.25)",
                borderRadius: 3,
                padding: "18px 22px",
                marginBottom: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--pink)" }}>
                Fix this first
              </span>
              <span style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--text)", lineHeight: 1.6 }}>
                {ins.topRemediation}
              </span>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            {/* Error classes — ranked by recency-weighted intensity, each with its fix */}
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(236,72,153,0.2)",
                borderRadius: 3,
                padding: "28px 26px",
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--pink)" }}>
                Failure classes → the fix to apply
              </span>
              <span style={{ display: "block", fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--mute)", marginTop: 6, fontStyle: "italic" }}>
                Ranked by demand intensity — what&rsquo;s breaking now weighs more than what broke last week.
              </span>
              {ins.errorClasses.length === 0 ? (
                <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--mute)", margin: "18px 0 0" }}>
                  No failures logged — every render succeeded. 🎯
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 18, background: "rgba(255,255,255,0.05)" }}>
                  {ins.errorClasses.slice(0, 8).map((e) => (
                    <div key={e.errorCode} style={{ background: "#1A1A1A", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontFamily: "var(--sans)", fontSize: 15, color: "var(--text)" }}>
                          {ERR_LABELS[e.errorCode] ?? e.errorCode}
                        </span>
                        <span style={{ fontFamily: "var(--serif)", fontSize: 22, fontStyle: "italic", color: "var(--pink)", lineHeight: 1, whiteSpace: "nowrap" }}>
                          {e.count}×
                        </span>
                      </div>
                      {e.remediation && (
                        <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--mute)", lineHeight: 1.5 }}>
                          {e.remediation}
                        </span>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${maxIntensity ? Math.max(8, (e.intensity / maxIntensity) * 100) : 0}%`,
                              background: "linear-gradient(90deg,#EC4899,#8B5CF6)",
                              borderRadius: 2,
                            }}
                          />
                        </div>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
                          {e.intensity >= maxIntensity && maxIntensity > 0 ? "hot now · " : ""}
                          {timeAgo(e.lastSeen)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Renders by mode — muse-only (cacheable to disk). */}
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 3,
                padding: "28px 26px",
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--electric)" }}>
                Renders by mode
              </span>
              <span style={{ display: "block", fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--mute)", marginTop: 6, fontStyle: "italic" }}>
                Muse renders cache to disk and serve instantly on repeat.
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>
                {ins.byMode.map((m) => {
                  const mErrPct = m.total > 0 ? Math.round((m.errors / m.total) * 1000) / 10 : 0;
                  return (
                    <div key={m.mode} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--sans)", fontSize: 13, color: "var(--text)" }}>
                        <span style={{ textTransform: "capitalize" }}>{m.mode}</span>
                        <span style={{ color: "var(--mute)", fontFamily: "var(--mono)", fontSize: 12 }}>
                          {m.total} · {mErrPct}% err
                        </span>
                      </div>
                      <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${ins.totalRenders ? Math.max(6, (m.total / ins.totalRenders) * 100) : 0}%`,
                            background: "linear-gradient(90deg,#8B5CF6,#EC4899)",
                            borderRadius: 2,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Recent failures feed — the raw stream, verbatim */}
          {ins.recentFailures.length > 0 && (
            <div
              style={{
                background: "#141414",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 3,
                padding: "22px 26px",
                marginTop: 12,
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--mute)" }}>
                Recent failures
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                {ins.recentFailures.slice(0, 6).map((f, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--pink)", textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                      {ERR_LABELS[f.errorCode] ?? f.errorCode}
                    </span>
                    <span style={{ fontFamily: "var(--sans)", fontSize: 13.5, color: "var(--text)", flex: 1 }}>
                      <span style={{ color: "var(--mute)", textTransform: "capitalize" }}>{f.mode}</span>
                      {f.handle ? ` · ${f.handle}` : ""}
                    </span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
                      {timeAgo(f.ts)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shop, setShop] = useState<string>("");

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const shopDomain = localStorage.getItem(SHOP_KEY) ?? "";
    setShop(shopDomain);

    if (!token) {
      router.replace("/login");
      return;
    }

    async function fetchOverview() {
      try {
        const res = await fetch(`${SHOPIFY_APP_URL}/api/external-overview`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          // The KPI overview token is stale/invalid. The KPI strip comes from
          // the Shopify app, but the fashion-intelligence + learning-loop
          // sections are SAME-ORIGIN and independent. Keep the page visible,
          // but clearly label KPI numbers as unavailable rather than treating
          // zeros as measured production outcomes.
          // Genuinely-missing token is still caught above (router.replace).
          console.warn("[dashboard] overview token rejected (401) — degrading to same-origin intelligence");
          setData(null);
          return;
        }
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as OverviewData;
        setData(json);
      } catch (err) {
        // The KPI overview comes from the Shopify app; if it's not reachable
        // (e.g. local demo without the app running), don't blank the whole
        // dashboard — render unavailable KPI values and still render the
        // same-origin learning loop.
        console.warn("[dashboard] overview unavailable:", err instanceof Error ? err.message : err);
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    void fetchOverview();
  }, [router]);

  function handleSignOut() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SHOP_KEY);
    document.cookie = `${TOKEN_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    document.cookie = `${SHOP_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    router.push("/login");
  }

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.4em", textTransform: "uppercase", color: "var(--mute)" }}>
          Loading your dashboard…
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <div style={{ textAlign: "center", maxWidth: 480 }}>
          <p style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.4em", textTransform: "uppercase", color: "#EF4444", marginBottom: 16 }}>
            Could not load dashboard
          </p>
          <p style={{ fontFamily: "var(--sans)", fontSize: 15, color: "var(--mute)", marginBottom: 32 }}>
            {error}. This can happen if the Shopify app is not running or the token has expired.
          </p>
          <button
            onClick={handleSignOut}
            style={{
              padding: "12px 24px",
              background: "var(--electric)",
              color: "#fff",
              border: "none",
              borderRadius: 2,
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Sign in again
          </button>
        </div>
      </main>
    );
  }

  const overviewSource = data ? "live" : "unavailable";
  const kpiValue = (value: number) => overviewSource === "live" ? fmt(value) : "—";
  const h = data?.headline ?? {
    chatSessions: 0,
    chatTurns: 0,
    combosProposed: 0,
    cartConfirmed: 0,
    tryOnSessions: 0,
    fitSubmitted: 0,
    signupsClaimed: 0,
    windowDays: 30,
  };
  const assistedRevenue = data?.assistedRevenue ?? { formatted: "—", orderCount: 0 };
  const brandName = (data?.shopDomain ?? shop).replace(".myshopify.com", "");
  const tier = data?.plan.tier ?? "STARTER";

  return (
    <main style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh" }}>

      {/* ─── Top bar ───────────────────────────────────────────────────── */}
      <header
        style={{
          borderBottom: "1px solid var(--line)",
          padding: "0 40px",
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          background: "rgba(8,7,10,0.95)",
          backdropFilter: "blur(12px)",
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Link href="/">
            <span style={{ fontFamily: "var(--serif)", fontSize: 20, fontStyle: "italic" }}>
              Stylique
            </span>
          </Link>
          <span style={{ color: "var(--line)", fontSize: 16 }}>/</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.2em", color: "var(--mute)" }}>
            {brandName}
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: tier === "ULTIMATE" ? "#A78BFA" : tier === "GROWTH" ? "#EC4899" : "var(--mute)",
              border: "1px solid",
              borderColor: tier === "ULTIMATE" ? "#A78BFA" : tier === "GROWTH" ? "#EC4899" : "var(--line-2)",
              borderRadius: 2,
              padding: "2px 7px",
            }}
          >
            {tier}
          </span>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <Link
            href="/demo"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "var(--mute)",
            }}
          >
            Demo store
          </Link>
          <button
            onClick={handleSignOut}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "var(--mute)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ─── Main content ─────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "56px 40px" }}>

        {/* Page title */}
        <div style={{ marginBottom: 56 }}>
          <p
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.45em",
              textTransform: "uppercase",
              color: "var(--mute)",
              margin: "0 0 12px",
            }}
          >
            Last {h.windowDays} days · across all modules
          </p>
          <h1
            style={{
              fontFamily: "var(--serif)",
              fontSize: "clamp(40px,4.5vw,60px)",
              fontWeight: 400,
              margin: 0,
              lineHeight: 1.05,
            }}
          >
            <span style={{ fontStyle: "italic" }}>{brandName}</span> is learning.
          </h1>
        </div>

        {/* Assisted revenue hero */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(232,121,200,0.07) 100%)",
            border: "1px solid rgba(139,92,246,0.25)",
            borderRadius: 3,
            padding: "40px 36px",
            marginBottom: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 24,
          }}
        >
          <div>
            <p
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "rgba(139,92,246,0.8)",
                margin: "0 0 10px",
              }}
            >
              Mira-assisted revenue · 30 days · {overviewSource === "live" ? "live data" : "unavailable"}
            </p>
            <div
              style={{
                fontFamily: "var(--serif)",
                fontSize: "clamp(52px,6vw,80px)",
                fontStyle: "italic",
                lineHeight: 1,
                color: "#fff",
              }}
            >
              {assistedRevenue.formatted}
            </div>
            <p
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--mute)",
                margin: "12px 0 0",
                letterSpacing: "0.15em",
              }}
            >
              {overviewSource === "live"
                ? `${assistedRevenue.orderCount} order${assistedRevenue.orderCount !== 1 ? "s" : ""} attributed to Mira recommendations`
                : "Connect the Shopify app overview API to show measured attribution"}
            </p>
          </div>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 14,
              color: "var(--mute)",
              maxWidth: 280,
              lineHeight: 1.65,
            }}
          >
            Items added to cart via Mira chat or combo cards that converted to fulfilled purchases within the attribution window.
          </div>
        </div>

        {/* ─── Top KPI grid ─────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
            marginBottom: 48,
          }}
        >
          <KpiCard
            label="Chat sessions"
            value={kpiValue(h.chatSessions)}
            sub={overviewSource === "live" ? `${fmt(h.chatTurns)} turns` : "overview unavailable"}
            accent="electric"
          />
          <KpiCard
            label="Combos proposed"
            value={kpiValue(h.combosProposed)}
            sub={overviewSource === "live" ? "AI-curated looks" : "overview unavailable"}
            accent="pink"
          />
          <KpiCard
            label="Added to bag"
            value={kpiValue(h.cartConfirmed)}
            sub={overviewSource === "live" ? "from chat sessions" : "overview unavailable"}
            accent="electric"
          />
          <KpiCard
            label="Try-on sessions"
            value={kpiValue(h.tryOnSessions)}
            sub={overviewSource === "live" ? `${fmt(h.fitSubmitted)} fit checks` : "overview unavailable"}
            accent="pink"
          />
          <KpiCard
            label="Profiles saved"
            value={kpiValue(h.signupsClaimed)}
            sub={overviewSource === "live" ? "email captured" : "overview unavailable"}
            accent="pink"
          />
        </div>

        {/* ─── Module cards ─────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 12,
            marginBottom: 48,
          }}
        >
          <ModuleCard
            tag="Module 01"
            name="Mira AI Stylist"
            accent="electric"
            kpis={[
              { label: "Chat sessions", value: kpiValue(h.chatSessions) },
              { label: "Combos proposed", value: kpiValue(h.combosProposed) },
              { label: "Added to bag", value: kpiValue(h.cartConfirmed) },
              { label: "Assisted revenue", value: assistedRevenue.formatted },
            ]}
          />
          <ModuleCard
            tag="Module 02"
            name="Virtual Try-On"
            accent="pink"
            kpis={[
              { label: "Try-on sessions", value: kpiValue(h.tryOnSessions) },
              { label: "Fit checks", value: kpiValue(h.fitSubmitted) },
              { label: "Returns est. avoided", value: overviewSource === "live" ? fmt(Math.round(h.tryOnSessions * 0.18)) : "model unavailable" },
              { label: "CAC saved est.", value: overviewSource === "live" ? `$${fmt(Math.round(h.tryOnSessions * 0.04 * 12))}` : "model unavailable" },
            ]}
          />
          <ModuleCard
            tag="Module 03"
            name="Smart Sizing"
            accent="electric"
            kpis={[
              { label: "Fit submissions", value: kpiValue(h.fitSubmitted) },
              { label: "Returns saved est.", value: overviewSource === "live" ? `$${fmt(Math.round(h.fitSubmitted * 0.22 * 85))}` : "model unavailable" },
              { label: "Size accuracy lift", value: overviewSource === "live" ? "modelled 22%" : "insufficient data" },
              { label: "Avg. order value", value: overviewSource === "live" ? "$85 benchmark" : "benchmark unavailable" },
            ]}
          />
        </div>

        {/* ─── Fashion intelligence (the four pillars) ──────────────── */}
        <FashionIntelligenceSection />

        {/* ─── The learning loop (the moat) ─────────────────────────── */}
        <LearningLoopSection />

        {/* ─── The second loop — try-on render health ───────────────── */}
        <TryonHealthSection />

        {/* ─── Nav links ────────────────────────────────────────────── */}
        <div
          style={{
            borderTop: "1px solid var(--line)",
            paddingTop: 40,
            display: "flex",
            gap: 32,
            flexWrap: "wrap",
          }}
        >
          {[
            { label: "Full analytics", href: "#" },
            { label: "Settings", href: "#" },
            { label: "Shopify admin", href: `https://${data?.shopDomain ?? shop}/admin/apps` },
          ].map((link) => (
            <Link
              key={link.label}
              href={link.href}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "var(--mute)",
                borderBottom: "1px solid var(--line)",
                paddingBottom: 4,
              }}
            >
              {link.label} →
            </Link>
          ))}
        </div>
      </div>

      <footer
        style={{
          borderTop: "1px solid var(--line)",
          padding: "24px 40px",
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: "var(--mute)",
        }}
      >
        Stylique · {brandName} · {data?.plan.analyticsLevel ?? "BASIC"} analytics · Last {h.windowDays}d
      </footer>
    </main>
  );
}
