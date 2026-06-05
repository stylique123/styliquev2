// POST { token } → { ok, shopId, shopDomain } or 401
// Used by apps/web to validate tokens before showing the dashboard.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { verifyExternalToken } from "../lib/external-auth.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false }, { status: 405 });

  let token: string | undefined;
  try {
    const body = (await request.json()) as { token?: string };
    token = body.token;
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!token) return json({ ok: false, error: "missing_token" }, { status: 401 });

  const verified = await verifyExternalToken(token);
  if (!verified) return json({ ok: false, error: "invalid_or_expired" }, { status: 401 });

  return json({ ok: true, shopId: verified.shopId, shopDomain: verified.shopDomain });
}
