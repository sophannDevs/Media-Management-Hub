# Audit implementation progress

Tracks the 72 findings from the MediaFlow audit (14 Oct 2026). Every finding is
implemented in its own commit on the `audit-implementation` branch; `main`
(tag `audit-baseline`) is the code exactly as audited.

Decisions the report left open were taken with its own recommendations:

| Decision | Taken |
|---|---|
| Repost rule | One active schedule per content and account. Posting again to an account that already has the post needs an explicit "post again" flag. |
| Who signs in | A single owner first. Roles later. |
| PostgreSQL | Move before real platform integrations (Phase 2). |
| Platform order | YouTube first, Facebook second. |
| Google AI access | No key known: Gemini is labelled "needs API access". Nothing claims generation works until it is verified. |

Status: ✅ done and verified · 🟡 done, needs your credentials to verify against the real service · ⏳ not started

## Phase 1 — Critical fixes and quick wins

| ID | Status | What changed | Verified by |
|---|---|---|---|
| PROC-01 | ✅ | Git repository with a baseline commit (`audit-baseline`); CI workflow in `.github/workflows/ci.yml`. Add a remote with `git remote add origin <url>` to run CI on GitHub. | Baseline commit `3415144`. |
| TEST-01 | ✅ | Vitest (unit + integration on throwaway SQLite copies), Playwright + axe at 1440/820/390 px, fault-injection helpers. The audit's reproductions are now tests marked as known failures until their fix lands. | `npm test`: 15 passed, 8 known failures. `npm run test:e2e`: 60 passed (30 smoke, 30 axe known failures). |
| SEC-10 | ✅ | `npm run audit:prod` fails on new high/critical advisories in production dependencies. One allowlisted (deepmerge-ts via the Prisma CLI config loader) with its reason. | Exit 0 with the allowlist; a new advisory exits 1. |
| PUB-01 | ✅ | Publishing runs as claim → publish → persist → side effects. The platform's answer is saved first (external id on its own, then the status, each retried) and a confirmed success is never turned into a failure. Activity log, notification and status sync are best effort. An error after the upload may have started is `UNKNOWN_OUTCOME`: the platform is asked before anything is sent again. | Before: 2 uploads for one post when the notification, activity log or status sync failed after success. After: 1 upload, PUBLISHED, job SUCCEEDED (3 fault-injection tests). |
| PUB-02 | ✅ | A 2-minute lease (`lockedBy`, `lockedUntil`) renewed every 40 s while the upload runs, and on upload progress. Only expired leases are recovered, and recovery checks the platform (`reconcile`) before re-sending. Providers can save resumable upload state (`uploadState`). | Before: a tick 16 minutes into an upload sent it again. After: 1 upload. Five recovery tests: saved answer, platform has it, platform hasn't, platform can't tell (flagged for a person), unexpected error. |
| PUB-03 | ✅ | One active schedule per content and account (`activeKey` + unique index, backfilled), a per-submission form token (`idempotencyKey`), and an explicit **Post again** for content already published to that account. The dialog shows "Already scheduled … Open that post". | Before: 2 rows for two identical creates. After: 1 row and `ALREADY_SCHEDULED`; a resubmitted token returns the same row. |
| PUB-04 | ✅ | Edit, reschedule, cancel and retry only write if the post is still in a state a person may change; losing the race to the worker returns "This post started publishing a moment ago". Retrying a post whose last attempt may have gone live asks for confirmation first. | Four race tests (the worker claims between the read and the write): the post stays PROCESSING with its attempt count. |
| PUB-05 | ✅ | A "Simulation mode" banner on every page while a platform is simulated. Posts published by a simulated provider are stored with `simulated = true` and read **Simulated** (never "Published") in the queue, calendar, dashboard, content list and workspace; their made-up "View post" links are hidden. Generated metrics carry `AnalyticsSnapshot.source = MOCK`, only simulated posts get them, and every figure built from them says so (dashboard views, calendar best times, Analytics notice). Notifications and activity say "Simulated publish". | Integration: simulated vs real provider flags and notification text; generated metrics only for simulated posts. E2E at 3 widths: banner on all 9 pages, queue shows "Simulated" and no "View post", dashboard and Analytics label generated numbers. |
