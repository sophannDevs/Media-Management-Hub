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
