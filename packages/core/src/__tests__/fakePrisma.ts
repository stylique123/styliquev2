// In-memory Prisma stand-in. Surface intentionally limited to what services call.
// Extend deliberately when a service grows.

type Plan = {
  id: string; shopId: string; tier: "STARTER" | "GROWTH" | "ULTIMATE";
  monthlyTryOnPersonal: number | null;
  monthlyTryOnBody: number | null;
  fairUseWarnAt: number;
};
type UsageRow = { shopId: string; metric: string; periodStart: Date; count: number };
type Notification = { shopId: string; kind: string; payload: unknown; createdAt: Date };
type AnalyticsEvent = { shopId: string; name: string; payload: unknown; createdAt: Date; productId?: string; shopperId?: string };

type Shop = { id: string; shopifyDomain: string; accessToken: string; scopes: string; uninstalledAt: Date | null; installedAt: Date };
type Product = {
  id: string; shopId: string; shopifyId: string; handle: string; title: string;
  productType: string | null; vendor: string | null; tags: string[]; category: string | null;
  primaryColor: string | null; colorFamily: string | null;
  primaryTryonImageId?: string | null;
  tryonReady?: boolean;
  widgetTier?: number;
  qualityComputedAt?: Date | null;
};
type Variant = { id: string; productId: string; shopifyId: string; sku: string | null; size: string | null; color: string | null; priceCents: number | null };
type Image = { id: string; productId: string; shopifyId: string | null; url: string; altText?: string | null; position: number; role: string };
type Audit = {
  id: string; shopId: string; productId: string;
  missingSizeChart: boolean; weakImageQuality: boolean; missingStyling: boolean;
  missingTryOnReady: boolean; missingColorCombos: boolean;
  recommendations: unknown; priorityScore: number;
};

let idSeq = 0;
const cuid = () => `fake_${++idSeq}`;

