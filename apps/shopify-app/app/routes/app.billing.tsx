import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { PLAN_FEATURES } from "@stylique/core/src/plans/features";

const PLAN_PRICES = {
  STARTER: Number(process.env.SHOPIFY_BILLING_STARTER_USD ?? 49),
  GROWTH: Number(process.env.SHOPIFY_BILLING_GROWTH_USD ?? 199),
  ULTIMATE: Number(process.env.SHOPIFY_BILLING_ULTIMATE_USD ?? 499),
} as const;

type Tier = keyof typeof PLAN_PRICES;

const CURRENT_SUBSCRIPTION = `#graphql
  query CurrentSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
      }
    }
  }
`;

const CREATE_SUBSCRIPTION = `#graphql
  mutation CreateAppSubscription($name: String!, $returnUrl: URL!, $test: Boolean!, $amount: Decimal!) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: $amount, currencyCode: USD }
            interval: EVERY_30_DAYS
          }
        }
      }]
    ) {
      confirmationUrl
      userErrors { field message }
      appSubscription { id status name }
    }
  }
`;

function planDefaults(tier: Tier) {
  const f = PLAN_FEATURES[tier];
  return {
    tier,
    monthlyTryOnPersonal: f.widget.monthlyTryOnPersonal,
    monthlyTryOnBody: f.widget.monthlyTryOnBody,
    monthlyStylistTurns: f.stylist.monthlyTurns,
    monthlyStyleRecs: f.widget.monthlyStyleRecs,
    monthlyFitRecs: f.widget.monthlyFitRecs,
    analyticsLevel: f.analytics.level,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_provisioned" }, { status: 404 });

  const url = new URL(request.url);
  const confirmed = url.searchParams.get("billing_confirmed") === "1";
  let activeSubscription: { id: string; name: string; status: string; test?: boolean } | null = null;

  try {
    const resp = await admin.graphql(CURRENT_SUBSCRIPTION);
    const data = await resp.json() as {
      data?: { currentAppInstallation?: { activeSubscriptions?: Array<{ id: string; name: string; status: string; test?: boolean }> } };
    };
    activeSubscription = data.data?.currentAppInstallation?.activeSubscriptions?.[0] ?? null;
  } catch {
    activeSubscription = null;
  }

  if (confirmed && activeSubscription) {
    const tier = parseTierFromName(activeSubscription.name);
    await prisma.plan.upsert({
      where: { shopId: shop.id },
      create: {
        shopId: shop.id,
        ...planDefaults(tier),
        planFeaturesJson: { billing: { status: activeSubscription.status, subscriptionId: activeSubscription.id, tier } },
      },
      update: {
        ...planDefaults(tier),
        planFeaturesJson: { billing: { status: activeSubscription.status, subscriptionId: activeSubscription.id, tier } },
      },
    });
  }

  return json({ ok: true, plan: shop.plan, activeSubscription, prices: PLAN_PRICES });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const tier = String(form.get("tier") ?? "STARTER").toUpperCase() as Tier;
  if (!["STARTER", "GROWTH", "ULTIMATE"].includes(tier)) {
    return json({ ok: false, error: "invalid_tier" }, { status: 400 });
  }

  const returnUrl = new URL("/app/billing", process.env.SHOPIFY_APP_URL);
  returnUrl.searchParams.set("billing_confirmed", "1");
  returnUrl.searchParams.set("shop", session.shop);

  const resp = await admin.graphql(CREATE_SUBSCRIPTION, {
    variables: {
      name: `Stylique ${tier}`,
      amount: PLAN_PRICES[tier],
      test: process.env.NODE_ENV !== "production" || process.env.SHOPIFY_BILLING_TEST === "1",
      returnUrl: returnUrl.toString(),
    },
  });
  const data = await resp.json() as {
    data?: { appSubscriptionCreate?: { confirmationUrl?: string; userErrors?: Array<{ message: string }> } };
  };
  const result = data.data?.appSubscriptionCreate;
  const error = result?.userErrors?.[0]?.message;
  if (!result?.confirmationUrl || error) {
    return json({ ok: false, error: error ?? "billing_create_failed" }, { status: 400 });
  }
  throw redirect(result.confirmationUrl);
}

function parseTierFromName(name: string): Tier {
  if (/ultimate/i.test(name)) return "ULTIMATE";
  if (/growth/i.test(name)) return "GROWTH";
  return "STARTER";
}

export default function BillingPage() {
  const data = useLoaderData<typeof loader>() as {
    ok: boolean;
    error?: string;
    activeSubscription?: { id: string; name: string; status: string; test?: boolean } | null;
    prices?: typeof PLAN_PRICES;
  };
  const nav = useNavigation();
  if (!data.ok) return <main style={{ padding: 24 }}>Billing unavailable: {data.error}</main>;
  const prices = data.prices ?? PLAN_PRICES;
  return (
    <main style={{ padding: 24, color: "#111", fontFamily: "system-ui" }}>
      <h1>Billing</h1>
      <p>Choose a Shopify app subscription. Paid features activate only after Shopify approval.</p>
      {data.activeSubscription && (
        <p>Active subscription: <strong>{data.activeSubscription.name}</strong> ({data.activeSubscription.status})</p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, marginTop: 20 }}>
        {(Object.keys(prices) as Tier[]).map((tier) => (
          <Form key={tier} method="post" style={{ border: "1px solid #ddd", borderRadius: 8, padding: 18 }}>
            <h2>{tier}</h2>
            <p>${prices[tier]}/mo</p>
            <input type="hidden" name="tier" value={tier} />
            <button disabled={nav.state !== "idle"}>{nav.state !== "idle" ? "Opening..." : `Select ${tier}`}</button>
          </Form>
        ))}
      </div>
    </main>
  );
}
