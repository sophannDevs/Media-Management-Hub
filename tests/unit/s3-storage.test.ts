import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MEDIA-01: the bucket provider against a recorded S3 client. Every command
// the provider sends is captured, so the tests check what reaches the bucket.

type Sent = { name: string; input: Record<string, unknown> };
let sent: Sent[];
let answer: (cmd: Sent) => unknown;

vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    constructor(public opts: { params: Record<string, unknown>; partSize: number }) {}
    async done() {
      sent.push({ name: "Upload", input: { ...this.opts.params, partSize: this.opts.partSize } });
    }
  },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (_client: unknown, command: { constructor: { name: string }; input: Record<string, unknown> }, opts: { expiresIn: number }) =>
    `https://signed.test/${command.constructor.name}?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(command.input).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) as Record<string, string>), expiresIn: String(opts.expiresIn) })}`,
}));

import { S3Client } from "@aws-sdk/client-s3";
import { PART_SIZE, s3Config, s3StorageProvider } from "@/lib/storage/s3";

const config = { bucket: "mediaflow-test", region: "auto", endpoint: "https://r2.test", accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: false, presignTtlSeconds: 600 };
const fakeClient = () => ({ send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => { const cmd = { name: command.constructor.name, input: command.input }; sent.push(cmd); return answer(cmd); } }) as unknown as S3Client;
const body = (text: string) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });

beforeEach(() => {
  sent = [];
  answer = () => ({});
});
afterEach(() => {
  delete process.env.STORAGE_PROVIDER;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
});

describe("S3 configuration", () => {
  it("is off unless asked for, and refuses a half-configured bucket", () => {
    expect(s3Config()).toBeNull();
    process.env.STORAGE_PROVIDER = "s3";
    expect(() => s3Config()).toThrow(/S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY/);
    process.env.S3_BUCKET = "b";
    process.env.S3_ACCESS_KEY_ID = "a";
    process.env.S3_SECRET_ACCESS_KEY = "s";
    expect(s3Config()).toMatchObject({ bucket: "b", region: "auto", forcePathStyle: false, presignTtlSeconds: 900 });
  });
});

