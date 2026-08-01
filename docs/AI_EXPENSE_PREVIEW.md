# Conversational expense entry preview

This experiment converts a short description such as “Maya paid $36 for dinner, split between Maya and me” into a reviewable expense draft. It does not save anything until the user checks the normal expense form and chooses **Save expense**.

## Release boundary

The stable app stays on `main` at `https://pengfanz.github.io/splitbill/`. The experiment stays on `codex/ai-expense-entry` and must use:

- a separate frontend URL and origin, so preview local storage and PWA caches cannot affect production;
- a separate Supabase preview project, so migrations, rate limits, logs, and Edge Function secrets cannot affect production;
- a preview-only OpenRouter API key with a low account limit;
- both feature switches described below.

Do not add `VITE_AI_EXPENSE_ENABLED` to the GitHub Pages production environment. Without that exact `true` value, the stable manual expense flow is the only flow bundled into the UI.

## Why this design is safe to trial

1. The browser sends only the description, current currency, resolved locale, and the current activity’s member IDs and names.
2. The OpenRouter key exists only in the Supabase Edge Function.
3. Clearly incomplete descriptions receive a deterministic, localized clarification before any provider request or quota consumption.
4. The Edge Function accepts a publishable client request, checks a server-only rate limit, pins one free model, disables provider fallback, and requests no provider data collection.
5. A strict JSON Schema constrains the model response.
6. Zod and deterministic business rules reject unknown members, invalid cents, duplicate participants, and exact splits that do not equal the total.
7. Remaining ambiguity becomes one clarification question instead of a guess.
8. A valid result only pre-fills the existing expense form. The user remains the final validator and saver.

This does not use RAG: there is no external knowledge to retrieve. Reliability comes from narrowly scoped context, structured output, deterministic validation, clarification, and explicit human review.

## Model and cost control

The initial model is pinned to `google/gemma-4-26b-a4b-it:free`, a non-reasoning free model that currently advertises structured-output support. Override it with `OPENROUTER_MODEL` only after running the same evaluation examples and browser flow. Automatic provider fallback is disabled, so a model outage produces a clear retry/manual-entry message rather than silently switching to a paid or differently behaving model. The request has a bounded timeout so a busy free endpoint falls back to manual entry instead of leaving the user waiting indefinitely.

The server allows 30 AI draft requests per normalized client identifier per 10-minute window. OpenRouter account limits remain the hard cost ceiling. Start with a preview-only key and the smallest available limit; never reuse a broad personal key.

## Local setup

```bash
cp .env.example .env.local
npm run backend:start
npm run backend:reset
```

Use the local Supabase URL and publishable key printed by `npm run backend:start`, then change this client flag in `.env.local`:

```dotenv
VITE_AI_EXPENSE_ENABLED=true
```

Copy `supabase/functions/.env.example` to the ignored `supabase/functions/.env.local`, set a preview OpenRouter key, then serve the function:

```bash
npx supabase functions serve parse-expense --env-file supabase/functions/.env.local
```

The Edge Function also requires `AI_EXPENSE_ENABLED=true`; either switch disables the feature independently.

Run the complete gates before sharing the preview:

```bash
npm run typecheck
npm run lint
npm run test:coverage
npm run test:backend
npm run test:e2e
```

## Separate preview deployment

### 1. Backend

Create a dedicated Supabase preview project. Apply this branch’s migrations and deploy only `parse-expense` to that project. Configure these Edge Function secrets in the preview project:

```text
AI_EXPENSE_ENABLED=true
OPENROUTER_API_KEY=<preview-only key>
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free
```

Keep the production project reference out of the preview deployment environment. The database function `consume_ai_expense_quota` is executable only by the service role used inside the Edge Function; browser clients cannot call it directly.

### 2. Frontend

Create a separate Cloudflare Pages project connected to the same GitHub repository, with `codex/ai-expense-entry` as that project’s production branch.

Use:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| `VITE_AI_EXPENSE_ENABLED` | `true` |
| `VITE_SUPABASE_URL` | Preview Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Preview project publishable key |

This yields a stable `*.pages.dev` preview origin while the existing GitHub Pages production deployment remains owned by `main`.

### 3. Kill switches and rollback

- Fastest backend stop: set `AI_EXPENSE_ENABLED=false` in the preview Edge Function and redeploy it.
- Frontend stop: set `VITE_AI_EXPENSE_ENABLED=false` and rebuild the preview.
- Full rollback: redeploy the previous preview commit. Do not revert or redeploy `main` for a preview-only failure.

## Keeping the experiment current

Regular customer fixes continue to land on `main`. Before each preview deployment, bring them into the experiment and rerun every gate:

```bash
git fetch origin main
git switch codex/ai-expense-entry
git merge --no-edit origin/main
npm run typecheck
npm run lint
npm run test:coverage
npm run test:backend
npm run test:e2e
```

Resolve any conflict in favor of the current `main` behavior first, then reapply the smallest AI integration. Keep the preview as a draft pull request so GitHub continuously shows whether it is mergeable and whether CI remains green. The preview is not merged until model quality, cost, privacy copy, and user feedback are acceptable.

## Trial checklist

- Try English and Simplified Chinese descriptions.
- Cover equal splits, a subset of members, and exact amounts.
- Verify ambiguous payer, amount, or participant wording asks for clarification.
- Verify invented member names and malformed provider responses are rejected.
- Confirm manual entry and existing expense editing behave exactly as on `main`.
- Test a short mobile viewport and keyboard-only navigation.
- Review OpenRouter usage and Supabase Function logs after each small friend trial.
- Never paste card numbers, bank details, passwords, or private notes into the preview description.
