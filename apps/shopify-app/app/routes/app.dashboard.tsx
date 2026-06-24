// /app/dashboard — the embedded merchant dashboard (audit P0 #4).
//
// buildOverview() was previously reachable only via /api/admin/overview (JSON)
// and an external Bearer-token dashboard — so a merchant onboarding INSIDE
// Shopify saw no value surface. This route renders the contract in-app.
//
// PB19 honesty: MEASURED numbers (assisted revenue from real confirmed orders,
// ROI, AOV, repeat-buyer rate) are shown plain; MODELED numbers (catalog-gap
// revenue-at-risk, near-miss recoverable, the Unmet Demand Index) carry an
// "Est." label and a ~ prefix. Never present a model as a measured fact.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Box, Divider, Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { buildOverview } from "../lib/dashboard.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false as const, error: "shop_not_installed" });
  try {
    const data = await buildOverview({ shopId: shop.id, windowDays: 30 });
    return json({ ok: true as const, data });
  } catch (err) {
    return json({ ok: false as const, error: (err as Error).message ?? "overview_failed" });
  }
}

const usd = (cents: number) =>
  "$" + Math.round((cents ?? 0) / 100).toLocaleString();
const usdWhole = (n: number) => "$" + Math.round(n ?? 0).toLocaleString();
const pct = (n: number) => `${Math.round((n ?? 0) * 100)}%`;
const sourceLabel = (source: string) => {
  switch (source) {
    case "measured": return "Measured";
    case "mixed": return "Measured + modelled";
    case "modelled": return "Modelled";
    default: return "Collecting";
  }
};
const sourceTone = (source: string): "success" | "attention" => source === "measured" ? "success" : "attention";
const USAGE_METERS = [
  ["TRYON_PERSONAL", "Personal try-ons"],
  ["TRYON_BODY", "Body-model try-ons"],
  ["STYLE_RECOMMENDATION", "Style recommendations"],
  ["FIT_RECOMMENDATION", "Fit recommendations"],
  ["VISION_TURN", "Mira vision turns"],
  ["STYLIST_TURN", "Mira chat turns"],
] as const;

function usageValue(row: { used: number; cap: number | null; remaining: number | null } | undefined) {
  if (!row) return "0 / 0";
  if (row.cap == null) return `${row.used.toLocaleString()} / Unlimited`;
  return `${row.used.toLocaleString()} / ${row.cap.toLocaleString()}`;
}

function usageTone(row: { used: number; cap: number | null; remaining: number | null } | undefined): "success" | "attention" | "critical" {
  if (!row || row.cap == null || row.cap <= 0) return "success";
  const ratio = row.used / row.cap;
  if (ratio >= 1) return "critical";
  if (ratio >= 0.8) return "attention";
  return "success";
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <BlockStack gap="050">
      <Text as="span" variant="headingLg">{value}</Text>
      <Text as="span" tone="subdued" variant="bodySm">{label}</Text>
      {hint ? <Text as="span" tone="subdued" variant="bodyXs">{hint}</Text> : null}
    </BlockStack>
  );
}

