import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect } from "react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Banner, Box,
} from "@shopify/polaris";

// Load Polaris CSS only on this route (and app.catalog). All other /app/* routes
// are bespoke editorial dark and don't need the 445KB Polaris stylesheet.
export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { catalogSyncQueue, enqueueCatalogSync } from "../queue.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true, shopifyDomain: true, installedAt: true, uninstalledAt: true,
      _count: { select: { products: true, productAudits: true } },
    },
  });

  // Worker connectivity = "Redis reachable and queue accepting jobs".
  let workerReady = false;
  try {
    await catalogSyncQueue.getJobCounts("waiting", "active", "failed");
    workerReady = true;
  } catch {
    workerReady = false;
  }

  return json({ shop, workerReady });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "Shop not provisioned" }, { status: 400 });
  const job = await enqueueCatalogSync({ kind: "full", shopId: shop.id });
  return json({ ok: true, jobId: job.id ?? "queued" });
}

function StatusCard({ title, ready, detail }: { title: string; ready: boolean; detail: string }) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">{title}</Text>
          <Badge tone={ready ? "success" : "critical"}>{ready ? "Connected" : "Not ready"}</Badge>
        </InlineStack>
        <Text as="p" variant="bodyMd" tone="subdued">{detail}</Text>
      </BlockStack>
    </Card>
  );
}

