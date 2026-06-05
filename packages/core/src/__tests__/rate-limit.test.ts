// Rate limit logic — tests the in-memory fallback path (no Redis in CI).
// The Redis path is integration-tested in the live-test checklist.

import { describe, it, expect, beforeEach } from "vitest";

// We test the fixed-window bucketing math directly, not through the
// ioredis client, so we can run these tests without a Redis server.

function makeBucket() {
  const mem = new Map<string, { count: number; resetAt: number }>();

  function check(key: string, limitPerMin: number, nowMs: number): boolean {
    const bucket = mem.get(key);
    if (!bucket || bucket.resetAt < nowMs) {
      mem.set(key, { count: 1, resetAt: nowMs + 120_000 });
      return true;
    }
    bucket.count++;
    return bucket.count <= limitPerMin;
  }

  return { check, mem };
}

describe("rate-limit in-memory bucket", () => {
  let b: ReturnType<typeof makeBucket>;
  beforeEach(() => { b = makeBucket(); });

  it("allows first request", () => {
    expect(b.check("shop:x:0", 60, 0)).toBe(true);
  });

  it("allows up to the limit", () => {
    for (let i = 0; i < 60; i++) expect(b.check("shop:x:0", 60, 0)).toBe(true);
  });

  it("blocks the 61st request", () => {
    for (let i = 0; i < 60; i++) b.check("shop:x:0", 60, 0);
    expect(b.check("shop:x:0", 60, 0)).toBe(false);
  });

  it("resets after the window (2 minutes)", () => {
    for (let i = 0; i < 61; i++) b.check("shop:x:0", 60, 0);
    expect(b.check("shop:x:0", 60, 0)).toBe(false);
    // 121 seconds later — past the 120s window
    expect(b.check("shop:x:0", 60, 121_000)).toBe(true);
  });

  it("shop and shopper buckets are independent", () => {
    for (let i = 0; i < 20; i++) b.check("shopper:y:0", 20, 0);
    // Shopper exhausted
    expect(b.check("shopper:y:0", 20, 0)).toBe(false);
    // Shop bucket untouched
    expect(b.check("shop:x:0", 60, 0)).toBe(true);
  });

  it("per-minute keys isolate windows correctly", () => {
    const min0 = 0;
    const min1 = 60_000;
    for (let i = 0; i < 60; i++) b.check(`rl:shop:x:${Math.floor(min0 / 60_000)}`, 60, min0);
    expect(b.check(`rl:shop:x:${Math.floor(min0 / 60_000)}`, 60, min0)).toBe(false);
    // New minute = new key = fresh window
    expect(b.check(`rl:shop:x:${Math.floor(min1 / 60_000)}`, 60, min1)).toBe(true);
  });
});
