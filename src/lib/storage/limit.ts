/** Thrown into a stream that carries more bytes than allowed. */
export class UploadTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`The upload is larger than ${maxBytes} bytes.`);
    this.name = "UploadTooLargeError";
  }
}

/**
 * A pass-through that stops the stream with UploadTooLargeError as soon as more
 * than `maxBytes` have gone through (PERF-07). It holds nothing back: the
 * bytes keep flowing to disk, and a client that lied about (or left out) its
 * Content-Length can't push past the limit.
 */
export function byteLimit(maxBytes: number) {
  let total = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new UploadTooLargeError(maxBytes);
      controller.enqueue(chunk);
    },
  });
}
