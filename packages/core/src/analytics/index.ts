// Analytics ingest contract. Every module emits through AnalyticsService — never write AnalyticsEvent rows directly.

export interface TrackInput {
  shopId: string;
  shopperId?: string;
  name: import("@stylique/types").EventName;
  productId?: string;
  variantId?: string;
  payload: unknown;
  url?: string;
  userAgent?: string;
  // A/B variant tag — "<experimentKey>:<variantKey>" or "|"-joined for
  // multiple concurrent experiments. Null/undefined when shopper is in no
  // active experiment.
  variantTag?: string | null;
}

export interface AnalyticsService {
  track(input: TrackInput): Promise<void>;
  trackBatch(inputs: TrackInput[]): Promise<{ accepted: number; rejected: number }>;
}

// Materialized dashboard views. Names must stay in sync with the rollup worker.
export const DASHBOARD_VIEWS = [
  "tryons_by_day",
  "tryon_completion_rate",
  "size_recommendation_accuracy",
  "size_up_down_distribution",
  "outfit_click_rate",
  "color_combo_engagement",
  "creative_impressions_by_set",
  "pdp_improvement_opportunities",
] as const;
