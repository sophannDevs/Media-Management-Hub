# MediaFlow — AI media content management & social posting scheduler

Manage AI-generated videos through the whole pipeline (**Idea → Script → Images → Video → Review → Schedule → Publish → Analytics**) and schedule posts to YouTube and Facebook from one place.

## Quick start

```bash
npm install            # also runs `prisma generate`
npx prisma migrate dev # creates prisma/dev.db (SQLite)
npm run db:seed        # optional: demo content, schedules, accounts, analytics
npm run dev            # http://localhost:3000
```

Copy `.env.example` to `.env` first if you don't have one. Useful scripts: `npm run typecheck`, `npm run lint`, `npm run db:studio`, `npm run db:reset` (wipes the database).

### Tests

```bash
npm test               # unit + integration tests (Vitest); each test file gets its own throwaway database
npm run test:e2e       # Playwright: builds the app, seeds prisma/e2e.db and checks every page at 3 widths (smoke + axe)
npm run audit:prod     # fails on high/critical advisories in production dependencies (allowlist in scripts/audit-check.mjs)
```

Tests never touch `prisma/dev.db` or `./storage`. The first `test:e2e` run needs Chromium: `npx playwright install chromium`. CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, the advisory check and the end-to-end suite on every push. Progress on the audit findings is tracked in `docs/audit/progress.md`.

### Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file for local use. For production, switch `provider` to `postgresql` in `prisma/schema.prisma`. |
| `STORAGE_DIR` | Where uploaded media is stored (default `./storage`). |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Enables **Generate with Claude** for scripts (default model `claude-opus-5-5`). Without a key, generation produces a mock draft. |
| `PUBLISH_WORKER_ENABLED`, `PUBLISH_WORKER_INTERVAL_SECONDS` | The in-process publishing worker checks the queue every N seconds while the server runs. |
| `CRON_SECRET` | Enables `POST /api/cron/publish` for an external scheduler (send `Authorization: Bearer <secret>`). Empty = the endpoint is disabled (503). |
| `ALLOWED_ORIGINS` | Extra hosts allowed to POST to the API (CSRF check), e.g. behind a reverse proxy. The app's own host is always allowed. |
| `HTTPS_ONLY` | `true` when served over HTTPS: adds HSTS and `upgrade-insecure-requests` to the security headers. |
| `MOCK_PUBLISH_FAILURE_RATE` | Optional, e.g. `0.2`: makes the simulated publisher fail randomly so you can exercise the retry flow. |

## What's implemented (Phase 1)

- **Dashboard**: pipeline counts, upcoming posts, missing items per video, this week's schedule, recent activity, failed-post and token alerts.
- **Content**: table and card views, quick status tabs, filters, search, bulk actions (status, category, tag, schedule, archive, delete) and CSV export.
- **Content workspace** (`/content/[id]`): six tabs.
  - **Overview** and **Checklist**.
  - **Script**: versions, paste and copy, and Claude generation.
  - **Images**: prompt, variations and final selection.
  - **Video**: final video, thumbnail, audio.
  - **Publishing**: a schedule per platform, with retry and reschedule.
  - **Activity**.
- **Workflow rules** (`src/lib/workflow/rules.ts`): "Ready to Post" requires an approved script, approved and selected images, a Final video and an approved review. You can toggle these rules in Settings. Publishing status is always derived and never set by hand. A schedule needs a ready video, a connected account on that platform and a future time.
- **Calendar**: month, week and day views with drag-and-drop rescheduling.
- **Publishing queue**: shows the worker status. Failed posts keep their error and offer retry or reschedule.
- **Media Library**: uploads with size and duration read in the browser, filtering, usage tracking and preview.
- **Social Accounts**: connect, reconnect and disconnect accounts, and set a default. There's a token-expiry warning.
- **Analytics**: KPIs, views over time, platform comparison, best posting time and top content. The numbers are demo data until the platform APIs are connected.
- **AI Prompt Library**: create, edit, duplicate, copy and delete prompts, with `{variable}` detection.
- **Settings**: workspace, taxonomies, workflow rules, retry policy, notifications, AI integration status and the archive.
- **Notifications**: ready to schedule, scheduled for tomorrow, published, failed, token expired, and incomplete assets close to the target date.

Authentication is intentionally not included yet. The app runs as a single workspace owner.

## Architecture

```
prisma/schema.prisma        data model (string status codes → portable & extensible)
src/lib/workflow/           statuses (codes, labels, tones) + pure business rules
src/lib/platforms/          platform providers (YouTube, Facebook) behind one interface
src/lib/storage/            storage provider (local disk; swap for S3/R2 later)
src/lib/ai/claude.ts        Claude script generation (Anthropic SDK, streaming)
src/server/services/        domain operations used by actions, routes and the worker
src/server/actions/         Server Actions (zod-validated) called from the UI
src/server/queries/         read models for pages
src/server/worker.ts        publishing worker (started from src/instrumentation.ts)
src/app/(app)/              pages (Server Components + small client components)
src/app/api/                file serving, uploads, CSV export, cron trigger
src/components/app/         shared app components (status badge, schedule dialog, …)
src/components/ui/          shadcn/ui
```

- **Next.js 16 with Cache Components**: pages render a static shell and stream database-backed content inside `<Suspense>`. Mutations call `refresh()` so the current page re-renders with fresh data.
- **Publishing**: each `PublishingSchedule` (content × platform × account × time) is processed by the worker. Every attempt is stored as a `PublishingJob`.
  - Retryable errors are retried with a delay you set in Settings.
  - Authentication errors mark the account as Token Expired and send a notification.
- **Adding a platform** (TikTok, Instagram, …): implement `PlatformProvider` in `src/lib/platforms/`, register it in `registry.ts`, and enable the row in the `Platform` table.

## Next phases

- **Phase 2**: authentication, PostgreSQL, cloud file storage, OAuth for YouTube (Data API v3) and Facebook (Graph API), and a dedicated publishing worker process.
- **Phase 3**: Google AI image generation, automated content generation, analytics sync from the YouTube Analytics and Facebook Insights APIs, and email notifications.

The approved static design prototype is kept in `ui-prototype/`.
