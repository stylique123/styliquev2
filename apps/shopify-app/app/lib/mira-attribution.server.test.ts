import { describe, expect, it } from "vitest";
import { assistedProductIdsForOrder } from "./mira-attribution.server";

describe("assistedProductIdsForOrder", () => {
  it("matches legacy direct productId assist events against order lines", () => {
    expect(
      assistedProductIdsForOrder(["prod-dress"], [
        { productId: "prod-dress", payload: null },
      ]),
    ).toEqual(["prod-dress"]);
  });

  it("matches confirmed CART_FROM_MIRA payload productId evidence", () => {
    expect(
      assistedProductIdsForOrder(["prod-dress"], [
        { productId: null, payload: { productId: "prod-dress" } },
      ]),
    ).toEqual(["prod-dress"]);
  });

  it("matches outfit and combo events that carry multiple product ids in payload", () => {
    expect(
      assistedProductIdsForOrder(["prod-dress", "prod-shoe"], [
        { productId: null, payload: { productIds: ["prod-dress", "prod-bag", "prod-shoe"] } },
      ]),
    ).toEqual(["prod-dress", "prod-shoe"]);
  });

  it("ignores assist evidence for products that were not fulfilled in the order", () => {
    expect(
      assistedProductIdsForOrder(["prod-dress"], [
        { productId: "prod-coat", payload: { productId: "prod-bag", productIds: ["prod-shoe"] } },
      ]),
    ).toEqual([]);
  });

  it("deduplicates products across direct and payload evidence", () => {
    expect(
      assistedProductIdsForOrder(["prod-dress"], [
        { productId: "prod-dress", payload: { productId: "prod-dress", productIds: ["prod-dress"] } },
      ]),
    ).toEqual(["prod-dress"]);
  });
});
