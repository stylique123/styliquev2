import { Badge, BlockStack, Box, Card, InlineStack, Text } from "@shopify/polaris";

type UsageRow = { used: number; cap: number | null; remaining: number | null };

export type DashboardPlanUsage = {
  tier: string;
  usage: Record<string, UsageRow | undefined>;
};

export const EMBEDDED_USAGE_METERS = [
  ["TRYON_PERSONAL", "Personal try-ons"],
  ["TRYON_BODY", "Body-model try-ons"],
  ["STYLE_RECOMMENDATION", "Style recommendations"],
  ["FIT_RECOMMENDATION", "Fit recommendations"],
  ["VISION_TURN", "Mira vision turns"],
  ["STYLIST_TURN", "Mira chat turns"],
] as const;

export function embeddedUsageValue(row: UsageRow | undefined) {
  if (!row) return "0 / 0";
  if (row.cap == null) return `${row.used.toLocaleString()} / Unlimited`;
  return `${row.used.toLocaleString()} / ${row.cap.toLocaleString()}`;
}

export function embeddedUsageTone(row: UsageRow | undefined): "success" | "attention" | "critical" {
  if (!row || row.cap == null || row.cap <= 0) return "success";
  const ratio = row.used / row.cap;
  if (ratio >= 1) return "critical";
  if (ratio >= 0.8) return "attention";
  return "success";
}

export function DashboardPlanUsageCard({ plan }: { plan: DashboardPlanUsage }) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Plan usage</Text>
          <Badge tone="info">{plan.tier}</Badge>
        </InlineStack>
        <Text as="p" tone="subdued" variant="bodySm">
          Current billing period. Unlimited meters still show usage so you can see activity without treating it as a cap.
        </Text>
        <InlineStack gap="400" wrap>
          {EMBEDDED_USAGE_METERS.map(([metric, label]) => {
            const row = plan.usage[metric];
            return (
              <Box key={metric} background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued" variant="bodyXs">{label}</Text>
                    <Badge tone={embeddedUsageTone(row)}>{row?.cap == null ? "Unlimited" : `${row?.remaining ?? 0} left`}</Badge>
                  </InlineStack>
                  <Text as="span" variant="headingMd">{embeddedUsageValue(row)}</Text>
                </BlockStack>
              </Box>
            );
          })}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
