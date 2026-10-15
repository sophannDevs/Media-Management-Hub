import { describe, expect, it } from "vitest";
import { canTransition, SCHEDULE_STATUSES, SCHEDULE_TRANSITIONS } from "@/lib/workflow/schedule-machine";
import { ScheduleStatus } from "@/lib/workflow/statuses";

// ARCH-02: the schedule's state machine, as code. The database enforces the
// same table (tests/integration/attempt-log.test.ts checks every pair).

describe("schedule state machine (ARCH-02)", () => {
  it("covers exactly the statuses the app knows", () => {
    expect([...SCHEDULE_STATUSES].sort()).toEqual([...ScheduleStatus.codes].sort());
  });

  it("lets every status stay where it is", () => {
    for (const s of SCHEDULE_STATUSES) expect(canTransition(s, s)).toBe(true);
  });

  it("has a published post as the only end state", () => {
    for (const s of SCHEDULE_STATUSES) {
      const outgoing = Object.keys(SCHEDULE_TRANSITIONS[s]);
      if (s === "PUBLISHED") expect(outgoing).toEqual([]);
      else expect(outgoing.length).toBeGreaterThan(0);
    }
    for (const s of SCHEDULE_STATUSES) expect(canTransition("PUBLISHED", s)).toBe(s === "PUBLISHED");
  });

  it("reaches PUBLISHED only through PROCESSING", () => {
    for (const s of SCHEDULE_STATUSES) expect(canTransition(s, "PUBLISHED")).toBe(s === "PROCESSING" || s === "PUBLISHED");
  });

  it("never lets a post that is publishing be cancelled or edited underneath the worker", () => {
    expect(canTransition("PROCESSING", "CANCELLED")).toBe(false);
    expect(canTransition("PROCESSING", "WAITING")).toBe(false);
  });

  it("gives every arrow a reason", () => {
    for (const s of SCHEDULE_STATUSES) for (const why of Object.values(SCHEDULE_TRANSITIONS[s])) expect(why).toMatch(/\w{4,}/);
  });
});
