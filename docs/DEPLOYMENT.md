# Production deployment

Tally deploys as two coordinated pieces:

- GitHub Pages hosts the static React application.
- Supabase hosts the private Postgres tables, capability-checked RPC functions, and the AI expense and receipt Edge Functions.

The production workflow verifies the frontend and database, builds with production client configuration, applies pending migrations, and publishes Pages only after the database release succeeds.

## Production scope

This is a production-ready trusted-group MVP. Live links are bearer capabilities: anyone with the complete URL can read, edit, and end that activity. Visible live tabs poll for newer revisions every 15 seconds, but there are no accounts, participant-level permissions, audit trail, realtime subscription, or per-participant revocation. Do not use this release for regulated, highly sensitive, or adversarial financial data.

## One-time setup

### 1. Create the production Supabase project

Create a project in [Supabase](https://supabase.com/dashboard), then record:

- the project reference from the dashboard URL;
- the project database password;
- the project URL;
- the publishable client key.

In **Integrations → Data API → Settings**, disable automatic exposure for new tables and functions when that option is available. Tally grants access only to its reviewed public RPC wrappers; application tables stay in the unexposed `private` schema. The migrations also remove anonymous default privileges for objects owned by the migration role.

Generate a personal access token from [Supabase account tokens](https://supabase.com/dashboard/account/tokens). The token and database password are deployment secrets; the project URL, project reference, and publishable key are intentionally safe client configuration.

Do not make production schema changes in the Dashboard. All schema changes must be committed under `supabase/migrations/` and released by CI, following [Supabase's migration workflow](https://supabase.com/docs/guides/deployment/database-migrations).

### 2. Create the GitHub production environment

In the repository, open **Settings → Environments → New environment** and create `production`.

Add these environment secrets:

| Name | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Personal access token used by the Supabase CLI |
| `SUPABASE_DB_PASSWORD` | Production project's database password |

Add these environment variables:

| Name | Value |
| --- | --- |
| `SUPABASE_PROJECT_ID` | Production project reference |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Production publishable key |
| `VITE_AI_EXPENSE_ENABLED` | `true` |

In the production Supabase project, configure these Edge Function secrets before the first AI release:

```text
AI_EXPENSE_ENABLED=true
OPENROUTER_API_KEY=<production-limited key>
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free
OPENROUTER_FALLBACK_MODEL=google/gemini-2.5-flash-lite
OPENROUTER_VOICE_MODEL=google/gemini-2.5-flash-lite
AI_RECEIPT_ENABLED=true
OPENROUTER_RECEIPT_MODEL=google/gemini-2.5-flash-lite
OPENROUTER_RECEIPT_FALLBACK_MODEL=google/gemini-2.5-flash
```

Receipt extraction uses the same server-only OpenRouter key. Flash Lite handles the normal strict-schema path; full Flash is a single JSON-compatibility recovery attempt only when local receipt validation rejects the first result. The recovery request includes the complete receipt contract and must pass the same local Zod validation. When a receipt has no printed subtotal, Tally derives it only from the validated item totals before reconciliation. The model names have reviewed defaults in source and may be overridden only when an alternative has passed the receipt contract suite.

Use a dedicated key with a deliberate account limit. Never expose it as a `VITE_` variable; only the Supabase Edge Function may read it.

Environment protection rules and a required reviewer are recommended. GitHub makes environment secrets available only to jobs that reference that environment and pass its protection rules.

### 3. Enable GitHub Pages Actions

In **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow uses the repository's existing `github-pages` deployment environment and the permissions required by GitHub's Pages actions.

## Deploy

1. Open a pull request from the release branch to `main`.
2. Wait for the `verify` job to pass.
3. Merge the pull request.
4. Approve the `production` environment deployment if protection is enabled.
5. Watch **Actions → CI and production deployment**.

The release order is:

1. typecheck, lint, 100% coverage, database migration/pgTAP tests, and Playwright;
2. production build with the Supabase URL and publishable key;
3. `supabase db push` against the linked production project;
4. deploy the versioned `parse-expense` and `parse-receipt` Edge Functions;
5. GitHub Pages artifact upload and deployment.

The workflow can also be started manually from `main` with **Run workflow**.

## Verify the release

- Open `https://pengfanz.github.io/splitbill/` in a fresh browser.
- Confirm the browser recognizes the web app manifest and offers installation, then load the installed app once and verify the local activity shell reopens while offline.
- Create an activity and choose **Share live**.
- Open the link in a private browser, add an expense, and confirm the first visible browser updates automatically within 15 seconds.
- Confirm the recipient receives a persistent `Live · CODE` activity, then go offline and verify that its last synced snapshot remains visible but read-only.
- Choose **Duplicate and edit** while offline and confirm the new independent local copy is editable without changing the Live activity.
- Choose **End live sharing**, confirm the old URL becomes unavailable in another browser, and verify both browsers retain their last synced read-only recovery copy with **Continue locally**.
- Create one local activity and one live activity, then confirm their allowlisted events appear separately in `private.analytics_daily` and `private.analytics_hourly`, and their resolved UI locale appears in `private.analytics_locale_daily`, without URL or activity fields.
- Open the AI text and AI voice tabs, create one draft with each mode, then confirm the explorer-session, requested, and ready rows appear in the **SplitBill - AI Entry Usage** Home report without prompts, audio, or expense fields.
- Open the receipt tab, submit one clear photo, review and assign its dishes, and confirm the saved expense equals the reviewed total exactly.
- Run Supabase Security Advisor and Performance Advisor after the first migration.
- Confirm the migration list is synchronized before the next release with `supabase migration list`.

## Operational requirements

- Backend activities expire 90 days after their last successful update and expired rows are removed incrementally during new activity creation. Each browser that opened the activity keeps its latest full snapshot locally until the person removes it or clears site data; after confirmed backend expiration, that saved copy can continue as a local activity and start a new Live session.
- Create, load, update, and analytics RPCs are rate-limited per secret-peppered identifier derived from the client IP. Rejected requests consume the same budget as successful requests. Review API/database logs and tune limits from observed traffic.
- First-party analytics events expire after 90 days and contain no URL, capability, identity, activity, or financial payload. Review aggregate usage with the queries in [ANALYTICS.md](ANALYTICS.md).
- AI text, voice, and receipt parsing have separate per-client database quotas plus server-only rolling project ceilings. Receipt parsing is limited to 3 attempts per network in 10 minutes, 10 per rolling day, and 200 project-wide per rolling day. Administrators can lower a ceiling or disable one mode in `private.ai_expense_budget_limits`; keep the OpenRouter key limit as the final hard cost ceiling and monitor privacy-safe request outcomes in the Home report.
- Free-tier projects should export regular off-site logical backups with `supabase db dump`. Paid projects provide daily backups; consider point-in-time recovery when the recovery objective warrants it. See [Supabase backups](https://supabase.com/docs/guides/platform/backups).
- Review Security Advisor and Performance Advisor after every schema change.
- If a capability URL leaks, use **End live sharing** immediately and create a new Live session from a trusted recovery copy. Tally still has no participant-specific revocation or token rotation.
- The production build derives the exact HTTPS Supabase `connect-src` origin from `VITE_SUPABASE_URL`; missing or unsafe values fall back to the production origin. Local and test endpoints are added only by the explicit browser-test build flag and are absent from release artifacts.

## Rollback

Frontend rollback is a normal revert on `main`, followed by the same workflow. Database migrations are forward-only: write a corrective migration rather than deleting or editing a migration that may already be applied. Keep RPC signatures backward-compatible so the currently deployed frontend continues working if a later release step fails.

For an immediate AI-only stop, set `AI_EXPENSE_ENABLED=false` or `AI_RECEIPT_ENABLED=false` in the production Edge Function environment and redeploy the corresponding function. The manual expense form remains the default and continues to work. A later frontend build can remove the corresponding optional tabs.