describe("S3 storage provider", () => {
  const provider = () => s3StorageProvider(config, fakeClient());

  it("streams a save to the bucket in parts and reports the stored size", async () => {
    answer = (c) => (c.name === "HeadObjectCommand" ? { ContentLength: 11, LastModified: new Date("2026-10-15T00:00:00Z") } : {});
    const r = await provider().save("media/2026/10/a.mp4", body("hello world"));
    expect(r).toEqual({ size: 11 });
    expect(sent.map((s) => s.name)).toEqual(["Upload", "HeadObjectCommand"]);
    expect(sent[0].input).toMatchObject({ Bucket: "mediaflow-test", Key: "media/2026/10/a.mp4", partSize: 8 * 1024 * 1024 });
  });

  it("answers stat from a HEAD, and null for a missing object", async () => {
    answer = (c) => {
      if (c.input.Key === "media/missing.mp4") throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: 42, LastModified: new Date("2026-10-15T12:00:00Z") };
    };
    expect(await provider().stat("media/a.mp4")).toEqual({ size: 42, modifiedAt: new Date("2026-10-15T12:00:00Z") });
    expect(await provider().stat("media/missing.mp4")).toBeNull();
    await expect(provider().stat("../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });

  it("reads a byte range with a GET Range header and streams the body through", async () => {
    answer = () => ({ Body: { transformToWebStream: () => body("cdef") } });
    const chunks: Uint8Array[] = [];
    for await (const ch of provider().readStream("media/a.mp4", { start: 2, end: 5 }) as unknown as AsyncIterable<Uint8Array>) chunks.push(ch);
    expect(Buffer.concat(chunks).toString()).toBe("cdef");
    expect(sent[0]).toMatchObject({ name: "GetObjectCommand", input: { Bucket: "mediaflow-test", Key: "media/a.mp4", Range: "bytes=2-5" } });
  });

  it("fails the stream, not the process, when the GET fails", async () => {
    answer = () => {
      throw new Error("bucket down");
    };
    const reader = provider().readStream("media/a.mp4").getReader();
    await expect(reader.read()).rejects.toThrow(/bucket down/);
  });

  it("removes, and lists every page of a prefix", async () => {
    answer = (c) => {
      if (c.name !== "ListObjectsV2Command") return {};
      return c.input.ContinuationToken
        ? { Contents: [{ Key: "media/b.mp4", Size: 2, LastModified: new Date(2) }], IsTruncated: false }
        : { Contents: [{ Key: "media/a.mp4", Size: 1, LastModified: new Date(1) }], IsTruncated: true, NextContinuationToken: "t2" };
    };
    await provider().remove("media/a.mp4");
    expect(sent[0]).toMatchObject({ name: "DeleteObjectCommand", input: { Key: "media/a.mp4" } });
    const objects = await provider().list("media/");
    expect(objects).toEqual([
      { key: "media/a.mp4", size: 1, modifiedAt: new Date(1) },
      { key: "media/b.mp4", size: 2, modifiedAt: new Date(2) },
    ]);
    expect(sent.filter((s) => s.name === "ListObjectsV2Command").map((s) => s.input.ContinuationToken)).toEqual([undefined, "t2"]);
    expect(provider().localPath("media/a.mp4")).toBeNull();
  });

  it("signs a GET with the file name and type the browser should see", async () => {
    const url = new URL(await provider().signedGetUrl!("media/a.mp4", { fileName: "clip one.mp4", contentType: "video/mp4", download: true, expiresInSeconds: 120 }));
    expect(url.pathname).toBe("/GetObjectCommand");
    expect(url.searchParams.get("Key")).toBe("media/a.mp4");
    expect(url.searchParams.get("ResponseContentDisposition")).toBe('attachment; filename="clip%20one.mp4"');
    expect(url.searchParams.get("ResponseContentType")).toBe("video/mp4");
    expect(url.searchParams.get("expiresIn")).toBe("120");
    const inline = new URL(await provider().signedGetUrl!("media/a.mp4", { fileName: "a.mp4" }));
    expect(inline.searchParams.get("ResponseContentDisposition")).toBe('inline; filename="a.mp4"');
    expect(inline.searchParams.get("expiresIn")).toBe("600");
  });

  it("presigns one PUT for a small file and a multipart upload for a big one, and completes or aborts it", async () => {
    answer = (c) => (c.name === "CreateMultipartUploadCommand" ? { UploadId: "up-1" } : {});
    const small = await provider().presignUpload!("media/s.png", { contentType: "image/png", size: 1000 });
    expect(small.kind).toBe("single");
    if (small.kind === "single") {
      const u = new URL(small.url);
      expect(u.pathname).toBe("/PutObjectCommand");
      expect(u.searchParams.get("ContentType")).toBe("image/png");
      expect(u.searchParams.get("ContentLength")).toBe("1000");
      expect(small.headers).toEqual({ "Content-Type": "image/png" });
    }

    const big = await provider().presignUpload!("media/b.mp4", { contentType: "video/mp4", size: PART_SIZE * 2 + 1 });
    expect(big.kind).toBe("multipart");
    if (big.kind === "multipart") {
      expect(big).toMatchObject({ uploadId: "up-1", partSize: PART_SIZE });
      expect(big.urls).toHaveLength(3);
      expect(new URL(big.urls[2]).searchParams.get("PartNumber")).toBe("3");
      expect(new URL(big.urls[2]).searchParams.get("UploadId")).toBe("up-1");
    }
    expect(sent.find((s) => s.name === "CreateMultipartUploadCommand")?.input).toMatchObject({ Key: "media/b.mp4", ContentType: "video/mp4" });

    await provider().completeUpload!("media/b.mp4", "up-1", [{ partNumber: 1, etag: '"e1"' }, { partNumber: 2, etag: '"e2"' }]);
    expect(sent.at(-1)).toMatchObject({ name: "CompleteMultipartUploadCommand", input: { Key: "media/b.mp4", UploadId: "up-1", MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"e1"' }, { PartNumber: 2, ETag: '"e2"' }] } } });
    await provider().abortUpload!("media/b.mp4", "up-1");
    expect(sent.at(-1)).toMatchObject({ name: "AbortMultipartUploadCommand", input: { Key: "media/b.mp4", UploadId: "up-1" } });
  });
});
