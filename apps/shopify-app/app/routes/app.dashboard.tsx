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

  return (
    <Page title="Dashboard" subtitle={`Last ${h.windowDays} days`}>
      <Layout>
        {/* ── MEASURED ROI hero ─────────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Revenue Mira drove</Text>
                <Badge tone="success">Measured</Badge>
              </InlineStack>
              <InlineStack gap="800" wrap>
                <Stat label="assisted revenue" value={usd(h.miraAssistedRevenueCents)}
                  hint={`${h.miraAssistedOrders} orders`} />
                <Stat label="return on Stylique" value={h.miraRoiMultiple > 0 ? `${h.miraRoiMultiple}×` : "—"}
                  hint="assisted revenue ÷ plan price" />
                <Stat label="assisted AOV" value={h.assistedAovCents > 0 ? usd(h.assistedAovCents) : "—"} />
                <Stat label="repeat buyers" value={`${h.repeatPurchaseRate.pct}%`}
                  hint={`${h.repeatPurchaseRate.repeatShoppers} of ${h.repeatPurchaseRate.totalShoppers} came back`} />
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
