# YouTube and Facebook publishing (PUB-07)

How MediaFlow publishes to the real platforms, what was verified against the
official documentation, and what has **not** been verified because it needs
your credentials and a test channel / Page. Nothing in this integration has
run against YouTube or Facebook yet: treat the first real post as the test.

## Switching a platform from simulated to real

| Platform | Variables | Where to get them |
|---|---|---|
| YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud → APIs & Services → Credentials → OAuth client ID (Web application). Enable the **YouTube Data API v3**. Add the redirect URI `<APP_URL>/api/oauth/youtube/callback`. |
| Facebook | `META_APP_ID`, `META_APP_SECRET` | Meta for Developers → your app → Facebook Login → Valid OAuth Redirect URIs: `<APP_URL>/api/oauth/facebook/callback`. Ask for `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`. |
| Both | `APP_URL` | The public address of this app; the redirect URIs are built from it and must match what you registered exactly. |

With the variables unset a platform stays **simulated**: accounts are added
by hand, nothing is sent, every result is labelled simulated. With them set,
Social Accounts offers **Continue with Google / Facebook**, the callback
connects every channel / Page the sign-in can publish to, tokens are stored
encrypted (SEC-04), `/api/health` reports the platform as `real`, and the
worker sends the real upload at the scheduled time.

## What the code does

**Sign-in.** Authorization-code flow with a random `state` kept in a sealed
cookie (`mf_oauth`, 10 minutes, `SameSite=Lax`, path `/api/oauth`) and PKCE
(S256) for Google. The callback is refused when the state doesn't match, the
cookie is missing or expired, or the platform reports an error. Google is
asked with `access_type=offline` and `prompt=consent` so a refresh token
comes back every time. Facebook's short-lived token is exchanged for a
long-lived user token (about 60 days), and each Page's own token is stored
with the Page (the user token is kept beside it: upload sessions need it).

