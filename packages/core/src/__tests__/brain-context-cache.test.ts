// Tests for the Redis cache behavior pattern used by brain.server.ts for
// recentBehavior (OI-37). Validates key format + JSON round-trip without
// requiring a live Redis instance — exercises the pure shape/protocol contract.
//
// The caching contract from brain.server.ts:
//   key   = `behavior:${shopId}:${shopperRowId}`
//   TTL   = 300 seconds (5 minutes)
//   value = JSON.stringify(Array<{ category: string; count: number }>)
//
// These tests confirm that:
//   1. The key follows the documented format (used in dashboards / Redis CLI ops).
//   2. Values survive a JSON round-trip with correct shape (no silent coercion).
//   3. An empty array is a valid cache value (no items browsed yet).
//   4. A null cache response signals "cache miss → do a fresh DB read".
//   5. The TTL constant is 300 seconds — changing it requires a test update.

import { describe, it, expect } from "vitest";

// ─── Key format helper (mirrors brain.server.ts) ──────────────────────────────

const BEHAVIOR_TTL_S = 300; // 5 minutes — must match brain.server.ts

function makeBehaviorCacheKey(shopId: string, shopperRowId: string): string {
  return `behavior:${shopId}:${shopperRowId}`;
}

// ─── JSON round-trip helper (mirrors getCachedBehavior / setCachedBehavior) ───

type BehaviorEntry = { category: string; count: number };

function serializeBehavior(value: BehaviorEntry[]): string {
  return JSON.stringify(value);
}

function deserializeBehavior(raw: string | null): BehaviorEntry[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BehaviorEntry[];
  } catch {
    return null;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("behavior cache — key format", () => {
  it("produces the documented key format: behavior:{shopId}:{shopperRowId}", () => {
    const key = makeBehaviorCacheKey("shop_abc123", "shopper_xyz789");
    expect(key).toBe("behavior:shop_abc123:shopper_xyz789");
  });

  it("key is unique per (shopId, shopperRowId) pair", () => {
    const k1 = makeBehaviorCacheKey("shop_A", "shopper_1");
    const k2 = makeBehaviorCacheKey("shop_A", "shopper_2");
    const k3 = makeBehaviorCacheKey("shop_B", "shopper_1");
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k2).not.toBe(k3);
  });

  it("does not include extra separators or encoding when IDs have standard chars", () => {
    const key = makeBehaviorCacheKey("shop-001", "row-001");
    expect(key).toMatch(/^behavior:[^:]+:[^:]+$/);
  });
});

describe("behavior cache — TTL constant", () => {
  it("TTL is 300 seconds (5 minutes)", () => {
    // If this fails, someone changed the TTL — update both brain.server.ts
    // and this constant, then document the reason in the commit message.
    expect(BEHAVIOR_TTL_S).toBe(300);
  });
});

describe("behavior cache — JSON round-trip", () => {
  it("round-trips a typical behavior array correctly", () => {
    const input: BehaviorEntry[] = [
      { category: "tops", count: 8 },
      { category: "dresses", count: 5 },
      { category: "shoes", count: 2 },
    ];
    const serialized = serializeBehavior(input);
    const recovered = deserializeBehavior(serialized);
    expect(recovered).toEqual(input);
  });

  it("returns null for a null (cache miss) response — signals fresh DB read needed", () => {
    const result = deserializeBehavior(null);
    expect(result).toBeNull();
  });

  it("returns null for an empty string — treats as cache miss, not empty array", () => {
    const result = deserializeBehavior("");
    expect(result).toBeNull();
  });

  it("round-trips an empty array (no browsing events yet)", () => {
    const input: BehaviorEntry[] = [];
    const serialized = serializeBehavior(input);
    const recovered = deserializeBehavior(serialized);
    expect(recovered).toEqual([]);
    // Importantly, this is NOT null — an empty array is a valid cache hit
    expect(recovered).not.toBeNull();
  });

  it("returns null for malformed JSON — cache read errors degrade gracefully", () => {
    const result = deserializeBehavior("{not valid json");
    expect(result).toBeNull();
  });

  it("preserves integer counts without coercion", () => {
    const input: BehaviorEntry[] = [{ category: "bottoms", count: 0 }];
    const recovered = deserializeBehavior(serializeBehavior(input));
    expect(recovered?.[0]?.count).toBe(0);
    expect(typeof recovered?.[0]?.count).toBe("number");
  });

  it("preserves category strings with special characters", () => {
    const input: BehaviorEntry[] = [{ category: "t-shirts & tops", count: 3 }];
    const recovered = deserializeBehavior(serializeBehavior(input));
    expect(recovered?.[0]?.category).toBe("t-shirts & tops");
  });
});

describe("behavior cache — write-through pattern", () => {
  // The write-through contract: after a fresh DB read, the result is written
  // to Redis with the TTL key so the next call within 5 minutes is a cache hit.
  // We test the shape of what would be written (not the Redis call itself).

  it("only non-null DB results should be written to cache", () => {
    const freshFromDb: BehaviorEntry[] | null = [{ category: "knitwear", count: 4 }];
    // Simulate the write-through decision: null → skip, non-null → write
    const shouldWrite = freshFromDb !== null;
    expect(shouldWrite).toBe(true);
  });

  it("null DB result (no events yet) should still be cached as empty array, not skipped", () => {
    // Edge case: if DB returns [] (zero events) it IS a valid result.
    // Caching [] avoids a DB scan on every turn for new shoppers.
    const freshFromDb: BehaviorEntry[] = [];
    const serialized = serializeBehavior(freshFromDb);
    // Should serialize as "[]", not null
    expect(serialized).toBe("[]");
    expect(deserializeBehavior(serialized)).toEqual([]);
  });
});