export default function Dashboard() {
  const res = useLoaderData<typeof loader>();

  if (!res.ok) {
    return (
      <Page title="Dashboard">
        <Banner tone="warning" title="Couldn't load your dashboard">
          <p>{res.error === "shop_not_installed"
            ? "This store isn't fully installed yet."
            : "We hit a snag building your metrics. Try again shortly."}</p>
        </Banner>
      </Page>
    );
  }

  const d = res.data;
  const h = d.headline;
  const cat = d.catalog;
  const f = d.stylist.funnel;
  const fi = d.fashionIntelligence;
  const fiModeled = fi.dataMode === "modelled";
  const consumerEvidenceLabel = fiModeled ? "Catalog-modelled" : "Shopper + catalog";

  const widgetLive = d.widget.placement.widgetLive;

  return (
    <Page title="Dashboard" subtitle={`Last ${h.windowDays} days`}>
      <Layout>
        {/* ── Widget-live status (P1-T08) — never a silent pass ─────────── */}
        <Layout.Section>
          {widgetLive ? (
            <Banner tone="success" title="Your Stylique widget is live on your storefront">
              <p>We&apos;ve confirmed the widget is mounted and shoppers can reach Mira.</p>
            </Banner>
          ) : (
            <Banner tone="critical" title="We haven&apos;t detected your widget on your storefront yet">
              <p>Enable the Stylique app embed in your theme (Online Store → Themes →
                Customize → App embeds), then open a product page to confirm. Until a
                shopper loads it, this stays red.</p>
            </Banner>
          )}
        </Layout.Section>

        {/* ── Outcome hero (P4-T05) — honest: measured only when there's a
             real linked order; otherwise "pilot pending", never a $0 "Measured"
             headline (which reads as a measured zero rather than no-data-yet). ── */}
        <Layout.Section>
          <Card>
            {h.miraAssistedOrders > 0 ? (
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Revenue Mira drove</Text>
                  <Badge tone="success">Measured · attributed</Badge>
                </InlineStack>
                <InlineStack gap="800" wrap>
                  <Stat label="assisted revenue" value={usd(h.miraAssistedRevenueCents)}
                    hint={`${h.miraAssistedOrders} linked orders`} />
                  <Stat label="return on Stylique" value={h.miraRoiMultiple > 0 ? `${h.miraRoiMultiple}×` : "—"}
                    hint="assisted revenue ÷ plan price" />
                  <Stat label="assisted AOV" value={h.assistedAovCents > 0 ? usd(h.assistedAovCents) : "—"} />
                  <Stat label="repeat buyers" value={`${h.repeatPurchaseRate.pct}%`}
                    hint={`${h.repeatPurchaseRate.repeatShoppers} of ${h.repeatPurchaseRate.totalShoppers} came back`} />
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodyXs">
                  Attribution links each order to a Mira session by customer email or
                  Shopify customer id, within 48h of an assist. It is directional
                  (order-linked), not a controlled holdout — so read it as &ldquo;Mira
                  was involved&rdquo;, not a proven causal lift.
                </Text>
              </BlockStack>
            ) : (
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Revenue Mira drove</Text>
                  <Badge tone="attention">Pilot pending</Badge>
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  No linked orders yet — outcome measurement begins with your first
                  order we can tie back to a Mira session. We will never show an
                  estimated or assumed revenue figure here; only orders we can
                  actually link will count.
                </Text>
              </BlockStack>
            )}
          </Card>
        </Layout.Section>

        {/* ── Plan usage: visible quota truth, same meters entitlement enforces ─ */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Plan usage</Text>
                <Badge tone="info">{d.plan.tier}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Current billing period. Unlimited meters still show usage so you can see activity without treating it as a cap.
              </Text>
              <InlineStack gap="400" wrap>
                {USAGE_METERS.map(([metric, label]) => {
                  const row = d.plan.usage[metric];
                  return (
                    <Box key={metric} background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="100">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" tone="subdued" variant="bodyXs">{label}</Text>
                          <Badge tone={usageTone(row)}>{row?.cap == null ? "Unlimited" : `${row?.remaining ?? 0} left`}</Badge>
                        </InlineStack>
                        <Text as="span" variant="headingMd">{usageValue(row)}</Text>
                      </BlockStack>
                    </Box>
                  );
                })}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Mira engagement funnel (measured counts) ──────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Mira engagement</Text>
              <InlineStack gap="800" wrap>
                <Stat label="conversations" value={f.opened.toLocaleString()} />
                <Stat label="messages sent" value={f.messaged.toLocaleString()} />
                <Stat label="looks shown" value={f.combosShown.toLocaleString()} />
                <Stat label="products clicked" value={f.productClicked.toLocaleString()} />
                <Stat label="carts confirmed" value={f.cartConfirmed.toLocaleString()} />
                <Stat label="try-ons" value={h.tryOnSessions.toLocaleString()} />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Fashion intelligence (computed by buildOverview, source-labelled) ─ */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Fashion intelligence</Text>
                <Badge tone={fiModeled ? "attention" : "success"}>
                  {fiModeled ? "Modelled" : "Live + modelled"}
                </Badge>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                {fiModeled
                  ? `Directional insights from catalog and early Mira behavior while real shopper signals build (${fi.realSignalCount}/40 captured).`
                  : `${fi.realSignalCount.toLocaleString()} real shopper signals blended with modelled merchandising context.`}
              </Text>

              <InlineStack gap="400" wrap>
                {fi.exec.slice(0, 4).map((card) => (
                  <Box key={card.label} background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="100">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" tone="subdued" variant="bodyXs">{card.label}</Text>
                        <Badge tone={sourceTone(card.source)}>{sourceLabel(card.source)}</Badge>
                      </InlineStack>
                      <Text as="span" variant="headingMd">{card.value}</Text>
                      <Text as="span" tone="subdued" variant="bodySm">{card.sub}</Text>
                      <Text as="span" tone="subdued" variant="bodyXs">{card.sourceDetail}</Text>
                    </BlockStack>
                  </Box>
                ))}
              </InlineStack>

              <Divider />

              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">
                    {fiModeled ? "What your catalog is preparing Mira to learn" : "What shoppers and your catalog are teaching Mira"}
                  </Text>
                  <Badge tone={fiModeled ? "attention" : "success"}>{consumerEvidenceLabel}</Badge>
                </InlineStack>
                {fi.consumer.styleMap.slice(0, 4).map((style) => (
                  <InlineStack key={style.style} align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd">{style.style}</Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {pct(style.share)} {fiModeled ? "catalog weight" : "shopper + catalog mix"}
                    </Text>
                  </InlineStack>
                ))}
                {fi.consumer.combos.slice(0, 3).map((combo) => (
                  <InlineStack key={combo.label} align="space-between" blockAlign="center" wrap={false}>
                    <Text as="span" variant="bodyMd">{combo.pieces.join(" + ")}</Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {combo.count > 0 ? `${combo.count} asks` : "catalog pairing"}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>

              {fi.gates.conversion ? (
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <InlineStack gap="800" wrap>
                    <Stat
                      label="try-on cart rate"
                      value={fi.conversion.tryOnPurchaseRate != null ? pct(fi.conversion.tryOnPurchaseRate) : "Collecting"}
                      hint="try-on-origin cart events ÷ completed try-ons"
                    />
                    <Stat
                      label="baseline order proxy"
                      value={fi.conversion.baselinePurchaseRate != null ? pct(fi.conversion.baselinePurchaseRate) : "Collecting"}
                      hint="confirmed orders against chat activity"
                    />
                    <Stat
                      label="try-on assist ratio"
                      value={fi.conversion.tryOnLiftX != null ? `${fi.conversion.tryOnLiftX}×` : "Collecting"}
                      hint="not a causal holdout lift"
                    />
                  </InlineStack>
                </Box>
              ) : (
                <Text as="p" tone="subdued" variant="bodySm">
                  Conversion intelligence unlocks on Growth and Scale plans.
                </Text>
              )}

              <Text as="p" tone="subdued" variant="bodyXs">
                Source note: executive cards carry their own source label. Consumer rows can blend shopper signals with catalog context; catalog pairings are directional until shoppers ask for that look. Conversion rows are cart/order attribution proxies, not controlled causal lift.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Reorder intelligence (modeled — Est.) ─────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">What to stock next</Text>
                <Badge tone="attention">Est.</Badge>
              </InlineStack>
              {cat ? (
                <BlockStack gap="400">
                  {/* Unmet Demand Index headline */}
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <Text as="p" variant="bodyMd">
                      ~{usdWhole(cat.unmetDemandIndexUsd.low)}–{usdWhole(cat.unmetDemandIndexUsd.high)}
                      {" "}<Text as="span" tone="subdued">of demand you couldn't fulfil this window (estimate)</Text>
                    </Text>
                  </Box>

                  {/* Catalog gaps — reorder this */}
                  {cat.gaps.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Gaps — things shoppers asked for that you don't carry</Text>
                      {cat.gaps.slice(0, 5).map((g, i) => (
                        <InlineStack key={i} align="space-between" blockAlign="center" wrap={false}>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd">{g.canonicalCategory}</Text>
                            <Text as="span" tone="subdued" variant="bodySm">“{g.query}” · {g.count} asks</Text>
                          </BlockStack>
                          <Text as="span" tone="subdued" variant="bodySm">
                            ~{usdWhole(g.revenueLeakRange.low)}–{usdWhole(g.revenueLeakRange.high)} Est.
                          </Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}

                  {cat.nearMisses.length > 0 && <Divider />}

                  {/* Near-misses — cheapest gap to close */}
                  {cat.nearMisses.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Near-misses — one attribute from a sale</Text>
                      {cat.nearMisses.slice(0, 5).map((n, i) => (
                        <InlineStack key={i} align="space-between" blockAlign="center" wrap={false}>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd">{n.category}</Text>
                            <Text as="span" tone="subdued" variant="bodySm">missing: {n.missingAttribute} · {n.askCount} asks</Text>
                          </BlockStack>
                          <Text as="span" tone="subdued" variant="bodySm">~{usdWhole(n.recoverableRevenueEst)} Est.</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}

                  {cat.gaps.length === 0 && cat.nearMisses.length === 0 && (
                    <Text as="p" tone="subdued">No unmet demand captured yet — it fills as shoppers chat with Mira.</Text>
                  )}
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">Reorder intelligence is available on Growth and Scale plans.</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Top looks (measured CTR) ──────────────────────────────────── */}
        {d.stylist.topCombos.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Top looks Mira proposes</Text>
                <BlockStack gap="200">
                  {d.stylist.topCombos.slice(0, 5).map((c, i) => (
                    <InlineStack key={i} align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">{c.name}</Text>
                      <Text as="span" tone="subdued" variant="bodySm">{c.proposed} shown · {c.ctr}% clicked</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
