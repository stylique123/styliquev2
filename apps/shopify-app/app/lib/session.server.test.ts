import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  shopperSession: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
}));

vi.mock("../db.server", () => ({ prisma: db }));

import { getOrCreateShopperSession, persistMiraObjective, readMiraObjective } from "./session.server";

describe("getOrCreateShopperSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.shopperSession.update.mockResolvedValue({});
  });

  it("reuses a cookie only for the same Shopify tenant", async () => {
    db.shopperSession.findUnique.mockResolvedValue({
      id: "row-1",
      sessionId: "cookie-session",
      shopifyDomain: "one.myshopify.com",
    });

    const result = await getOrCreateShopperSession({
      shopifyDomain: "one.myshopify.com",
      cookieId: "cookie-session",
    });

    expect(result).toEqual({
      row: { id: "row-1", sessionId: "cookie-session", shopifyDomain: "one.myshopify.com" },
      setCookie: null,
    });
    expect(db.shopperSession.create).not.toHaveBeenCalled();
  });

  it("mints a new globally unique identity when the cookie belongs to another tenant", async () => {
    db.shopperSession.findUnique.mockResolvedValue({
      id: "row-1",
      sessionId: "cookie-session",
      shopifyDomain: "one.myshopify.com",
    });
    db.shopperSession.create.mockImplementation(async ({ data }: { data: { sessionId: string; shopifyDomain: string } }) => ({
      id: "row-2",
      sessionId: data.sessionId,
    }));

    const result = await getOrCreateShopperSession({
      shopifyDomain: "two.myshopify.com",
      cookieId: "cookie-session",
    });

    const created = db.shopperSession.create.mock.calls[0]?.[0]?.data;
    expect(created.shopifyDomain).toBe("two.myshopify.com");
    expect(created.sessionId).not.toBe("cookie-session");
    expect(result.setCookie).toContain(`sq_shopper_id=${created.sessionId}`);
  });
});

describe("Mira objective persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the server-canonical objective from ShopperSession", async () => {
    db.$queryRaw.mockResolvedValue([{ miraObjectiveJson: { mission: "wedding guest", rejectedHandles: ["red-dress"] } }]);

    await expect(readMiraObjective("shopper-1")).resolves.toEqual({
      mission: "wedding guest",
      rejectedHandles: ["red-dress"],
    });
  });

  it("ignores missing or non-object objective rows", async () => {
    db.$queryRaw.mockResolvedValue([{ miraObjectiveJson: null }]);
    await expect(readMiraObjective("shopper-1")).resolves.toBeNull();

    db.$queryRaw.mockResolvedValue([{ miraObjectiveJson: ["not", "an", "objective"] }]);
    await expect(readMiraObjective("shopper-1")).resolves.toBeNull();
  });

  it("persists object objectives and skips invalid payloads", async () => {
    db.$executeRaw.mockResolvedValue(1);

    await persistMiraObjective("shopper-1", { mission: "workwear", lastRecommendedHandle: "linen-shirt" });
    await persistMiraObjective("shopper-1", null);
    await persistMiraObjective("shopper-1", "not-json-object");

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
