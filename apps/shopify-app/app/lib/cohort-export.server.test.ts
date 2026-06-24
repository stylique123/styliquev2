import { describe, expect, it } from "vitest";
import { cohortCartFlags } from "./cohort-export.server";

describe("cohort export cart flags", () => {
  it("does not treat cart intent as a completed cart action", () => {
    expect(cohortCartFlags(new Set(["CHAT_CART_REQUESTED"]))).toEqual({
      hadCart: false,
      hadCartIntent: true,
    });
  });

  it("keeps successful cart-origin events separate from intent", () => {
    expect(cohortCartFlags(new Set(["CART_FROM_MIRA"]))).toEqual({
      hadCart: true,
      hadCartIntent: false,
    });
  });
});
