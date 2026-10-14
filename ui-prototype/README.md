# MediaFlow — static UI prototype

Clickable HTML prototype of the AI Media Content Management & Social Posting Scheduler.
Open `index.html` in a browser; no build step is needed. You need an internet connection, because Tailwind, Lucide and Inter load from CDNs.

All data is mock data in `assets/data.js`. "Today" is fixed to **2026-10-13**.

## Pages

| File | Screen |
|---|---|
| `index.html` | Dashboard: summary cards, pipeline, upcoming schedule, missing items, week strip, activity |
| `content.html` | Content list: table/card views, quick status tabs, filters, search, bulk actions, row menu |
| `content-detail.html?id=c-101` | Content workspace: progress stepper, readiness warnings, and Overview / Script / Images / Video / Publishing / Activity tabs |
| `calendar.html` | Month / Week / Day calendar with drag-and-drop rescheduling, plus a "Ready to schedule" tray |
| `schedule.html` | Publishing queue: worker status, failed posts with Retry/Reschedule, queue grouped by day |
| `media.html` | Media library filtered by type, content, usage and date, with an upload dialog |
| `accounts.html` | Connected YouTube channels and Facebook Pages, token-expired state, platforms coming soon |
| `analytics.html` | KPIs, daily views chart, platform comparison, best-time heatmap, top content, per-video table |
| `prompts.html` | AI prompt library: create, edit, duplicate, copy and delete, with `{variable}` detection |
| `settings.html` | Profile, categories/series/campaigns, workflow rules, notifications, AI keys, danger zone |

The **Create Content** and **Schedule Post** dialogs are shared and live in `assets/layout.js`.

## Assets → future Next.js structure

| Prototype | Becomes |
|---|---|
| `assets/tailwind.config.js` | `tailwind.config.ts` theme (cream `#FFFDD0`, olive `#556B2F`) |
| `assets/styles.css` | shadcn/ui primitives: Button, Card, Badge, Tabs, Dialog, Table |
| `assets/logic.js` | `lib/workflow.ts`: stage, readiness, checklist and schedule validation rules |
| `assets/ui.js` | `components/`: StatusBadge, PlatformIcon, Thumb, MiniSteps, ConfirmDialog |
| `assets/layout.js` | `app/(app)/layout.tsx`: Sidebar, Topbar, Notifications |
| `assets/data.js` | Prisma seed data (Content, PublishingJob, SocialAccount, …) |