**Tokens.** `services/tokens.ts` renews a Google access token five minutes
before it expires, and the worker's maintenance pass renews everything that
expires within a day; a sign-in Google no longer accepts (`invalid_grant`)
marks the account **Token expired** and notifies you. Facebook Page tokens
from a long-lived user token have no expiry (per Facebook's page); the
account shows the user token's horizon.

**YouTube upload.** `videos.insert` with the resumable protocol: start a
session (`X-Upload-Content-Length/Type`, `Location` = session URI), PUT the
file in one request (Google discourages chunking), on a cut connection ask the
session where it is (`Content-Range: bytes */size` → `308` + `Range`) and
resume from the next byte; `201` = the video resource. The session URI is kept
on the post (`uploadState`), so an attempt the worker lost is resumed, and
recovery asks the session before anything is sent again. Then
`thumbnails.set` (best effort: a channel without a verified phone can't set
custom thumbnails) and up to two minutes of `videos.list` polling for
`processingDetails.processingStatus`: `succeeded` → live; `failed` /
`rejected` → the post is marked rejected by the platform; still processing →
the post is recorded as published (the video exists; YouTube finishes on its
own). Visibility maps to `privacyStatus`; the worker uploads at the scheduled
time, so `publishAt` is not used.

**Facebook upload.** Resumable Upload API: `POST /{APP_ID}/uploads`
(`file_name`, `file_length`, `file_type`) → `upload:<id>`; `POST /upload:<id>`
with `Authorization: OAuth <user token>` and `file_offset`, the file as the
body → handle `h`; on a cut connection `GET /upload:<id>` → `file_offset` and
resume. Then `POST graph-video.facebook.com/v25.0/{PAGE_ID}/videos` with the
Page token, `title`, `description`, `fbuploader_video_file_chunk=<handle>`,
`published=true` (`false` for "Save as Page draft"). Then up to two minutes of
`GET /{video-id}?fields=status`: `ready` → live; `error` / `expired` →
rejected. Only `video/mp4` is sent (the Resumable Upload API's list).

**Errors** are classified into the pipeline's codes (`AUTH`, `QUOTA`, `RATE`,
`VALIDATION`, `NETWORK`, `UNKNOWN_OUTCOME`): Google 401/403 reasons and
status codes; Meta error codes (190/102/463/467 → AUTH, 4/17/32/613/8000x →
RATE, 100/368 → VALIDATION, 1/2 and 5xx → NETWORK). A connection that drops
after bytes were sent is `UNKNOWN_OUTCOME`: the platform is asked before any
resend (PUB-01/02).

## Verified against the official pages (15 Oct 2026)

### YouTube Data API v3
- `videos.insert`: **1 unit in the Video Uploads quota bucket, 100 calls per day** (the older "1,600 units" sentence is gone from the insert page). Max 256 GB; MIME `video/*` or `application/octet-stream`. Scopes: `youtube.upload` (or `youtube`, `youtubepartner`, `youtube.force-ssl`).
- Unverified API projects: the insert page says "Videos uploaded from unverified API projects are not restricted to private viewing mode"; the videos-resource summary still says uploads from unverified projects are set to private by default. **Two official pages contradict each other → test with a real upload.**
- `status.privacyStatus`: private | public | unlisted; defaults to public when omitted ("certain uploads might default to private based on creator account settings").
- `status.publishAt`: ISO 8601; **only settable when privacyStatus is `private` and the video has never been published**; a past time publishes at once; no minimum lead time stated.
- `processingDetails.processingStatus`: processing | succeeded | failed | terminated. `status.uploadStatus`: uploaded | processed | failed | rejected | deleted.
- Resumable upload: POST `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with the JSON resource and `X-Upload-Content-Length` / `X-Upload-Content-Type`; 200 + `Location` = session URI. PUT the bytes to the session URI (optional chunks of a multiple of 256 KB with `Content-Range`). Interrupted: PUT with `Content-Length: 0`, `Content-Range: bytes */TOTAL` → `308 Resume Incomplete` with `Range: bytes=0-N` (no Range = nothing received); resume from N+1. **201 Created** = done (body = video resource). 500/502/503/504 and dropped connections are resumable (exponential backoff); other 4xx permanent; **404 on the session URI = expired session, start over**. Session URI lifetime "finite", duration not stated.

### Google OAuth 2.0 (web server)
- Auth endpoint `https://accounts.google.com/o/oauth2/v2/auth`: client_id, redirect_uri (exact match), response_type=code, scope (space-separated), access_type=offline, state (CSRF), include_granted_scopes, prompt=consent.
- Token endpoint `https://oauth2.googleapis.com/token`: code, client_id, client_secret, redirect_uri, grant_type=authorization_code. Refresh: grant_type=refresh_token (response: access_token, expires_in, scope, token_type). Revoke: `https://oauth2.googleapis.com/revoke?token=…` (200; removes every scope granted to the project).
- **A refresh token is only returned on the first authorization** unless the grant is revoked or `prompt=consent` is sent.
- **Consent screen in "Testing" status → refresh tokens expire after 7 days.** Limit 100 refresh tokens per Google account per client (oldest invalidated silently). Also invalidated: revoked, unused for 6 months, password change (Gmail scopes), admin policy.
- Access-token lifetime: "limited" (no number on the page; `expires_in` is the truth).
- PKCE for web-server apps: not documented on either half of the page read; `state` is the documented CSRF defence.

### Facebook Pages / Video API (Graph v25.0)
- Permissions for Page posts: pages_manage_engagement, pages_manage_posts, pages_read_engagement, pages_read_user_engagement, **publish_video** for video (posts page); the video publishing page lists pages_show_list, pages_read_engagement, pages_manage_posts. The app user must hold a Page role allowing CREATE_CONTENT (and MANAGE, MODERATE per the posts page).
- Video publishing (current flow): 1) `POST https://graph.facebook.com/v25.0/<APP_ID>/uploads?file_name&file_length&file_type&access_token` → `{"id":"upload:<SESSION>"}`; 2) `POST https://graph.facebook.com/v25.0/upload:<SESSION>` with headers `Authorization: OAuth <USER_TOKEN>`, `file_offset: 0`, body = raw bytes → `{"h":"<handle>"}`; resume: `GET` the same URL with the Authorization header → `file_offset`, then POST again from that offset. 3) `POST https://graph-video.facebook.com/v25.0/<PAGE_ID>/videos` with access_token, title, description, `fbuploader_video_file_chunk=<handle>` → `{"id":"<video id>"}`. Supported types for the Resumable Upload API: **video/mp4** (plus pdf/jpeg/png).
- The older chunked flow (`upload_phase=start/transfer/finish`, `video_file_chunk`, `file_size`) is still listed on the /{page-id}/videos reference.
- Scheduling: `published=false` + `scheduled_publish_time` (unix int). **Feed posts: 10 minutes – 30 days; videos (per the /{page-id}/videos reference): 10 minutes – 6 months.** Unpublished videos cannot be backdated.
- Tokens: short-lived user token → long-lived (~60 days) via `GET oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token` (server side); Page tokens via `GET /{user-id}/accounts` with the long-lived user token; **a Page token from a long-lived user token has no expiry** (invalidated under conditions the page doesn't list).
- Login dialog `https://www.facebook.com/v25.0/dialog/oauth`: client_id, redirect_uri, **state (required)**, response_type (default code), scope. Exchange: `GET https://graph.facebook.com/v25.0/oauth/access_token?client_id&redirect_uri&client_secret&code` (server side). Inspect: `GET /debug_token?input_token=…&access_token=<app token>`. No PKCE on Facebook's page.
- Video status (Reels guide; "does not say whether it applies to regular Page videos"): `GET /<VIDEO_ID>?fields=status` → `status.video_status`: uploading | upload_complete | upload_failed | processing | ready | error | expired; `uploading_phase` / `processing_phase` / `publishing_phase` each `{status: not_started | in_progress | complete(d) | error}`; `publishing_phase.publish_status`: draft | error | published | scheduled.
- Not found on the pages read: a file-size / duration limit for Page videos (error 382 = file too small); App Review / Business Verification requirements (the posts page mentions only "Page Public Content Access" for Pages the user doesn't manage).

## Not verified (needs your credentials)

- A real upload from your Google Cloud project: whether videos from an unverified project are private-only (two official pages disagree), the real quota numbers on your project, and whether `youtube.readonly` is enough for `videos.list` processing status on your own uploads.
- Google's PKCE on the web-server flow: `code_challenge` is sent; the page read didn't document it for web apps (it is accepted in practice).
- A real Page upload: that the upload session takes the user token (as documented) rather than the Page token, the `fbuploader_video_file_chunk` parameter end to end, the video `status` fields for ordinary Page videos (documented for Reels), and App Review for Pages you don't own.
- Token lifetimes in practice: Google refresh tokens while the consent screen is in Testing (7 days), Facebook long-lived user tokens (about 60 days).
- Facebook video scheduling (`scheduled_publish_time`, 10 minutes to 6 months per the videos reference) is not used: the worker publishes at the scheduled time.