export default function Home() {
  const { shop, workerReady } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state !== "idle";

  const shopifyConnected = Boolean(shop && !shop.uninstalledAt);
  const productCount = shop?._count.products ?? 0;
  const auditCount = shop?._count.productAudits ?? 0;

  return (
    <Page title="Stylique Fashion AI" subtitle="AI try-on, fit, and styling for your store">
      <Layout>
        {actionData && "jobId" in actionData && (
          <Layout.Section>
            <Banner tone="success" title="Catalog sync queued">
              <p>Job {String(actionData.jobId)} is running. Refresh in a moment to see updated counts.</p>
            </Banner>
          </Layout.Section>
        )}
        {actionData && "error" in actionData && (
          <Layout.Section>
            <Banner tone="critical" title="Could not queue sync">
              <p>{actionData.error}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Box minWidth="260px"><StatusCard
              title="Shopify"
              ready={shopifyConnected}
              detail={shop?.shopifyDomain ?? "No shop record"}
            /></Box>
            <Box minWidth="260px"><StatusCard
              title="Worker"
              ready={workerReady}
              detail={workerReady ? "Redis reachable, queue active" : "Run `pnpm worker:dev`"}
            /></Box>
            <Box minWidth="260px"><StatusCard
              title="Catalog Sync"
              ready={productCount > 0}
              detail={productCount > 0 ? `${productCount} products · ${auditCount} audits` : "No products synced yet"}
            /></Box>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Catalog</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Pulls your full Shopify catalog into Stylique, extracts color + category, and generates a PDP audit per product.
              </Text>
              <InlineStack gap="200">
                <Form method="post">
                  <Button submit variant="primary" loading={submitting}>Sync Catalog</Button>
                </Form>
                <Button url="/app/catalog">Open Catalog page</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Sprint 6 round 3 — embeddings backfill CTA (was the missing UX piece
            flagged in the external audit). Wired to /api/admin/embeddings/backfill,
            which is idempotent and reports coverage. */}
        <Layout.Section>
          <EmbeddingsCard />
        </Layout.Section>

        {/* Sprint 6 round 4 — image-quality backfill CTA (D37). Same shape as
            EmbeddingsCard. Catalog-sync now auto-enqueues this too, so the
            button is for manual re-scoring (force a fresh pass when adding
            new product images mid-cycle). */}
        <Layout.Section>
          <ImageQualityCard />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function ImageQualityCard() {
  const coverage = useFetcher<{ ok: boolean; data?: { total: number; scored: number; tryonReady: number; tryonReadyPct: number; tier1: number; tier2: number; tier3: number } }>();
  const trigger  = useFetcher<{ ok: boolean; jobId?: string }>();

  useEffect(() => {
    if (coverage.state === "idle" && !coverage.data) coverage.load("/api/admin/image-quality/backfill");
  }, [coverage]);

  useEffect(() => {
    if (trigger.state === "idle" && trigger.data?.ok) {
      // Refresh coverage after a delay so the worker has time to run.
      const t = setTimeout(() => coverage.load("/api/admin/image-quality/backfill"), 4000);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger.state, trigger.data]);

  const c = coverage.data?.data;
  const busy = trigger.state !== "idle";
  const ready = (c?.tryonReady ?? 0) > 0;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Garment-image quality</Text>
          <Badge tone={ready ? "success" : "attention"}>
            {c ? `${c.tryonReadyPct}% try-on ready` : "Loading…"}
          </Badge>
        </InlineStack>
        <Text as="p" variant="bodyMd" tone="subdued">
          Scores every product image for try-on suitability (Stage 1 heuristic, free; Stage 2 AWS Rekognition when configured).
          Determines which photo becomes the try-on anchor and which widget tier the product shows in (1=full / 2=carousel / 3=size-only).
        </Text>
        {c && (
          <Text as="p" variant="bodyMd" tone="subdued">
            {c.scored} of {c.total} scored · {c.tryonReady} ready · tier 1: {c.tier1} · tier 2: {c.tier2} · tier 3: {c.tier3}
          </Text>
        )}
        <InlineStack gap="200">
          <trigger.Form method="post" action="/api/admin/image-quality/backfill">
            <Button submit variant="primary" loading={busy} disabled={!c || (c.total === 0)}>
              {busy ? "Queued…" : c?.scored ? "Re-score all" : "Score now"}
            </Button>
          </trigger.Form>
          {c?.total === 0 && (
            <Text as="p" variant="bodyMd" tone="subdued">Sync the catalog first.</Text>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function EmbeddingsCard() {
  // GET = coverage snapshot. POST = trigger backfill (idempotent — `modelKey`
  // dedup means re-running just embeds whatever's missing or stale).
  const coverage = useFetcher<{ ok: boolean; data?: { total: number; embedded: number; coverage: number } }>();
  const trigger  = useFetcher<{ ok: boolean; data?: { embedded: number; skipped: number } }>();

  useEffect(() => {
    if (coverage.state === "idle" && !coverage.data) coverage.load("/api/admin/embeddings/backfill");
  }, [coverage]);

  // Auto-refresh coverage when a backfill completes.
  useEffect(() => {
    if (trigger.state === "idle" && trigger.data?.ok) coverage.load("/api/admin/embeddings/backfill");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger.state, trigger.data]);

  const c = coverage.data?.data;
  const busy = trigger.state !== "idle";
  const pct  = c ? c.coverage : 0;
  const ready = (c?.embedded ?? 0) > 0;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Search index (embeddings)</Text>
          <Badge tone={ready ? "success" : "attention"}>
            {c ? `${pct}% covered` : "Loading…"}
          </Badge>
        </InlineStack>
        <Text as="p" variant="bodyMd" tone="subdued">
          Mira&apos;s catalog search falls back to semantic match for queries like &quot;something for a wedding&quot;.
          Powered by Gemini text-embedding-004 — free at quota. Re-running is idempotent (skips anything already current).
        </Text>
        {c && (
          <Text as="p" variant="bodyMd" tone="subdued">
            {c.embedded} of {c.total} products indexed.
            {trigger.data?.ok && (
              <>
                {" "}Last run: embedded {trigger.data.data?.embedded ?? 0}, skipped {trigger.data.data?.skipped ?? 0}.
              </>
            )}
          </Text>
        )}
        <InlineStack gap="200">
          <trigger.Form method="post" action="/api/admin/embeddings/backfill">
            <Button submit variant="primary" loading={busy} disabled={!c || (c.total === 0)}>
              {busy ? "Backfilling…" : c?.embedded ? "Refresh index" : "Backfill now"}
            </Button>
          </trigger.Form>
          {c?.total === 0 && (
            <Text as="p" variant="bodyMd" tone="subdued">Sync the catalog first.</Text>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
