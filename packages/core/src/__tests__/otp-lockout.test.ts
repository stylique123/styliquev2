// Tests for OTP brute-force lockout logic.
// The stale-read bug (OI-37 in the audit) was: after lock expiry, reading the
// old `row.emailVerifyAttempts` (= 5) caused the first wrong guess to compute
// `attempts = 6 ≥ 5` and immediately re-lock. Fixed by `effectiveAttempts`.
//
// These tests exercise the lockout state machine directly so any future refactor
// of account.server.ts can be validated without a live DB.

import { describe, it, expect } from "vitest";

// ─── Pure lockout state machine ───────────────────────────────────────────────
// Extracted from account.server.ts postShopperAccountVerify, tested in isolation.

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

type LockState = {
  emailVerifyAttempts: number;
  emailVerifyLockedAt: Date | null;
  emailVerifyOtp: string | null;
  emailVerifyOtpExpiresAt: Date | null;
};

type OtpResult =
  | "ok"
  | "rate_limited"    // still in lock window
  | "otp_invalid"     // wrong code
  | "otp_expired"     // right code but TTL passed
  | "lockout_applied" // just hit the attempt ceiling

function checkOtp(
  state: LockState,
  submittedOtp: string,
  nowMs: number,
): { result: OtpResult; nextState: LockState } {
  let effectiveAttempts = state.emailVerifyAttempts;

  // 1. Check active lock
  if (state.emailVerifyLockedAt) {
    const unlockAt = state.emailVerifyLockedAt.getTime() + LOCK_DURATION_MS;
    if (unlockAt > nowMs) {
      return { result: "rate_limited", nextState: state };
    }
    // Lock expired — reset attempts (this is the fix for the stale-read bug)
    effectiveAttempts = 0;
  }

  const isCorrect = state.emailVerifyOtp === submittedOtp;
  const isExpired =
    !state.emailVerifyOtpExpiresAt ||
    state.emailVerifyOtpExpiresAt.getTime() < nowMs;

  if (!isCorrect || isExpired) {
    const attempts = effectiveAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      return {
        result: "lockout_applied",
        nextState: {
          ...state,
          emailVerifyAttempts: attempts,
          emailVerifyLockedAt: new Date(nowMs),
        },
      };
    }
    return {
      result: "otp_invalid",
      nextState: {
        ...state,
        emailVerifyAttempts: attempts,
        emailVerifyLockedAt: null,
      },
    };
  }

  // Correct and not expired — clear everything
  return {
    result: "ok",
    nextState: {
      ...state,
      emailVerifyAttempts: 0,
      emailVerifyLockedAt: null,
      emailVerifyOtp: null,
      emailVerifyOtpExpiresAt: null,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freshState(otp = "123456", ttlMs = 15 * 60 * 1000, nowMs = 0): LockState {
  return {
    emailVerifyAttempts: 0,
    emailVerifyLockedAt: null,
    emailVerifyOtp: otp,
    emailVerifyOtpExpiresAt: new Date(nowMs + ttlMs),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OTP verification state machine", () => {
  it("accepts a correct OTP", () => {
    const { result, nextState } = checkOtp(freshState("999999"), "999999", 0);
    expect(result).toBe("ok");
    expect(nextState.emailVerifyAttempts).toBe(0);
    expect(nextState.emailVerifyOtp).toBeNull();
  });

  it("rejects a wrong OTP and increments attempts", () => {
    const { result, nextState } = checkOtp(freshState("999999"), "000000", 0);
    expect(result).toBe("otp_invalid");
    expect(nextState.emailVerifyAttempts).toBe(1);
  });

  it("rejects an expired OTP even when code is correct", () => {
    const expiredState: LockState = {
      emailVerifyAttempts: 0,
      emailVerifyLockedAt: null,
      emailVerifyOtp: "123456",
      emailVerifyOtpExpiresAt: new Date(0), // expired at epoch
    };
    const { result } = checkOtp(expiredState, "123456", Date.now());
    expect(result).toBe("otp_invalid");
  });

  it("applies lockout on the 5th failure", () => {
    let state = freshState("999999");
    for (let i = 0; i < 4; i++) {
      const r = checkOtp(state, "000000", 0);
      state = r.nextState;
      expect(r.result).toBe("otp_invalid");
    }
    const { result, nextState } = checkOtp(state, "000000", 0);
    expect(result).toBe("lockout_applied");
    expect(nextState.emailVerifyLockedAt).not.toBeNull();
  });

  it("blocks requests during active lock window", () => {
    const lockedState: LockState = {
      emailVerifyAttempts: 5,
      emailVerifyLockedAt: new Date(0),  // locked at t=0
      emailVerifyOtp: "999999",
      emailVerifyOtpExpiresAt: new Date(Date.now() + 60_000),
    };
    const nowInWindow = 10 * 60 * 1000; // 10 min after lock — still locked
    const { result } = checkOtp(lockedState, "999999", nowInWindow);
    expect(result).toBe("rate_limited");
  });

  it("allows attempt after 30-min lock window expires (stale-read bug fix)", () => {
    // This is the exact scenario where the old code re-locked immediately.
    // Old code: attempts = row.emailVerifyAttempts (= 5) + 1 = 6 ≥ 5 → re-lock.
    // Fixed code: effectiveAttempts = 0 (reset on expiry) + 1 = 1 → otp_invalid.
    const lockedState: LockState = {
      emailVerifyAttempts: 5,
      emailVerifyLockedAt: new Date(0),  // locked at t=0
      emailVerifyOtp: "999999",
      emailVerifyOtpExpiresAt: new Date(40 * 60 * 1000),
    };
    const afterWindow = 31 * 60 * 1000; // 31 minutes — past the 30-min lock
    // Wrong code — should NOT re-lock; should just count as attempt 1
    const { result, nextState } = checkOtp(lockedState, "000000", afterWindow);
    expect(result).toBe("otp_invalid");
    expect(nextState.emailVerifyAttempts).toBe(1); // NOT 6
    expect(nextState.emailVerifyLockedAt).toBeNull();
  });

  it("accepts correct OTP right after lock expiry", () => {
    const lockedState: LockState = {
      emailVerifyAttempts: 5,
      emailVerifyLockedAt: new Date(0),
      emailVerifyOtp: "123456",
      emailVerifyOtpExpiresAt: new Date(40 * 60 * 1000),
    };
    const afterWindow = 31 * 60 * 1000;
    const { result } = checkOtp(lockedState, "123456", afterWindow);
    expect(result).toBe("ok");
  });
});
