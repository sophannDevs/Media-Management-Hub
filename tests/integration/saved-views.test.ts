import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deleteViewAction, saveViewAction } from "@/server/actions/content";
import { getContentList } from "@/server/queries/content";
import { deleteView, MAX_VIEWS, saveView } from "@/server/services/views";
import { seedPlatforms } from "../helpers/factories";

// UX-02: saved views belong to the user who saved them.

const OWNER = "test-owner"; // the signed-in user of integration tests (tests/setup/signed-in.ts)

beforeAll(async () => {
  await seedPlatforms();
  await db.user.create({ data: { id: OWNER, name: "Test Owner", email: "owner@test.local" } });
  await db.user.create({ data: { id: "someone-else", name: "Other", email: "other@test.local" } });
});

describe("saved views (UX-02)", () => {
  it("saves the list's filters and sort under a name, for the signed-in user", async () => {
    const r = await saveViewAction("  High priority  ", "stage=PRODUCTION&priority=HIGH&sort=title&after=abc");
    expect(r).toMatchObject({ ok: true, message: "Saved view “High priority”" });
    const list = await getContentList({});
    expect(list.views).toEqual([expect.objectContaining({ name: "High priority", query: "stage=PRODUCTION&priority=HIGH&sort=title" })]);
  });

  it("replaces a view saved under the same name", async () => {
    await saveViewAction("High priority", "priority=HIGH");
    const views = await db.savedView.findMany({ where: { userId: OWNER } });
    expect(views.map((v) => [v.name, v.query])).toEqual([["High priority", "priority=HIGH"]]);
  });

  it("keeps other users' views out of reach", async () => {
    const theirs = await saveView("someone-else", "Theirs", "stage=READY");
    expect((await getContentList({})).views.map((v) => v.name)).not.toContain("Theirs");
    expect(await deleteViewAction(theirs.id)).toMatchObject({ ok: false, error: "That view no longer exists." });
    expect(await db.savedView.count({ where: { id: theirs.id } })).toBe(1);
    await deleteView("someone-else", theirs.id);
  });

  it("limits how many views a user keeps", async () => {
    await db.savedView.deleteMany({ where: { userId: OWNER } });
    for (let i = 0; i < MAX_VIEWS; i++) await saveView(OWNER, `View ${i}`, "");
    expect(await saveViewAction("One more", "")).toMatchObject({ ok: false, error: `You can keep up to ${MAX_VIEWS} views. Delete one first.` });
    // Replacing an existing one is still fine
    expect(await saveViewAction("View 0", "sort=title")).toMatchObject({ ok: true });
  });

  it("refuses an empty name", async () => {
    expect(await saveViewAction("   ", "")).toMatchObject({ ok: false, details: ["Give the view a name."] });
  });
});
