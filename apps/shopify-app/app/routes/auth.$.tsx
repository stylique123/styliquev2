// Catches /auth and /auth/callback. shopify-app-remix handles the full OAuth dance
// and triggers our `afterAuth` hook on success.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}
