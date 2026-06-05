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
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 120);
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

export async function rateOk(shopDomain: string, cookieId: string | null): Promise<boolean> {
  const [shopOk, shopperOk] = await Promise.all([
    checkRateLimit("shop", shopDomain, 60),
    cookieId ? checkRateLimit("shopper", cookieId, 20) : Promise.resolve(true),
  ]);
  return shopOk && shopperOk;
}
