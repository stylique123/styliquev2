// Manual install entry — form on `/` posts here with `shop=…` to kick off OAuth.
// Shopify's `login()` helper validates the shop param and redirects into the auth flow.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { login } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await login(request);
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  await login(request);
  return null;
}
