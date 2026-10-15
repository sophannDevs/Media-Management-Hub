# Object storage (MEDIA-01)

Uploaded media lives on local disk by default (`STORAGE_DIR`, the right choice
for one machine and for development). For more than one server, large
libraries or a CDN, point the app at an S3-compatible bucket. **Nothing here
has run against a real bucket yet**: the provider is tested against a recorded
S3 client, and the direct-upload routes against an in-memory bucket. Treat the
first real upload as the test.

## Configuration

| Variable | Meaning |
|---|---|
| `STORAGE_PROVIDER=s3` | Switches from local disk to the bucket. |
| `S3_BUCKET` | The bucket's name. |
| `S3_REGION` | `auto` for R2, the region name for AWS / B2. |
| `S3_ENDPOINT` | The service URL for R2 (`https://<account>.r2.cloudflarestorage.com`), B2 (`https://s3.<region>.backblazeb2.com`) or MinIO; leave empty for AWS. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | A key limited to this bucket (read, write, list, multipart). |
| `S3_FORCE_PATH_STYLE=true` | For MinIO and other hosts that don't do `bucket.host`. |
| `S3_PRESIGN_TTL_SECONDS` | How long signed URLs stay valid (default 15 minutes). |
| `STORAGE_DIRECT_UPLOAD=true` | Browsers PUT files straight to the bucket (presigned, multipart above 16 MB); the server then inspects and registers the object. Needs the CORS rule below. Off: uploads stream through the server, which still works with a bucket. |
| `STORAGE_DIRECT_GET=true` | `/api/files/…` answers with a 302 to a short-lived signed URL, so the bytes come from the bucket (or its CDN) instead of this server. Off by default: the proxied answer carries the headers that keep an uploaded file from running scripts (`nosniff`, a sandboxing CSP) and the 304 / Range handling of PERF-06. |

Switching providers does not move files: migrate the `STORAGE_DIR` folder into
the bucket under the same keys (`media/YYYY/MM/<id>-<name>`) before switching,
or keep the old provider until the old assets are gone.

## Bucket settings

- **CORS** (only for `STORAGE_DIRECT_UPLOAD`): allow `PUT` from the app's
  origin, allow the `Content-Type` header, and **expose the `ETag` header** —
  a multipart upload is completed with the parts' ETags, and a browser can't
  read them unless the rule exposes them.
- **Lifecycle rules**: abort incomplete multipart uploads after 1 day (a browser
  that gave up leaves parts behind; the app aborts what it can, the rule
  catches the rest). Don't expire media objects: the worker's daily reconcile
  pass (MEDIA-03) removes the ones no asset references once they are a day
  old, and `npm run media:reconcile -- --dry-run` shows what it would remove.
  It also lists assets whose file is missing (after a restore without the
  files, say) without touching them.
- **Versioning**: optional; with it, a deleted object can be restored for the
  retention window, which complements `npm run db:backup` (the database dump
  references objects by key).
- **CDN**: put the bucket behind one and set `STORAGE_DIRECT_GET=true`; the
  signed URLs are per request and expire, so the CDN caches only what a
  signed-in person just asked for.

## What the code does

- `src/lib/storage/s3.ts` implements the same `StorageProvider` as the local
  disk: `save` streams the body in 8 MB parts (`@aws-sdk/lib-storage`), `stat`
  is a HEAD, `readStream` is a GET with a `Range` header (seeking in the file
  route, resuming a platform upload from any byte), `remove`, `list`
  (paginated), plus what a disk can't do: `signedGetUrl`, `presignUpload`
  (one PUT up to 16 MB, multipart above), `completeUpload`, `abortUpload`.
- Platform uploads (YouTube, Facebook) read the stored file through the
  provider, so a bucket object streams to the platform without a local copy;
  ffprobe measures a bucket object through a signed URL.
- The direct-upload routes: `POST /api/media/presign` (signed URLs, or
  `{ direct: false }` so the browser uploads through the server), `DELETE
  /api/media/presign` (abort), `POST /api/media/complete` (finish multipart,
  then the same inspection as a proxied upload — first bytes, extension, cap,
  SHA-256 of the whole object read once from the bucket, ffprobe — and
  registration; an object that fails is deleted).

## Not verified (needs a bucket)

- Any provider's behaviour against AWS, R2, B2 or MinIO: endpoint and
  path-style quirks, `ETag` exposure through CORS, HEAD after a multipart
  completion, the `transformToWebStream` body on the installed SDK version.
- Signed URL lifetimes and clock skew.
- Throughput of `readStream` as a platform upload source (a bucket in another
  region than the server is slow).
