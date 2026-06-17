import { describe, it, expect } from "vitest";
import {
  canTransition, stateToDbStatus, resolveTerminalState,
  classifyRenderHonesty, honestTryOnLabel,
  sizingConfidenceLevel, stripFitGuarantee,
  classifyFitFeedback, buildFitFeedback,
} from "../tryon/trust.js";

describe("render state machine (P3-T05)", () => {
  it("allows valid transitions and rejects invalid ones", () => {
    expect(canTransition("requested", "queued")).toBe(true);
    expect(canTransition("rendering", "completed")).toBe(true);
    expect(canTransition("completed", "rendering")).toBe(false); // no going back
    expect(canTransition("failed", "completed")).toBe(false);    // terminal
    expect(canTransition("blocked", "completed")).toBe(false);
  });

  it("maps states to the DB JobStatus", () => {
    expect(stateToDbStatus("requested")).toBe("PENDING");
    expect(stateToDbStatus("queued")).toBe("PENDING");
    expect(stateToDbStatus("rendering")).toBe("RUNNING");
    expect(stateToDbStatus("completed")).toBe("SUCCEEDED");
    expect(stateToDbStatus("failed")).toBe("FAILED");
    expect(stateToDbStatus("expired")).toBe("FAILED");
    expect(stateToDbStatus("blocked")).toBe("FAILED");
  });

  it("NO fake success — completed requires real output", () => {
    expect(resolveTerminalState({ hadError: false, timedOut: false, invalidInput: false, outputUrl: "x.png" }))
      .toEqual({ state: "completed", errorClass: null });
    // no output → failed, never completed
    expect(resolveTerminalState({ hadError: false, timedOut: false, invalidInput: false, outputUrl: null }).state).toBe("failed");
    expect(resolveTerminalState({ hadError: false, timedOut: true, invalidInput: false, outputUrl: "x.png" }).state).toBe("failed");
    expect(resolveTerminalState({ hadError: true, timedOut: false, invalidInput: false, outputUrl: "x.png" }).state).toBe("failed");
    // invalid input → blocked (never completed)
    expect(resolveTerminalState({ hadError: false, timedOut: false, invalidInput: true, outputUrl: "x.png" }).state).toBe("blocked");
  });
});

describe("render honesty classifier (P3-T04 + product rule)", () => {
  it("varying ease across sizes → fit-visual", () => {
    const r = classifyRenderHonesty([
      { size: "S", easeCm: -5 }, { size: "M", easeCm: 2 }, { size: "L", easeCm: 12 },
    ]);
    expect(r.honesty).toBe("fit-visual");
    expect(r.distinctEaseBuckets).toBeGreaterThanOrEqual(2);
  });
  it("identical ease across sizes → style-preview-only (no fake fit)", () => {
    const r = classifyRenderHonesty([
      { size: "S", easeCm: 2 }, { size: "M", easeCm: 2 }, { size: "L", easeCm: 3 },
    ]);
    expect(r.honesty).toBe("style-preview-only");
    expect(honestTryOnLabel(r.honesty)).toMatch(/style preview/i);
  });
  it("no valid ease → failed", () => {
    expect(classifyRenderHonesty([{ size: "S", easeCm: null }]).honesty).toBe("failed");
  });
});

describe("sizing confidence levels (P3-T08)", () => {
  it("no chart + no body → unavailable (honest, never guesses)", () => {
    const r = sizingConfidenceLevel({ hasSizeChart: false, hasMeasurements: false, hasHeightWeight: false });
    expect(r.level).toBe("unavailable");
    expect(r.honestLine).toMatch(/can.?t size it accurately|don't have/i);
  });
  it("chart + measurements → high", () => {
    expect(sizingConfidenceLevel({ hasSizeChart: true, hasMeasurements: true, hasHeightWeight: true }).level).toBe("high");
  });
  it("chart OR measurements alone → medium", () => {
    expect(sizingConfidenceLevel({ hasSizeChart: true, hasMeasurements: false, hasHeightWeight: false }).level).toBe("medium");
    expect(sizingConfidenceLevel({ hasSizeChart: false, hasMeasurements: true, hasHeightWeight: false }).level).toBe("medium");
  });
  it("only height/weight → low (estimate, not a guarantee)", () => {
    expect(sizingConfidenceLevel({ hasSizeChart: false, hasMeasurements: false, hasHeightWeight: true }).level).toBe("low");
  });
  it("strips fit-guarantee language", () => {
    expect(stripFitGuarantee("This will fit you exactly, guaranteed!")).not.toMatch(/guarantee|exactly/i);
    expect(stripFitGuarantee("A relaxed shirt with room.")).toBe("A relaxed shirt with room.");
  });
});

describe("fit feedback / return reason (P3-T10) — hook only", () => {
  it("classifies common fit complaints", () => {
    expect(classifyFitFeedback("the chest was way too tight")).toBe("tight_chest");
    expect(classifyFitFeedback("it ran too small")).toBe("too_small");
    expect(classifyFitFeedback("sleeves were too long")).toBe("too_long");
    expect(classifyFitFeedback("the colour didn't match the photo")).toBe("wrong_color");
    expect(classifyFitFeedback("just changed my mind")).toBe("changed_mind");
    expect(classifyFitFeedback("something random")).toBe("other");
  });
  it("flags a return/exchange request for safe handoff — never automates", () => {
    const f = buildFitFeedback({ text: "too small, I want to return it", productHandle: "linen-shirt", size: "M" });
    expect(f.reason).toBe("too_small");
    expect(f.needsHandoff).toBe(true);
    expect(f.productHandle).toBe("linen-shirt");
  });
  it("captures feedback without a handoff when no action requested", () => {
    const f = buildFitFeedback({ text: "the waist was a bit tight", productHandle: null, size: null });
    expect(f.reason).toBe("tight_waist");
    expect(f.needsHandoff).toBe(false);
  });
});
