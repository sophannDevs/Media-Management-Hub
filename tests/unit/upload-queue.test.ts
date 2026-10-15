import { describe, expect, it } from "vitest";
import { busy, finished, formatBytes, newItem, nextToSend, overallProgress, patch, settled, summary } from "@/lib/upload-queue";

// MEDIA-02: the rules of the browser's upload queue.

const items = () => [newItem("a", "a.mp4", 1000), newItem("b", "b.png", 3000), newItem("c", "c.mp3", 6000)];

describe("upload queue", () => {
  it("sends one file at a time, in order, once it is queued", () => {
    let q = items();
    expect(nextToSend(q)).toBeUndefined(); // still checking
    q = patch(patch(q, "a", { status: "queued" }), "b", { status: "queued" });
    expect(nextToSend(q)?.id).toBe("a");
    q = patch(q, "a", { status: "uploading" });
    expect(nextToSend(q)).toBeUndefined();
    q = patch(q, "a", { status: "done", assetId: "A1" });
    expect(nextToSend(q)?.id).toBe("b");
  });

  it("knows when the batch is settled, and when it ended well", () => {
    let q = items();
    expect(settled(q)).toBe(false);
    q = patch(patch(patch(q, "a", { status: "done" }), "b", { status: "duplicate" }), "c", { status: "failed", error: "Network error" });
    expect(settled(q)).toBe(false); // b awaits a decision
    expect(busy(q)).toBe(false);
    q = patch(q, "b", { status: "skipped" });
    expect(settled(q)).toBe(true);
    expect(finished(q)).toBe(false); // c failed
    q = patch(q, "c", { status: "done", assetId: "C1" });
    expect(finished(q)).toBe(true);
    expect(finished([])).toBe(false);
  });

  it("sums progress by bytes and reports what was created, what failed and what waits", () => {
    let q = items();
    q = patch(q, "a", { status: "done", assetId: "A1" });
    q = patch(q, "b", { status: "uploading", progress: 50 });
    expect(overallProgress(q)).toBe(25); // 1000 + 1500 of 10000
    q = patch(q, "b", { status: "failed", error: "b.png: too big" });
    q = patch(q, "c", { status: "duplicate", duplicateOf: { id: "X", name: "c.mp3" } });
    expect(summary(q)).toEqual({ ok: true, created: ["A1"], errors: ["b.png: too big"], error: undefined, requestId: undefined, skipped: 0, waiting: 1 });
    q = patch(q, "a", { status: "failed", error: "Network error", requestId: "req-1" });
    expect(summary(q)).toMatchObject({ ok: false, created: [], errors: ["a.mp4: Network error", "b.png: too big"], error: "a.mp4: Network error", requestId: "req-1" });
  });

  it("prints sizes for people", () => {
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(12.3 * 1024 * 1024)).toBe("12.3 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
  });
});
