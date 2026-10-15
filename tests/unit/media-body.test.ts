import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isReadable, mediaBody } from "@/lib/platforms/oauth";
import { PublishError } from "@/lib/platforms/types";

// MEDIA-01: a platform upload reads the stored file wherever it lives.

const collect = async (s: ReadableStream<Uint8Array>) => {
  const out: Uint8Array[] = [];
  for await (const ch of s as unknown as AsyncIterable<Uint8Array>) out.push(ch);
  return Buffer.concat(out);
};
const fromBytes = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 1000) c.enqueue(bytes.subarray(i, i + 1000));
      c.close();
    },
  });

describe("mediaBody", () => {
  it("reads through the storage provider from the requested byte, reporting progress", async () => {
    const data = new Uint8Array(2_500_000).map((_, i) => i % 7);
    const reads: number[] = [];
    const progress: number[] = [];
    const media = { read: (start = 0) => (reads.push(start), fromBytes(data.subarray(start))) };
    const out = await collect(mediaBody(media, 1_000_000, (n) => progress.push(n)));
    expect(reads).toEqual([1_000_000]);
    expect(out.length).toBe(1_500_000);
    expect(out[0]).toBe(data[1_000_000]);
    // Every megabyte, and the end
    expect(progress.at(-1)).toBe(1_500_000);
    expect(progress.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the local path, and refuses a file that is neither stored nor local", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mf-body-"));
    const file = path.join(dir, "a.bin");
    writeFileSync(file, Buffer.from("0123456789"));
    expect((await collect(mediaBody({ localPath: file }, 4, () => {}))).toString()).toBe("456789");
    expect(() => mediaBody({ localPath: null, url: "https://cdn/x.mp4" } as never, 0, () => {})).toThrow(PublishError);
    expect(isReadable({ localPath: file })).toBe(true);
    expect(isReadable({ read: () => fromBytes(new Uint8Array(1)) })).toBe(true);
    expect(isReadable({ localPath: null })).toBe(false);
    expect(isReadable(null)).toBe(false);
  });
});
