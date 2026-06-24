export const REQUIRED_SHOPIFY_SCOPES = [
  "read_products",
  "read_inventory",
  "read_orders",
  "write_script_tags",
] as const;

export const REQUIRED_SHOPIFY_SCOPES_STRING = REQUIRED_SHOPIFY_SCOPES.join(",");

export function parseShopifyScopes(scopes: string | null | undefined): Set<string> {
  return new Set((scopes ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export function missingRequiredShopifyScopes(scopes: string | null | undefined): string[] {
  const granted = parseShopifyScopes(scopes);
  return REQUIRED_SHOPIFY_SCOPES.filter((scope) => !granted.has(scope));
}

export function extraGrantedShopifyScopes(scopes: string | null | undefined): string[] {
  const required = new Set<string>(REQUIRED_SHOPIFY_SCOPES);
  return [...parseShopifyScopes(scopes)].filter((scope) => !required.has(scope)).sort();
}

export type LiveShopifyScopeCheck =
  | {
      status: "checked";
      scopes: string[];
      missing: string[];
      extra: string[];
    }
  | {
      status: "skipped" | "failed";
      reason: string;
      scopes: string[];
      missing: string[];
      extra: string[];
    };

export async function fetchLiveShopifyScopeCheck(args: {
  shopifyDomain: string;
  accessToken: string | null | undefined;
  apiVersion?: string;
}): Promise<LiveShopifyScopeCheck> {
  if (!args.accessToken || args.accessToken === "manual-provisioning-pending") {
    return { status: "skipped", reason: "no_shopify_access_token", scopes: [], missing: [...REQUIRED_SHOPIFY_SCOPES], extra: [] };
  }

  try {
    const res = await fetch(`https://${args.shopifyDomain}/admin/api/${args.apiVersion ?? "2025-01"}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": args.accessToken,
      },
      body: JSON.stringify({
        query: `query StyliqueScopeHealth {
          currentAppInstallation {
            accessScopes { handle }
          }
        }`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { status: "failed", reason: `shopify_http_${res.status}`, scopes: [], missing: [...REQUIRED_SHOPIFY_SCOPES], extra: [] };
    }
    const json = (await res.json()) as {
      data?: { currentAppInstallation?: { accessScopes?: Array<{ handle?: string | null }> | null } | null };
      errors?: unknown;
    };
    if (json.errors || !json.data?.currentAppInstallation?.accessScopes) {
      return { status: "failed", reason: "shopify_scope_query_failed", scopes: [], missing: [...REQUIRED_SHOPIFY_SCOPES], extra: [] };
    }
    const liveScopes = json.data.currentAppInstallation.accessScopes
      .map((scope) => scope.handle)
      .filter((scope): scope is string => typeof scope === "string" && scope.length > 0)
      .sort();
    const serialized = liveScopes.join(",");
    return {
      status: "checked",
      scopes: liveScopes,
      missing: missingRequiredShopifyScopes(serialized),
      extra: extraGrantedShopifyScopes(serialized),
    };
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "shopify_scope_query_timeout" : "shopify_scope_query_failed";
    return { status: "failed", reason, scopes: [], missing: [...REQUIRED_SHOPIFY_SCOPES], extra: [] };
  }
}
