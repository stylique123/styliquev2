// Rate limiter — Redis-backed (multi-instance safe) with in-memory fallback.
// Limits: 60 req/min per shop, 20 req/min per shopper.
// Uses fixed-window counter: key = rl:{type}:{id}:{minute}

const REDIS_URL = process.env.REDIS_URL;

// Lazy-init Redis — only connect if URL is set. Uses dynamic `import()` (NOT
// require) because the app runs as an ES module — `require` is undefined and
// would throw a ReferenceError, 500-ing every rate-limited shopper endpoint.
let _redis: import("ioredis").Redis | null = null;
async function getRedis() {
  if (!REDIS_URL) return null;
  if (!_redis) {
    const mod = await import("ioredis");
    const Redis = (mod as { Redis?: typeof import("ioredis").Redis }).Redis
      ?? (mod as { default: typeof import("ioredis").Redis }).default;
    _redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    _redis.on("error", () => { _redis = null; }); // drop on connection error, fall back to memory
  }
  return _redis;
}

// In-memory fallback
const memBuckets = new Map<string, { count: number; resetAt: number }>();

export async function checkRateLimit(
  type: "shop" | "shopper",
  id: string,
  limitPerMin: number,
): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60000);
  const key = `rl:${type}:${id}:${minute}`;

  const redis = await getRedis();
  if (redis) {
    try {
      // Atomic pipeline: INCR + EXPIRE in one round-trip, no race window
      // where a key could persist forever if EXPIRE never fires (panel P1 #9).
      const pipe = redis.pipeline();
      pipe.incr(key);
      pipe.expire(key, 120);
      const res = await pipe.exec();
      const count = (res?.[0]?.[1] ?? 0) as number;
      return count <= limitPerMin;
    } catch { /* fall through to memory */ }
  }

  // Memory fallback
  const now = Date.now();
  const bucket = memBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    memBuckets.set(key, { count: 1, resetAt: now + 120000 });
    return true;
  }
  bucket.count++;
  return bucket.count <= limitPerMin;
}

// Idempotency guard — returns true if this key was ALREADY seen within ttlSec
// (so the caller should no-op). Shopify retries webhooks and can deliver the same
// X-Shopify-Webhook-Id more than once; without this, a single product edit can
// enqueue duplicate sync jobs. Redis SET NX EX is atomic; in-memory fallback
// covers single-instance dev. Fail-OPEN (treat as unseen) on any Redis error so
// a Redis blip never drops a real webhook.
const memSeen = new Map<string, number>();

// Out-of-band cleanup so the in-memory fallbacks can't grow unbounded when Redis
// is down or absent (panel P1 — memBuckets/memSeen OOM). Runs every 60s OFF the
// request hot path; `.unref()` so it never keeps the process alive on shutdown.
const _memPrune = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of memBuckets) if (b.resetAt < now) memBuckets.delete(k);
  for (const [k, exp] of memSeen) if (exp < now) memSeen.delete(k);
}, 60000);
if (typeof _memPrune?.unref === "function") _memPrune.unref();

export async function seenRecently(key: string, ttlSec = 60): Promise<boolean> {
  const k = `idemp:${key}`;
  const redis = await getRedis();
  if (redis) {
    try {
      // SET k 1 NX EX ttl → "OK" if newly set (NOT seen), null if it already existed (seen).
      const res = await redis.set(k, "1", "EX", ttlSec, "NX");
      return res === null;
    } catch { /* fall through to memory */ }
  }
  const now = Date.now();
  // prune
  for (const [mk, exp] of memSeen) if (exp < now) memSeen.delete(mk);
  if (memSeen.has(k)) return true;
  memSeen.set(k, now + ttlSec * 1000);
  return false;
}

export async function rateOk(shopDomain: string, cookieId: string | null): Promise<boolean> {
  const [shopOk, shopperOk] = await Promise.all([
    checkRateLimit("shop", shopDomain, 60),
    cookieId ? checkRateLimit("shopper", cookieId, 20) : Promise.resolve(true),
  ]);
  return shopOk && shopperOk;
}
