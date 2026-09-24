# Tally (splitbill) — Agent Guide

Shared instructions for coding agents (Codex reads this file; Claude Code reads it through `CLAUDE.md`). Keep project knowledge here so both stay in sync.

Tally is a local-first, no-account shared-expense PWA: React 19 + TypeScript + Vite, TanStack Query, Zod, optional Supabase backend (Live sharing, analytics, feedback, AI quotas) and Supabase Edge Functions + OpenRouter for text/voice/receipt drafting. Production: https://pengfanz.github.io/splitbill/ (Vite base path `/splitbill/`).

Read before changing a boundary: [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md), [CONTRIBUTING.md](CONTRIBUTING.md), and the matching doc in `docs/` (ANALYTICS, LIVE_SHARING_EXPERIMENT, DEPLOYMENT, AI_EXPENSE_PREVIEW, FEEDBACK, EXPENSE_CATEGORIES, FRIEND_REMOVAL, RECEIPT_DIAGNOSTICS).

## Checks (same as CI)

```bash
npm run typecheck
npm run lint            # zero warnings
npm run test:coverage   # 100% statements/branches/functions/lines — required
npm run build:pages
```

Backend work: `npm run backend:start`, `npm run backend:reset`, `npm run test:backend` (pgTAP). Browser flows: `npm run test:e2e`. Playwright may fail with `listen EPERM 127.0.0.1:4173` inside a sandbox — rerun where the port can bind.

## Code rules

- Financial math lives in pure modules under `src/domain/` (no React imports). Persistence stays behind `src/data/` and `src/hooks/`. Direct imports, no barrels.
- Preserve the `tally:frontend:v2` localStorage schema (and `tally:identity:v1`) unless the change ships a tested migration.
- Every bug fix gets a regression test; new behavior gets user-focused tests.
- The frontend talks to Supabase via `fetch` to PostgREST RPCs in `src/features/liveSharing/liveActivityApi.ts` (`create_shared_activity`, `load_shared_activity`, `poll_shared_activity`, `update_shared_activity_v2`, `record_analytics_event`) — not `supabase-js` table queries. Browser roles never touch the `private` schema. Check SQL migrations before describing or changing the RPC contract.
- Live edit tokens live in the `#live=` URL fragment; the DB stores only a SHA-256 hash. Saves send an expected revision.
- New Supabase schema changes go in `supabase/migrations/` with pgTAP coverage in `supabase/tests/`.

## Privacy rules

- Analytics are allowlisted event names plus coarse metadata only (surface, locale, hashed session). Never send names, amounts, descriptions, balances, category names/IDs, activity IDs, URLs, or capability tokens. Mutation events fire only after successful persistence.
- Never print or commit publishable keys, edit tokens, session tokens, or capability URLs; use `<publishable-key>` / `[REDACTED]` in notes.
- Async analytics requests can arrive out of order — assert on the event-name set, not arrival order.

## Sharing gotcha

Native PNG sharing in `src/features/sharing/shareActivity.ts` passes `{ files: [file] }` only — adding `title`/`text`/`url` breaks WebKit/WeChat. If native share fails or is unsupported, download the PNG rather than substituting text.

## Receipt AI gotchas

- Do not send receipt requests with strict `json_schema` output: Gemini Flash Lite models return a near-empty object or run to the token limit. Use JSON mode with the contract in the prompt plus local Zod validation.
- Keep OpenRouter `provider.sort.partition` at `'model'` when listing fallback models; `'none'` sorts every model by price and routes to the cheapest fallback first.
- Change receipt models only after running `scripts/receipt-eval` (see [docs/AI_EXPENSE_PREVIEW.md](docs/AI_EXPENSE_PREVIEW.md#choosing-receipt-models)). `OPENROUTER_RECEIPT_MODEL` / `OPENROUTER_RECEIPT_FALLBACK_MODEL` secrets override the code defaults; production currently sets neither, so it uses the defaults. Check the project's secret names before assuming otherwise.

## Workflow

- Work on a feature branch and open a PR to `main`; merging to `main` runs CI and deploys (migrations → Edge Functions → GitHub Pages).
- Deploy only when the maintainer explicitly asks. After deploying, verify the production URL (fetch the HTML, then the referenced `assets/index-*.js`), not just the local build. Clean up any smoke-test data.
- Report security issues privately per [SECURITY.md](SECURITY.md); never describe unfixed vulnerabilities in public files, commits, or PRs.
