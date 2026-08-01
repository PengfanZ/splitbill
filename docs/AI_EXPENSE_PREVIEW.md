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

1. The browser sends only the description, any clarification answer, current currency, resolved interface locale, and the current activity’s member IDs and names.
2. The OpenRouter key exists only in the Supabase Edge Function.
3. Tiny, clearly incomplete category-only descriptions receive a deterministic, localized clarification before any provider request or quota consumption.
4. Substantive descriptions in any language, dialect, shorthand, or mixed language go to the model; language-specific regexes never block them.
5. The Edge Function accepts a publishable client request, checks a server-only rate limit, prefers the cheapest model that meets a three-second p90 latency target, and requests no provider data collection.
6. A strict JSON Schema constrains the model response.
7. Titles and clarification questions follow the description's language, with the interface locale used only as a fallback.
8. Zod and deterministic business rules reject unknown members, invalid cents, duplicate participants, and exact splits that do not equal the total.
9. Remaining ambiguity—and any model output that cannot be normalized safely—becomes one clarification question instead of a guess or a misleading provider-outage error.
10. A valid result only pre-fills the existing expense form. The user remains the final validator and saver.

This does not use RAG: there is no external knowledge to retrieve. Reliability comes from narrowly scoped context, structured output, deterministic validation, clarification, and explicit human review.

## Model and cost control

The candidate models are pinned to `google/gemma-4-26b-a4b-it:free` and `google/gemini-2.5-flash-lite`. OpenRouter prefers the cheapest eligible route whose recent p90 latency is at most three seconds, while keeping slower routes available as fallbacks. This lets the free model win when it is healthy and responsive, but permits the low-cost model to protect the interactive experience. OpenRouter charges only for the model that ultimately responds. Override either candidate with `OPENROUTER_MODEL` or `OPENROUTER_FALLBACK_MODEL` only after running the same evaluation examples and browser flow.

A successful provider response that does not satisfy the expense contract is treated as an incomplete conversation: the user receives a localized prompt to restate the amount, payer, and participants. A genuine upstream failure is logged without the expense text and shown as a model-specific retry/manual-entry message. The request has a bounded timeout so an unavailable route cannot leave the user waiting indefinitely.

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
OPENROUTER_FALLBACK_MODEL=google/gemini-2.5-flash-lite
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
