import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { Page, Layout, Card, Button, Text, BlockStack, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
import { prisma } from "../db.server";
import { enqueueCatalogSync } from "../queue.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, _count: { select: { products: true, productAudits: true } } },
  });
  return json({ shop });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop }, select: { id: true } });
  if (!shop) return json({ ok: false, error: "Shop not provisioned" }, { status: 400 });
  const job = await enqueueCatalogSync({ kind: "full", shopId: shop.id });
  return json({ ok: true, jobId: job.id, status: "queued" });
}

export default function Catalog() {
  const { shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <Page title="Catalog">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Sync state</Text>
              <Text as="p" variant="bodyMd">{shop?._count.products ?? 0} products · {shop?._count.productAudits ?? 0} audits</Text>
              <Form method="post">
                <Button submit variant="primary" loading={busy}>Sync now</Button>
              </Form>
              {actionData && "jobId" in actionData && (
                <Banner tone="success">Queued job {actionData.jobId} ({actionData.status})</Banner>
              )}
              {actionData && "error" in actionData && (
                <Banner tone="critical">{actionData.error}</Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
