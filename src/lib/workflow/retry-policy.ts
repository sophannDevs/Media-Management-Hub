import type { PublishErrorCode } from "@/lib/platforms/types";

// How a failed attempt is retried (PUB-08): one rule per error code, a hard
// cap on automatic attempts, and a reason for every decision that goes on the
// attempt row. Pure: the publisher passes in what it knows and applies the
// answer.

export interface RetryInput {
  code: PublishErrorCode;
  /** The provider's view: can an automatic retry succeed without a person? */
  retryable: boolean;
  /** Automatic retries already spent since the last action by a person */
  autoRetries: number;
  settings: { autoRetry: boolean; maxRetries: number; retryDelayMinutes: number };
  /** Seconds the platform asked us to wait (a Retry-After header), when it said */
  retryAfterSeconds?: number | null;
  /** When the platform's quota resets, when the provider knows */
  quotaResetAt?: Date | null;
  now?: Date;
  /** Deterministic jitter for tests (0..1); random otherwise */
  random?: () => number;
}

export interface RetryPlan {
  retry: boolean;
  /** When the next automatic attempt is due (null when there is none) */
  at: Date | null;
  /** One line for the attempt row and the log */
  reason: string;
  /** The account's sign-in is dead: pause it and tell the owner */
  pauseAccount: boolean;
  /** Nothing automatic will fix this: a person has to look */
  needsAttention: boolean;
}

/** Automatic waits never exceed this (6 hours), whatever the backoff says. */
export const MAX_DELAY_MS = 6 * 3_600_000;
/** A quota the provider gave no reset time for: wait this long. */
const QUOTA_DEFAULT_MS = 3_600_000;
/** An unknown outcome is reconciled with the platform first, soon. */
const UNKNOWN_OUTCOME_MS = 60_000;
const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
/** "15 min", "1 h", "3.5 h": whole minutes, so a reset a few milliseconds short of an hour still reads as an hour. */
const describe = (ms: number) => {
  const m = minutes(ms);
  return m >= 60 ? `${m % 60 ? (m / 60).toFixed(1) : m / 60} h` : `${m} min`;
};

/**
 * Exponential backoff from the configured delay, doubling per automatic
 * retry, with ±20% jitter so many posts failing together don't retry
 * together, capped at MAX_DELAY_MS.
 */
export function backoffMs(baseMinutes: number, autoRetries: number, random: () => number = Math.random): number {
  const base = Math.max(1, baseMinutes) * 60_000 * 2 ** Math.min(autoRetries, 10);
  const jitter = 1 + (random() * 2 - 1) * 0.2;
  return Math.min(MAX_DELAY_MS, Math.round(base * jitter));
}

/** The plan for a failed attempt. */
export function retryPlan(input: RetryInput): RetryPlan {
  const { code, settings, autoRetries } = input;
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const none = (reason: string, extra: Partial<RetryPlan> = {}): RetryPlan => ({ retry: false, at: null, reason, pauseAccount: false, needsAttention: false, ...extra });
  const after = (ms: number, why: string): RetryPlan => {
    const wait = Math.min(MAX_DELAY_MS, Math.max(0, ms));
    return { retry: true, at: new Date(now.getTime() + wait), reason: `${code}: ${why}; automatic retry ${autoRetries + 1} of ${settings.maxRetries} in ${describe(wait)}`, pauseAccount: false, needsAttention: false };
  };

  // Codes that no retry can fix
  if (code === "AUTH") return none(`${code}: the platform no longer accepts the sign-in; the account is paused until it is reconnected`, { pauseAccount: true, needsAttention: true });
  if (code === "VALIDATION") return none(`${code}: the platform refused the post itself; fix the post and retry it`, { needsAttention: true });
  if (code === "UNKNOWN") return none(`${code}: an error the app doesn't recognise; not retried automatically`, { needsAttention: true });
  if (!input.retryable) return none(`${code}: not retried automatically`, { needsAttention: true });

  // An unknown outcome is checked with the platform before anything is sent again, so it can come back soon
  if (code === "UNKNOWN_OUTCOME") {
    if (!settings.autoRetry) return none(`${code}: automatic retries are off; check the platform and retry by hand`, { needsAttention: true });
    if (autoRetries >= settings.maxRetries) return none(`${code}: no automatic retries left (${settings.maxRetries} used); check the platform and retry by hand`, { needsAttention: true });
    return after(UNKNOWN_OUTCOME_MS, "the platform is asked first whether the post went out");
  }

  if (!settings.autoRetry) return none(`${code}: automatic retries are off`, { needsAttention: true });
  if (autoRetries >= settings.maxRetries) return none(`${code}: no automatic retries left (${settings.maxRetries} used)`, { needsAttention: true });

  switch (code) {
    case "RATE": {
      if (input.retryAfterSeconds != null) return after(input.retryAfterSeconds * 1000, `the platform asked to wait ${describe(input.retryAfterSeconds * 1000)}`);
      return after(backoffMs(settings.retryDelayMinutes, autoRetries, random), "rate limited, backing off");
    }
    case "QUOTA": {
      const ms = input.quotaResetAt ? input.quotaResetAt.getTime() - now.getTime() : QUOTA_DEFAULT_MS;
      return after(Math.max(60_000, ms), input.quotaResetAt ? "waiting for the quota to reset" : "quota exceeded, no reset time known");
    }
    case "NETWORK":
    default:
      return after(backoffMs(settings.retryDelayMinutes, autoRetries, random), "temporary failure, backing off");
  }
}
