import { describe, expect, it } from "vitest";
import { byteLimit, UploadTooLargeError } from "@/lib/storage/limit";

const stream = (chunks: number[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const n of chunks) c.enqueue(new Uint8Array(n));
      c.close();
    },
  });

/** The sizes of the chunks that come out, in order. */
async function chunkSizes(s: ReadableStream<Uint8Array>) {
  const sizes: number[] = [];
  const reader = s.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) sizes.push(r.value.byteLength);
  return sizes;
}
const total = async (s: ReadableStream<Uint8Array>) => (await chunkSizes(s)).reduce((a, b) => a + b, 0);

describe("byteLimit (PERF-07)", () => {
  it("passes everything through up to the limit, exactly", async () => {
    expect(await total(stream([400, 400, 200]).pipeThrough(byteLimit(1000)))).toBe(1000);
    expect(await total(stream([]).pipeThrough(byteLimit(10)))).toBe(0);
  });

  it("stops the stream with UploadTooLargeError the moment one byte too many arrives", async () => {
    await expect(total(stream([600, 401]).pipeThrough(byteLimit(1000)))).rejects.toBeInstanceOf(UploadTooLargeError);
  });

  it("doesn't buffer: chunks come out as they go in", async () => {
    expect(await chunkSizes(stream([10, 20, 30]).pipeThrough(byteLimit(100)))).toEqual([10, 20, 30]);
  });
});
