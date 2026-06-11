import type { PrismaClient } from "@stylique/db";
import { safeParseEventPayload, type EventName } from "@stylique/types";
import type { AnalyticsService, TrackInput } from "./index.js";

export function createAnalyticsService(prisma: PrismaClient): AnalyticsService {
  function validate(input: TrackInput): unknown {
    const parsed = safeParseEventPayload(input.name as EventName, input.payload);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  }

  return {
    async track(input) {
      const payload = validate(input);
      await prisma.analyticsEvent.create({
        data: {
          shopId: input.shopId,
          shopperId: input.shopperId,
          name: input.name,
          productId: input.productId,
          variantId: input.variantId,
          payload: payload as object,
          url: input.url,
          userAgent: input.userAgent,
          variantTag: input.variantTag ?? null,
        },
      });
    },

    async trackBatch(inputs) {
      const valid: TrackInput[] = [];
      const payloads: unknown[] = [];
      let rejected = 0;
      for (const i of inputs) {
        try { payloads.push(validate(i)); valid.push(i); }
        catch { rejected++; }
      }
      if (valid.length) {
        await prisma.analyticsEvent.createMany({
          data: valid.map((i, idx) => ({
            shopId: i.shopId,
            shopperId: i.shopperId,
            name: i.name,
            productId: i.productId,
            variantId: i.variantId,
            payload: payloads[idx] as object,
            url: i.url,
            userAgent: i.userAgent,
            variantTag: i.variantTag ?? null,
          })),
        });
      }
      return { accepted: valid.length, rejected };
    },
  };
}
