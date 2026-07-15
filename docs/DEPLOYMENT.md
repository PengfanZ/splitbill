# Production deployment

Tally deploys as two coordinated pieces:

- GitHub Pages hosts the static React application.
- Supabase hosts the private Postgres tables and capability-checked RPC functions.

The production workflow verifies the frontend and database, builds with production client configuration, applies pending migrations, and publishes Pages only after the database release succeeds.

## Production scope

This is a production-ready trusted-group MVP. Live links are bearer capabilities: anyone with the complete URL can read and edit that activity. Visible live tabs poll for newer revisions every 15 seconds, but there are no accounts, participant-level permissions, audit trail, realtime subscription, or token revocation yet. Do not use this release for regulated, highly sensitive, or adversarial financial data.

## One-time setup

### 1. Create the production Supabase project

Create a project in [Supabase](https://supabase.com/dashboard), then record:

- the project reference from the dashboard URL;
- the project database password;
- the project URL;
- the publishable client key.

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
4. GitHub Pages artifact upload and deployment.

The workflow can also be started manually from `main` with **Run workflow**.

## Verify the release

- Open `https://pengfanz.github.io/splitbill/` in a fresh browser.
- Confirm the browser recognizes the web app manifest and offers installation, then load the installed app once and verify the local activity shell reopens while offline.
- Create an activity and choose **Share live**.
- Open the link in a private browser, add an expense, and confirm the first visible browser updates automatically within 15 seconds.
- Confirm the recipient receives a persistent `Live · CODE` shortcut.
- Create one local activity and one live activity, then confirm their allowlisted events appear separately in `private.analytics_daily` without URL or activity fields.
- Run Supabase Security Advisor and Performance Advisor after the first migration.
- Confirm the migration list is synchronized before the next release with `supabase migration list`.

## Operational requirements

- Activities expire 90 days after their last successful update. Expired rows are removed incrementally during new activity creation.
- Create, load, and update RPCs are rate-limited per hashed client IP. Review API/database logs and tune limits from observed traffic.
- First-party analytics events expire after 90 days and contain no URL, capability, identity, activity, or financial payload. Review aggregate usage with the queries in [ANALYTICS.md](ANALYTICS.md).
- Free-tier projects should export regular off-site logical backups with `supabase db dump`. Paid projects provide daily backups; consider point-in-time recovery when the recovery objective warrants it. See [Supabase backups](https://supabase.com/docs/guides/platform/backups).
- Review Security Advisor and Performance Advisor after every schema change.
- If a capability URL leaks, treat the activity as compromised. Token rotation/revocation is a required follow-up before serving groups that need stronger access control.
- If a custom Supabase API domain is introduced, add its origin to the `connect-src` policy in `index.html`.

## Rollback

Frontend rollback is a normal revert on `main`, followed by the same workflow. Database migrations are forward-only: write a corrective migration rather than deleting or editing a migration that may already be applied. Keep RPC signatures backward-compatible so the currently deployed frontend continues working if a later release step fails.
