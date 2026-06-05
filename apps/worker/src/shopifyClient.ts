// Thin Shopify Admin client → @stylique/core CatalogSyncService.ShopifyCatalogClient.
// Uses raw fetch against the Admin GraphQL endpoint so we don't carry an extra runtime
// dependency in the worker. Pagination is handled here.

import type { ShopifyCatalogClient } from "@stylique/core";
import type { ShopifyProductInput } from "@stylique/core";

const API_VERSION = "2025-01";

// D37 — metafield identifiers for size-chart extraction. We request
// the four most common namespace:key combos so we don't need per-brand
// config. The normalizer tries JSON first, then HTML.
// Product.metafields does NOT accept an `identifiers` argument in the Admin
// GraphQL API — that form 400s ("Field 'metafields' doesn't accept argument
// 'identifiers'"). Use the standard connection form and let the normalizer
// filter by namespace/key downstream. first:20 comfortably covers a brand's
// size-chart / care-guide metafields.
const SIZE_CHART_METAFIELD_IDENTIFIERS = /* GraphQL */ `
  metafields(first: 20) {
    nodes { namespace key value }
  }
`;

const QUERY = /* GraphQL */ `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title productType vendor tags status
        descriptionHtml
        options { name values }
        variants(first: 100) {
          nodes {
            id sku price
            inventoryQuantity availableForSale
            selectedOptions { name value }
          }
        }
        images(first: 10) {
          nodes { id url altText }
        }
        ${SIZE_CHART_METAFIELD_IDENTIFIERS}
      }
    }
  }
`;

function flatten(node: any): ShopifyProductInput {
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    productType: node.productType,
    vendor: node.vendor,
    descriptionHtml: node.descriptionHtml,
    tags: node.tags ?? [],
    status: (node.status ?? "ACTIVE").toLowerCase() as "active" | "draft" | "archived",
    options: node.options,
    variants: node.variants.nodes.map((v: any) => ({
      id: v.id, sku: v.sku, price: v.price, selectedOptions: v.selectedOptions,
      inventoryQuantity: v.inventoryQuantity, availableForSale: v.availableForSale,
    })),
    images: node.images.nodes.map((i: any, idx: number) => ({
      id: i.id, url: i.url, position: idx, altText: i.altText,
    })),
    // D37 — size-chart metafields. Nodes with null value are filtered out
    // so the normalizer only sees fields the brand actually set.
    metafields: (node.metafields?.nodes ?? [])
      .filter((m: any) => m.value != null)
      .map((m: any) => ({ namespace: m.namespace, key: m.key, value: m.value })),
  };
}

export function createShopifyCatalogClient(args: {
  shopDomain: string;
  accessToken: string;
}): ShopifyCatalogClient {
  const url = `https://${args.shopDomain}/admin/api/${API_VERSION}/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": args.accessToken,
  };

  async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    const body = await res.json() as { data?: T; errors?: unknown };
    if (body.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors)}`);
    return body.data as T;
  }

  return {
    async fetchAllProducts() {
      const out: ShopifyProductInput[] = [];
      let cursor: string | null = null;
      do {
        const data: any = await graphql<any>(QUERY, { cursor });
        for (const n of data.products.nodes) out.push(flatten(n));
        cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
      } while (cursor);
      return out;
    },

    async fetchProduct(shopifyId) {
      const id = String(shopifyId).startsWith("gid://") ? shopifyId : `gid://shopify/Product/${shopifyId}`;
      const data = await graphql<{ product: any | null }>(
        /* GraphQL */ `
          query Product($id: ID!) {
            product(id: $id) {
              id handle title productType vendor tags status
              descriptionHtml
              options { name values }
              variants(first: 100) { nodes { id sku price inventoryQuantity availableForSale selectedOptions { name value } } }
              images(first: 10) { nodes { id url altText } }
              ${SIZE_CHART_METAFIELD_IDENTIFIERS}
            }
          }
        `,
        { id },
      );
      return data.product ? flatten(data.product) : null;
    },
  };
}
