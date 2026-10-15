import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runAsUser } from "@/server/auth/actor";
import { getActivityPage, getContentWorkspace } from "@/server/queries/content";
import { bulkSetStatus, createContent, reviewContent, setProductionStatus } from "@/server/services/content";
import { seedPlatforms } from "../helpers/factories";

// WF-06: every review decision says who, when and why.

const OWNER = "test-owner";

beforeEach(async () => {
  await seedPlatforms();
  await db.content.deleteMany();
  await db.activityLog.deleteMany();
});

describe("reviews (WF-06)", () => {
  it("records who decided what, and why; requesting changes needs a comment", async () => {
    const c = await runAsUser(OWNER, () => createContent({ title: "Reviewed" }));
    expect(await runAsUser(OWNER, () => reviewContent(c.id, "IN_REVIEW"))).toMatchObject({ changed: true });
    await expect(runAsUser(OWNER, () => reviewContent(c.id, "CHANGES_REQUESTED"))).rejects.toThrow("Say what needs to change.");
    await expect(runAsUser(OWNER, () => reviewContent(c.id, "CHANGES_REQUESTED", "   "))).rejects.toThrow("Say what needs to change.");
    await runAsUser(OWNER, () => reviewContent(c.id, "CHANGES_REQUESTED", "  Tighten the intro  "));
    await runAsUser(OWNER, () => reviewContent(c.id, "APPROVED", "Looks great now"));

    const reviews = await db.review.findMany({ where: { contentId: c.id }, orderBy: { createdAt: "asc" } });
    expect(reviews.map((r) => [r.decision, r.comment, r.actorId])).toEqual([
      ["IN_REVIEW", "", OWNER],
      ["CHANGES_REQUESTED", "Tighten the intro", OWNER],
      ["APPROVED", "Looks great now", OWNER],
    ]);
    expect((await db.content.findUniqueOrThrow({ where: { id: c.id } })).reviewStatus).toBe("APPROVED");
    const logs = await db.activityLog.findMany({ where: { contentId: c.id, type: "review.decided" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => [l.message, l.actorId, (l.meta as { comment: string }).comment])).toEqual([
      ["Sent to review", OWNER, ""],
      ["Changes requested: “Tighten the intro”", OWNER, "Tighten the intro"],
      ["Approved: “Looks great now”", OWNER, "Looks great now"],
    ]);

    // The page shows the latest decision; the history carries the comments
    const ws = await getContentWorkspace(c.id);
    expect(ws!.content.review).toMatchObject({ decision: "APPROVED", comment: "Looks great now", by: "Test Owner" });
    const page = await getActivityPage(c.id, null);
    expect(page.items.filter((i) => i.comment).map((i) => i.comment)).toEqual(["Looks great now", "Tighten the intro"]);

    // The same decision again, without a word: nothing to record
    expect(await runAsUser(OWNER, () => reviewContent(c.id, "APPROVED"))).toEqual({ changed: false });
    expect(await db.review.count({ where: { contentId: c.id } })).toBe(3);
    await expect(reviewContent(c.id, "NOT_STARTED")).rejects.toThrow("Invalid review decision.");
    await expect(reviewContent("no-such-content", "APPROVED")).rejects.toThrow("Content not found.");
  });

  it("the generic status setters go through the same door", async () => {
    const a = await createContent({ title: "A" });
    const b = await createContent({ title: "B" });
    await runAsUser(OWNER, () => setProductionStatus(a.id, "reviewStatus", "IN_REVIEW"));
    expect(await db.review.findMany({ where: { contentId: a.id } })).toHaveLength(1);
    expect(await runAsUser(OWNER, () => bulkSetStatus([a.id, b.id], "reviewStatus", "CHANGES_REQUESTED"))).toEqual({ updated: 0, errors: ["Say what needs to change."] });
    expect(await runAsUser(OWNER, () => bulkSetStatus([a.id, b.id], "reviewStatus", "APPROVED"))).toEqual({ updated: 2, errors: [] });
    expect(await db.review.count({ where: { decision: "APPROVED", actorId: OWNER } })).toBe(2);
    // Deleting the person keeps the decision, without the link
    await db.user.delete({ where: { id: OWNER } });
    expect(await db.review.count({ where: { decision: "APPROVED", actorId: null } })).toBe(2);
  });
});
