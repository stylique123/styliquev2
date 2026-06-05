// ToolRegistry — single source of truth for every tool the Brain can call.
//
// Tools register themselves; the Brain queries by name + filters by tier and
// feature flag. New tool? Add one object. No model adapter ever changes.

import type { ToolDef, BrainContext } from "./types.js";
import type { PlanTier } from "@stylique/types";
import { readFeatureFlag } from "@stylique/core/src/plans/features";

const tierRank = (t: PlanTier): number => (t === "STARTER" ? 1 : t === "GROWTH" ? 2 : 3);

export class ToolRegistry {
  private byName = new Map<string, ToolDef>();

  register<TArgs, TResult>(tool: ToolDef<TArgs, TResult>): void {
    if (this.byName.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.byName.set(tool.name, tool as ToolDef);
  }

  registerMany(tools: ToolDef[]): void {
    for (const t of tools) this.register(t);
  }

  get(name: string): ToolDef | undefined {
    return this.byName.get(name);
  }

  // Tools visible to the model for THIS shopper this turn. Hidden if:
  //   • Above shop's tier
  //   • Required feature is disabled on the shop's plan
  //   • Marked unimplemented and the agent shouldn't be told about it
  //     (we KEEP unimplemented tools listed so the model knows they exist —
  //      the brain returns a friendly "coming soon" when invoked.)
  visibleFor(ctx: BrainContext): ToolDef[] {
    const features = ctx.features;
    const tier = ctx.tier;
    const out: ToolDef[] = [];
    for (const t of this.byName.values()) {
      if (t.minTier && tierRank(tier) < tierRank(t.minTier)) continue;
      if (t.requiresFeature && !readFeatureFlag(features, t.requiresFeature)) continue;
      out.push(t);
    }
    return out;
  }

  list(): ToolDef[] {
    return [...this.byName.values()];
  }
}

// `readFeatureFlag` lives in @stylique/core (single source). Pre-Sprint-6
// it was duplicated here with a "keep in sync" comment that drifted —
// e.g. `studio.api`, `studio.autoFromGaps`, `widget.sizeChartCustomization`,
// and the analytics + recommendations keys were missing from this copy.
// Importing from core fixes that for good. (C2, Sprint 6 audit round 2.)
