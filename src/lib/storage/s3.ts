import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider, StoredObject } from "./index";

// An S3-compatible bucket as the storage provider (MEDIA-01): AWS S3,
// Cloudflare R2, Backblaze B2, MinIO and the like. Chosen with
// STORAGE_PROVIDER=s3; the local-disk provider stays the default and the one
// development uses. Nothing here has run against a real bucket yet
// (docs/integrations/storage.md says what is verified and what isn't).

export interface S3Config {
  bucket: string;
  region: string;
  /** Custom endpoint for R2 / B2 / MinIO; unset for AWS */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style URLs (MinIO, some B2 setups) instead of bucket.host */
  forcePathStyle: boolean;
  /** How long signed URLs stay valid */
  presignTtlSeconds: number;
}

/** The bucket configuration, or null while files live on local disk. */
export function s3Config(): S3Config | null {
  if ((process.env.STORAGE_PROVIDER ?? "").trim().toLowerCase() !== "s3") return null;
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) throw new Error("STORAGE_PROVIDER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
  return {
    bucket,
    region: process.env.S3_REGION?.trim() || "auto",
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    presignTtlSeconds: Math.min(7 * 86_400, Math.max(60, Number(process.env.S3_PRESIGN_TTL_SECONDS) || 900)),
  };
}

/** Keys are made by makeStorageKey; anything else never reaches the bucket. */
function assertKey(key: string) {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\") || key.includes("//")) throw new Error("Invalid storage key");
}

/** Multipart part size for browser uploads (S3's minimum is 5 MiB, except the last part). */
export const PART_SIZE = 16 * 1024 * 1024;

export function s3StorageProvider(config: S3Config, client = new S3Client({ region: config.region, endpoint: config.endpoint, forcePathStyle: config.forcePathStyle, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } })): StorageProvider {
  const Bucket = config.bucket;
  const notFound = (e: unknown) => {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    return err?.name === "NotFound" || err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404;
  };

  return {
    async save(key, body) {
      assertKey(key);
      // lib-storage streams the body to the bucket in parts; nothing is buffered whole
      const upload = new Upload({ client, params: { Bucket, Key: key, Body: Readable.fromWeb(body as import("node:stream/web").ReadableStream) }, partSize: 8 * 1024 * 1024, queueSize: 3, leavePartsOnError: false });
      await upload.done();
      const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
      return { size: head.ContentLength ?? 0 };
    },
    async stat(key) {
      assertKey(key);
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: head.ContentLength ?? 0, modifiedAt: head.LastModified ?? new Date(0) };
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    readStream(key, range) {
      assertKey(key);
      // The provider answers with a stream before the GET has been sent: the bytes are piped in as they arrive
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      client
        .send(new GetObjectCommand({ Bucket, Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }))
        .then((r) => {
          if (!r.Body) throw new Error("The bucket returned no body.");
          return (r.Body as { transformToWebStream(): ReadableStream<Uint8Array> }).transformToWebStream().pipeTo(writable);
        })
        .catch((e) => writable.abort(e).catch(() => {}));
      return readable;
    },
    async remove(key) {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    localPath() {
      return null;
    },
    async list(prefix = "") {
      const out: StoredObject[] = [];
      let ContinuationToken: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix || undefined, ContinuationToken }));
        for (const o of page.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, modifiedAt: o.LastModified ?? new Date(0) });
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    },
    async signedGetUrl(key, opts = {}) {
      assertKey(key);
      const disposition = opts.fileName ? `${opts.download ? "attachment" : "inline"}; filename="${encodeURIComponent(opts.fileName)}"` : undefined;
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition, ResponseContentType: opts.contentType }), { expiresIn: opts.expiresInSeconds ?? config.presignTtlSeconds });
    },
    async presignUpload(key, { contentType, size }) {
      assertKey(key);
      const expiresIn = config.presignTtlSeconds;
      if (size <= PART_SIZE) {
        const url = await getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: size }), { expiresIn });
        return { kind: "single", url, headers: { "Content-Type": contentType } };
      }
      const created = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }));
      if (!created.UploadId) throw new Error("The bucket returned no upload id.");
      const parts = Math.ceil(size / PART_SIZE);
      const urls: string[] = [];
      for (let n = 1; n <= parts; n++) urls.push(await getSignedUrl(client, new UploadPartCommand({ Bucket, Key: key, UploadId: created.UploadId, PartNumber: n }), { expiresIn }));
      return { kind: "multipart", uploadId: created.UploadId, partSize: PART_SIZE, urls };
    },
    async completeUpload(key, uploadId, parts) {
      assertKey(key);
      await client.send(new CompleteMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) } }));
    },
    async abortUpload(key, uploadId) {
      assertKey(key);
      await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
    },
  };
}
