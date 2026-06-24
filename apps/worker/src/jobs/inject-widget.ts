// Widget auto-injection health job.
//
// Runs daily (07:00 UTC) — re-ensures the Stylique widget ScriptTag exists on
// every active merchant's storefront. Merchants sometimes accidentally delete
// the tag via theme edits, or the initial injection in afterAuth fails silently
// (Shopify App Bridge quirks). This job is the self-healing backstop.
//
// Logic: fetch the shop's active sessions from Prisma, call the Shopify Admin
// GraphQL to list existing ScriptTags, and re-create the widget ScriptTag if it
// is missing. Idempotent — if it already exists we skip.
//
// The SHOPIFY_APP_URL env var must be set in the worker (same value as the
// shopify-app service) so the ScriptTag src resolves correctly. Never fall
// back to a hard-coded production URL: a staging worker must not inject the
// production widget into a merchant storefront.

import { prisma } from "@stylique/db";
import { decryptField } from "@stylique/core";

const APP_URL = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/+$/, "");
const WIDGET_SRC = `${APP_URL}/widget.js`;
const LEGACY_WIDGET_SRCS = [`${APP_URL}/public/widget.js`, `${APP_URL}/public/stylist.js`];

type ScriptTagEdge = {
  node: { id: string; src: string };
};

async function shopifyGql(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`shopify_gql_${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function runInjectWidget(): Promise<{ ensured: number; skipped: number; errors: number }> {
  if (!APP_URL) {
    throw new Error("SHOPIFY_APP_URL is required for widget injection");
  }

  const shops = await prisma.shop.findMany({
    where: { uninstalledAt: null },
    select: { id: true, shopifyDomain: true, accessToken: true },
  });

  let ensured = 0, skipped = 0, errors = 0;

  for (const shop of shops) {
    try {
      const token = decryptField(shop.accessToken);
      if (!token) { skipped++; continue; }

      // 1. Remove retired duplicate ScriptTags from older installs. Otherwise
      // merchants can run two Mira widgets even after the new source is present.
      for (const legacySrc of LEGACY_WIDGET_SRCS) {
        const legacyResult = await shopifyGql(
          shop.shopifyDomain,
          token,
          `query { scriptTags(first: 20, query: "src:${legacySrc}") { edges { node { id src } } } }`,
        );
        const legacyEdges = (
          (legacyResult as { data?: { scriptTags?: { edges?: ScriptTagEdge[] } } })
            .data?.scriptTags?.edges ?? []
        );
        for (const edge of legacyEdges) {
          await shopifyGql(
            shop.shopifyDomain,
            token,
            `mutation scriptTagDelete($id: ID!) {
              scriptTagDelete(id: $id) {
                deletedScriptTagId
                userErrors { field message }
              }
            }`,
            { id: edge.node.id },
          );
        }
      }

      // 2. List existing ScriptTags with our src.
      const listResult = await shopifyGql(
        shop.shopifyDomain,
        token,
        `query { scriptTags(first: 20, query: "src:${WIDGET_SRC}") { edges { node { id src } } } }`,
      );
      const existing = (
        (listResult as { data?: { scriptTags?: { edges?: ScriptTagEdge[] } } })
          .data?.scriptTags?.edges ?? []
      ).map((e) => e.node.src);

      if (existing.includes(WIDGET_SRC)) {
        // Widget ScriptTag already present — nothing to do.
        skipped++;
        continue;
      }

      // 3. Re-create the missing ScriptTag.
      const createResult = await shopifyGql(
        shop.shopifyDomain,
        token,
        `mutation scriptTagCreate($input: ScriptTagInput!) {
          scriptTagCreate(input: $input) {
            scriptTag { id src }
            userErrors { field message }
          }
        }`,
        { input: { src: WIDGET_SRC, displayScope: "ONLINE_STORE" } },
      );
      const userErrors = (createResult as {
        data?: { scriptTagCreate?: { userErrors?: Array<{ message?: string }> } };
      }).data?.scriptTagCreate?.userErrors ?? [];
      if (userErrors.length) {
        throw new Error(`script_tag_create_failed:${userErrors.map((e) => e.message ?? "unknown").join(",")}`);
      }

      console.log(`[inject-widget] re-injected widget on ${shop.shopifyDomain}`);
      ensured++;
    } catch (err) {
      console.error(`[inject-widget] failed for ${shop.shopifyDomain}:`, (err as Error).message?.slice(0, 200));
      errors++;
    }
  }

  console.log(`[inject-widget] done — ensured=${ensured} skipped=${skipped} errors=${errors}`);
  return { ensured, skipped, errors };
}
