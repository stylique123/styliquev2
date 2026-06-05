// ScriptTag management — creates/deletes ScriptTags on merchant stores
// via Shopify Admin GraphQL so the widget auto-loads without theme editor action.
//
// Called from afterAuth (create/ensure) and APP_UNINSTALLED (delete).
//
// Uses direct fetch to the Shopify Admin GraphQL endpoint with the raw
// access token. This avoids needing the @shopify/shopify-api package as a
// direct dependency and works cleanly in both afterAuth and webhook contexts.

import { ApiVersion } from "@shopify/shopify-app-remix/server";

const ADMIN_API_VERSION = ApiVersion.January25;

const CREATE_SCRIPT_TAG = `
  mutation scriptTagCreate($input: ScriptTagInput!) {
    scriptTagCreate(input: $input) {
      scriptTag {
        id
        legacyResourceId
        src
        displayScope
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_SCRIPT_TAGS = `
  query scriptTags($query: String) {
    scriptTags(first: 10, query: $query) {
      edges {
        node { id src legacyResourceId }
      }
    }
  }
`;

const DELETE_SCRIPT_TAG = `
  mutation scriptTagDelete($id: ID!) {
    scriptTagDelete(id: $id) {
      deletedScriptTagId
      userErrors { field message }
    }
  }
`;

interface RawSession {
  shop: string;
  accessToken: string;
}

async function adminGraphql(
  session: RawSession,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const url = `https://${session.shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": session.accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) {
    throw new Error(`Shopify Admin GraphQL HTTP ${resp.status} for ${session.shop}`);
  }
  return resp.json();
}

export async function ensureScriptTags(session: RawSession, appUrl: string): Promise<void> {
  const scripts = [
    { src: `${appUrl}/public/widget.js`,  displayScope: "ONLINE_STORE" },
    { src: `${appUrl}/public/stylist.js`, displayScope: "ONLINE_STORE" },
  ];

  for (const script of scripts) {
    // Check if already exists — query by src to avoid duplicates on reinstall.
    const existingResult = await adminGraphql(session, GET_SCRIPT_TAGS, {
      query: `src:${script.src}`,
    }) as { data?: { scriptTags?: { edges?: Array<{ node: { id: string } }> } } };

    const edges = existingResult?.data?.scriptTags?.edges ?? [];
    if (edges.length > 0) {
      console.log(`[ScriptTag] Already exists for ${session.shop}: ${script.src}`);
      continue;
    }

    // Create the ScriptTag.
    const result = await adminGraphql(session, CREATE_SCRIPT_TAG, {
      input: { src: script.src, displayScope: script.displayScope },
    }) as { data?: { scriptTagCreate?: { userErrors?: Array<{ field: string; message: string }> } } };

    const errs = result?.data?.scriptTagCreate?.userErrors ?? [];
    if (errs.length > 0) {
      console.error(`[ScriptTag] Failed to create ${script.src} for ${session.shop}:`, errs);
    } else {
      console.log(`[ScriptTag] Created for ${session.shop}: ${script.src}`);
    }
  }
}

export async function deleteScriptTags(session: RawSession, appUrl: string): Promise<void> {
  const srcs = [`${appUrl}/public/widget.js`, `${appUrl}/public/stylist.js`];

  for (const src of srcs) {
    const existingResult = await adminGraphql(session, GET_SCRIPT_TAGS, {
      query: `src:${src}`,
    }) as { data?: { scriptTags?: { edges?: Array<{ node: { id: string } }> } } };

    const edges = existingResult?.data?.scriptTags?.edges ?? [];
    for (const edge of edges) {
      await adminGraphql(session, DELETE_SCRIPT_TAG, { id: edge.node.id });
      console.log(`[ScriptTag] Deleted for ${session.shop}: ${src}`);
    }
  }
}
