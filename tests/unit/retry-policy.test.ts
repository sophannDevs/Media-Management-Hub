import { describe, expect, it } from "vitest";
import { backoffMs, MAX_DELAY_MS, retryPlan } from "@/lib/workflow/retry-policy";

// PUB-08: one retry rule per error code, a hard cap, and a reason for each decision.

const NOW = new Date("2026-10-15T12:00:00Z");
const settings = { autoRetry: true, maxRetries: 3, retryDelayMinutes: 15 };
const mid = () => 0.5; // no jitter
const plan = (over: Partial<Parameters<typeof retryPlan>[0]>) => retryPlan({ code: "NETWORK", retryable: true, autoRetries: 0, settings, now: NOW, random: mid, ...over });
const minutesLater = (p: ReturnType<typeof retryPlan>) => (p.at!.getTime() - NOW.getTime()) / 60_000;

describe("retry policy (PUB-08)", () => {
  it.each([
    ["AUTH", { pauseAccount: true, needsAttention: true }],
    ["VALIDATION", { pauseAccount: false, needsAttention: true }],
    ["UNKNOWN", { pauseAccount: false, needsAttention: true }],
  ] as const)("%s is never retried automatically", (code, flags) => {
    const p = plan({ code, retryable: true });
    expect(p).toMatchObject({ retry: false, at: null, ...flags });
    expect(p.reason).toMatch(new RegExp(`^${code}: `));
  });

  it("backs off exponentially from the configured delay for network failures, with jitter, capped at 6 h", () => {
    expect(minutesLater(plan({ autoRetries: 0 }))).toBe(15);
    expect(minutesLater(plan({ autoRetries: 1 }))).toBe(30);
    expect(minutesLater(plan({ autoRetries: 2 }))).toBe(60);
    expect(plan({ autoRetries: 2 }).reason).toBe("NETWORK: temporary failure, backing off; automatic retry 3 of 3 in 1 h");
    expect(backoffMs(15, 0, () => 0)).toBe(12 * 60_000); // -20%
    expect(backoffMs(15, 0, () => 1)).toBe(18 * 60_000); // +20%
    expect(backoffMs(15, 9, mid)).toBe(MAX_DELAY_MS);
    expect(backoffMs(0, 0, mid)).toBe(60_000); // a zero setting still waits a minute
  });

  it("honours the platform's Retry-After for rate limits, and backs off without one", () => {
    const told = plan({ code: "RATE", retryAfterSeconds: 90 });
    expect(told.retry).toBe(true);
    expect(told.at!.getTime() - NOW.getTime()).toBe(90_000);
    expect(told.reason).toMatch(/asked to wait 2 min/);
    expect(minutesLater(plan({ code: "RATE", autoRetries: 1 }))).toBe(30);
    expect(plan({ code: "RATE", retryAfterSeconds: 10 * 3_600 }).at!.getTime() - NOW.getTime()).toBe(MAX_DELAY_MS);
  });

  it("waits for the quota reset when the provider knows it, an hour otherwise", () => {
    const reset = new Date("2026-10-15T15:30:00Z");
    const known = plan({ code: "QUOTA", quotaResetAt: reset });
    expect(known.at).toEqual(reset);
    expect(known.reason).toMatch(/waiting for the quota to reset; automatic retry 1 of 3 in 3.5 h/);
    expect(minutesLater(plan({ code: "QUOTA" }))).toBe(60);
    // A reset that already passed still waits a minute, not zero
    expect(minutesLater(plan({ code: "QUOTA", quotaResetAt: new Date(NOW.getTime() - 1) }))).toBe(1);
  });

  it("checks an unknown outcome with the platform after a minute, while the budget lasts", () => {
    const p = plan({ code: "UNKNOWN_OUTCOME", retryable: true });
    expect(minutesLater(p)).toBe(1);
    expect(p.reason).toMatch(/asked first whether the post went out/);
    const spent = plan({ code: "UNKNOWN_OUTCOME", retryable: true, autoRetries: 3 });
    expect(spent).toMatchObject({ retry: false, needsAttention: true });
    expect(spent.reason).toMatch(/no automatic retries left \(3 used\); check the platform/);
  });

  it("stops at the cap, respects the switch, and says why", () => {
    expect(plan({ autoRetries: 3 })).toMatchObject({ retry: false, needsAttention: true, reason: "NETWORK: no automatic retries left (3 used)" });
    expect(plan({ settings: { ...settings, autoRetry: false } })).toMatchObject({ retry: false, reason: "NETWORK: automatic retries are off" });
    expect(plan({ code: "QUOTA", retryable: false })).toMatchObject({ retry: false, reason: "QUOTA: not retried automatically" });
  });
});