export function createFakePrisma(initial?: { plans?: Plan[]; shops?: Shop[] }) {
  const plans = new Map<string, Plan>();
  for (const p of initial?.plans ?? []) plans.set(p.shopId, p);

  const shops = new Map<string, Shop>();
  for (const s of initial?.shops ?? []) shops.set(s.id, s);

  const counters = new Map<string, UsageRow>();
  const notifications: Notification[] = [];
  const events: AnalyticsEvent[] = [];
  const products = new Map<string, Product>();
  const variants = new Map<string, Variant>();
  const images = new Map<string, Image>();
  const audits = new Map<string, Audit>();

  const ckey = (shopId: string, metric: string, periodStart: Date) =>
    `${shopId}|${metric}|${periodStart.toISOString()}`;
  const pkey = (shopId: string, shopifyId: string) => `${shopId}|${shopifyId}`;
  const vkey = (productId: string, shopifyId: string) => `${productId}|${shopifyId}`;
  const akey = (shopId: string, productId: string) => `${shopId}|${productId}`;

  return {
    _state: { plans, shops, counters, notifications, events, products, variants, images, audits },

    plan: {
      async findUnique({ where: { shopId } }: any) { return plans.get(shopId) ?? null; },
    },

    shop: {
      async update({ where: { id }, data }: any) {
        const s = shops.get(id);
        if (!s) throw new Error(`Shop ${id} not found`);
        Object.assign(s, data);
        return s;
      },
      async findUnique({ where }: any) {
        if (where.id) return shops.get(where.id) ?? null;
        if (where.shopifyDomain) {
          for (const s of shops.values()) if (s.shopifyDomain === where.shopifyDomain) return s;
        }
        return null;
      },
    },

    usageCounter: {
      async findUnique({ where: { shopId_metric_periodStart } }: any) {
        const { shopId, metric, periodStart } = shopId_metric_periodStart;
        return counters.get(ckey(shopId, metric, periodStart)) ?? null;
      },
      async upsert({ where, update, create }: any) {
        const { shopId, metric, periodStart } = where.shopId_metric_periodStart;
        const k = ckey(shopId, metric, periodStart);
        const existing = counters.get(k);
        if (existing) { existing.count += update.count?.increment ?? 0; return existing; }
        const row: UsageRow = { shopId: create.shopId, metric: create.metric, periodStart: create.periodStart, count: create.count };
        counters.set(k, row);
        return row;
      },
    },

    notification: {
      async create({ data }: any) {
        const n: Notification = { ...data, createdAt: new Date() };
        notifications.push(n);
        return n;
      },
    },

    analyticsEvent: {
      async create({ data }: any) {
        const e = { ...data, createdAt: new Date() };
        events.push(e);
        return e;
      },
      async createMany({ data }: any) {
        for (const d of data) events.push({ ...d, createdAt: new Date() });
        return { count: data.length };
      },
    },

    product: {
      async upsert({ where, update, create }: any) {
        const { shopId, shopifyId } = where.shopId_shopifyId;
        const k = pkey(shopId, shopifyId);
        const existing = [...products.values()].find((p) => p.shopId === shopId && p.shopifyId === shopifyId);
        if (existing) { Object.assign(existing, update); return existing; }
        const p: Product = { id: cuid(), ...create };
        products.set(k, p);
        return p;
      },
      async update({ where: { id }, data }: any) {
        const existing = [...products.values()].find((p) => p.id === id);
        if (!existing) throw new Error(`Product ${id} not found`);
        Object.assign(existing, data);
        return existing;
      },
      async findMany({ where, select }: any = {}) {
        let out = [...products.values()];
        if (where?.shopId) out = out.filter((p) => p.shopId === where.shopId);
        if (where?.NOT?.shopifyId?.in) {
          const blocked = new Set<string>(where.NOT.shopifyId.in);
          out = out.filter((p) => !blocked.has(p.shopifyId));
        }
        if (select) return out.map((p) => Object.fromEntries(Object.keys(select).map((k) => [k, (p as any)[k]])));
        return out;
      },
      async deleteMany({ where }: any) {
        let removed = 0;
        for (const [k, p] of products) {
          if (where.shopId && p.shopId !== where.shopId) continue;
          if (where.shopifyId && p.shopifyId !== where.shopifyId) continue;
          if (where.id?.in && !where.id.in.includes(p.id)) continue;
          products.delete(k);
          // cascade: variants, images, audits
          for (const [vk, v] of variants) if (v.productId === p.id) variants.delete(vk);
          for (const [ik, i] of images) if (i.productId === p.id) images.delete(ik);
          for (const [ak, a] of audits) if (a.productId === p.id) audits.delete(ak);
          removed++;
        }
        return { count: removed };
      },
    },

    productVariant: {
      async upsert({ where, update, create }: any) {
        const { productId, shopifyId } = where.productId_shopifyId;
        const k = vkey(productId, shopifyId);
        const existing = variants.get(k);
        if (existing) { Object.assign(existing, update); return existing; }
        const v: Variant = { id: cuid(), ...create };
        variants.set(k, v);
        return v;
      },
      async deleteMany({ where }: any) {
        let removed = 0;
        const keepShopifyIds = where?.NOT?.shopifyId?.in ? new Set(where.NOT.shopifyId.in) : null;
        for (const [k, v] of variants) {
          if (where.productId && v.productId !== where.productId) continue;
          if (where.shopifyId && v.shopifyId !== where.shopifyId) continue;
          if (keepShopifyIds?.has(v.shopifyId)) continue;
          variants.delete(k);
          removed++;
        }
        return { count: removed };
      },
    },

    productImage: {
      async findMany({ where, orderBy, select }: any = {}) {
        let out = [...images.values()];
        if (where?.productId) out = out.filter((i) => i.productId === where.productId);
        if (orderBy?.position === "asc") out.sort((a, b) => a.position - b.position);
        if (select) return out.map((i) => Object.fromEntries(Object.keys(select).map((k) => [k, (i as any)[k]])));
        return out;
      },
      async deleteMany({ where }: any) {
        let removed = 0;
        for (const [k, i] of images) {
          if (where.productId && i.productId !== where.productId) continue;
          images.delete(k);
          removed++;
        }
        return { count: removed };
      },
      async createMany({ data }: any) {
        for (const d of data) {
          const i: Image = { id: cuid(), ...d };
          images.set(i.id, i);
        }
        return { count: data.length };
      },
    },

    productAudit: {
      async upsert({ where, update, create }: any) {
        const { shopId, productId } = where.shopId_productId;
        const k = akey(shopId, productId);
        const existing = audits.get(k);
        if (existing) { Object.assign(existing, update); return existing; }
        const a: Audit = { id: cuid(), ...create };
        audits.set(k, a);
        return a;
      },
    },
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
