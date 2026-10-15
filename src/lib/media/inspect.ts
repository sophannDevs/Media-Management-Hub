import { createHash } from "node:crypto";

// Looks at an upload as it streams to disk (SEC-05): a SHA-256 of the whole
// file (duplicates, integrity) and a copy of its first bytes for sniffing.
// Nothing else is held: the bytes flow straight through.

export interface Inspection {
  sha256: string;
  head: Uint8Array;
  bytes: number;
}

export function hashAndPeek(peekBytes = 4096): { stream: TransformStream<Uint8Array, Uint8Array>; result(): Inspection } {
  const hash = createHash("sha256");
  const head: Uint8Array[] = [];
  let headBytes = 0;
  let bytes = 0;
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      hash.update(chunk);
      bytes += chunk.byteLength;
      if (headBytes < peekBytes) {
        const take = chunk.subarray(0, Math.min(chunk.byteLength, peekBytes - headBytes));
        head.push(new Uint8Array(take));
        headBytes += take.byteLength;
      }
      controller.enqueue(chunk);
    },
  });
  return {
    stream,
    result: () => ({ sha256: hash.digest("hex"), head: Buffer.concat(head), bytes }),
  };
}
