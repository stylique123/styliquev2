import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // Shopify Admin hits /?shop=X&host=Y&embedded=1&id_token=...
  // Forward ALL params to /app so the embedded auth strategy can use host + id_token.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();
  return (
    <main style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 540, margin: "60px auto", padding: 24 }}>
      <h1>Stylique Fashion AI</h1>
      <p>Install Stylique on your Shopify store to add AI try-on, fit recommendations, and styling.</p>
      {showForm && (
        <Form method="post" action="/auth/login" style={{ marginTop: 24 }}>
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ display: "block", marginBottom: 4 }}>Shop domain</span>
            <input
              type="text"
              name="shop"
              placeholder="my-shop.myshopify.com"
              style={{ padding: 8, width: "100%", border: "1px solid #ccc", borderRadius: 6 }}
            />
          </label>
          <button type="submit" style={{ padding: "8px 16px", background: "#008060", color: "white", border: 0, borderRadius: 6 }}>
            Install
          </button>
        </Form>
      )}
    </main>
  );
}
