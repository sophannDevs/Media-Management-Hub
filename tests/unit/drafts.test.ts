import { describe, expect, it } from "vitest";
import { clearDraft, DRAFT_MAX_AGE_MS, type DraftStore, parseDraft, readDraft, writeDraft } from "@/lib/drafts";

// UX-03: drafts kept in the browser.

function memoryStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("drafts (UX-03)", () => {
  it("keeps a value and reads it back with the time it was kept", () => {
    const store = memoryStore();
    expect(writeDraft(store, "script:c1", { body: "Hello", baseVersion: 2 }, 1_000)).toBe(true);
    expect(readDraft(store, "script:c1", 2_000)).toEqual({ at: 1_000, value: { body: "Hello", baseVersion: 2 } });
  });

  it("keeps each key apart and forgets one on request", () => {
    const store = memoryStore();
    writeDraft(store, "a", "one");
    writeDraft(store, "b", "two");
    clearDraft(store, "a");
    expect(readDraft(store, "a")).toBeNull();
    expect(readDraft(store, "b")?.value).toBe("two");
  });

  it("treats damaged or foreign data as no draft", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("")).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft("42")).toBeNull();
    expect(parseDraft(JSON.stringify({ at: "yesterday", value: "x" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ at: 1 }))).toBeNull();
  });

  it("forgets a draft older than 30 days", () => {
    const raw = JSON.stringify({ at: 1_000, value: "old" });
    expect(parseDraft(raw, 1_000 + DRAFT_MAX_AGE_MS - 1)?.value).toBe("old");
    expect(parseDraft(raw, 1_000 + DRAFT_MAX_AGE_MS)).toBeNull();
  });

  it("says so when the browser refuses to store (full or disabled storage)", () => {
    const refusing: DraftStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(writeDraft(refusing, "k", "v")).toBe(false);
    expect(readDraft(refusing, "k")).toBeNull();
    expect(() => clearDraft(refusing, "k")).not.toThrow();
  });
});
