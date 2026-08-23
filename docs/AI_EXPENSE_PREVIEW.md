# Conversational expense entry

Conversational expense entry is available in production as an optional shortcut alongside the default manual form. A typed description or voice recording can describe one expense or several expenses at once. Tally preserves their order, presents every draft for review, and saves nothing until the user confirms.

## Release boundary

The feature was validated on an isolated frontend and Supabase preview before its production release. Future model, prompt, quota, or audio changes should use the same boundary:

- a separate frontend URL and origin, so preview local storage and PWA caches cannot affect production;
- a separate Supabase preview project, so migrations, rate limits, logs, and Edge Function secrets cannot affect production;
- a preview-only OpenRouter API key with a low account limit;
- both feature switches described below, so either deployment can disable AI entry without affecting manual entry.

Production enables the feature only when the Edge Function secrets are configured, `VITE_AI_EXPENSE_ENABLED=true` is present in the GitHub `production` environment, and `AI_EXPENSE_ENABLED=true` is set on the server. Without both exact flag values, the stable manual expense flow remains available while AI entry is disabled.

## Why this design is safe to trial

1. The browser sends only the typed description or temporary recording, any clarification answer, current currency, resolved interface locale, and the current activity’s member IDs and names. Voice is converted locally to mono 16 kHz PCM WAV, capped at 60 seconds, and never stored by Tally.
2. The OpenRouter key exists only in the Supabase Edge Function.
3. Tiny, clearly incomplete category-only descriptions receive a deterministic, localized clarification before any provider request or quota consumption.
4. Substantive descriptions in any language, dialect, shorthand, or mixed language go to the model; language-specific regexes never block them.
5. The Edge Function accepts a publishable client request, checks a server-only rate limit, prefers the cheapest model that meets a three-second p90 latency target, opts out of provider data collection, and requires an OpenRouter Zero Data Retention endpoint.
6. A strict JSON Schema constrains every model-generated expense without imposing a fixed expense-count limit.
7. Titles and clarification questions follow the description's language, with the interface locale used only as a fallback.
8. Zod and deterministic business rules reject unknown members, invalid cents, duplicate participants, and exact splits that do not equal the total.
9. Remaining ambiguity becomes a clarification question, and every answer is appended to a bounded structured history so later turns cannot forget earlier details.
10. One result still pre-fills the existing expense form. Multiple results open a batch review where every draft can be edited or removed.
11. A batch is saved atomically: one local state update or one Live revision contains all confirmed expenses, so provider ambiguity and failed Live saves cannot leave a partial batch behind.

This does not use RAG: there is no external knowledge to retrieve. Reliability comes from narrowly scoped context, structured output, deterministic validation, clarification, and explicit human review.

## Model and cost control

Typed descriptions use the candidates `google/gemma-4-26b-a4b-it:free` and `google/gemini-2.5-flash-lite`. OpenRouter prefers the cheapest eligible zero-retention route whose recent p90 latency is at most three seconds, while keeping slower eligible routes available as fallbacks. Voice goes directly to the audio-capable `google/gemini-2.5-flash-lite`, avoiding a separate transcription request. Override either model only after confirming it appears in OpenRouter's current ZDR catalog and running the same multilingual voice and browser checks.

A successful provider response that does not satisfy the expense contract is treated as an incomplete conversation: the user receives a localized prompt to restate the amount, payer, and participants. A genuine upstream failure is logged without the expense text and shown as a model-specific retry/manual-entry message. The request has a bounded timeout so an unavailable route cannot leave the user waiting indefinitely.

The server maintains separate cost budgets per normalized client identifier. Text allows 30 requests per 10 minutes and 100 per day; voice allows 10 per 10 minutes and 25 per day. A second, server-only project ceiling defaults to 500 text and 100 voice provider calls per rolling day, stopping distributed traffic that no single-client quota would catch. Administrators can lower a ceiling or disable one mode in `private.ai_expense_budget_limits`. Counters are consumed before the provider call, including provider failures, and the stricter limit wins. OpenRouter account limits remain the final hard cost ceiling. Use a preview-only key with a deliberately small limit, but leave enough unused budget for OpenRouter to authorize one worst-case voice request; an almost-exhausted `$0.01` key can reject a recording before the model runs. Never reuse a broad personal key.

Each browser also keeps an activity-scoped participant selection. The selected member ID is sent with text and voice requests as `viewerMemberId`, allowing first-person phrases such as “I paid” or “我付的” to resolve to an existing activity member. This selection stays in local storage and is never written into the shared activity snapshot, so collaborators can choose independently on each browser.

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

Copy `supabase/functions/.env.example` to the ignored `supabase/functions/.env.local`, set a development OpenRouter key, then serve the function:

```bash
npx supabase functions serve parse-expense --env-file supabase/functions/.env.local
```

The Edge Function also requires `AI_EXPENSE_ENABLED=true`; either switch disables the feature independently.

Run the complete gates before sharing a local or hosted preview:

```bash
npm run typecheck
npm run lint
npm run test:coverage
npm run test:backend
npm run test:e2e
```

## Isolated preview for future AI changes

### 1. Backend

Create a dedicated Supabase preview project. Apply the candidate branch's migrations and deploy only `parse-expense` to that project. Configure these Edge Function secrets in the preview project:

```text
AI_EXPENSE_ENABLED=true
OPENROUTER_API_KEY=<preview-only key>
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free
OPENROUTER_FALLBACK_MODEL=google/gemini-2.5-flash-lite
OPENROUTER_VOICE_MODEL=google/gemini-2.5-flash-lite
```

Keep the production project reference out of the preview deployment environment. The database function `consume_ai_expense_quota_v2` is executable only by the service role used inside the Edge Function; browser clients cannot call it directly or read the private budget table.

If voice recording stops normally but the app reports that its AI budget was reached, check the preview key—not only the account balance—in OpenRouter's **API Keys** page. The key's own cumulative credit limit may be lower than the account balance. Raise that preview-only cap intentionally, then run one short voice request and confirm its cost in OpenRouter Logs.

### 2. Frontend

Create or reuse a separate Cloudflare Pages project connected to the same GitHub repository, with the candidate AI branch as that project's production branch.

Use:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| `VITE_AI_EXPENSE_ENABLED` | `true` |
| `VITE_SUPABASE_URL` | Preview Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Preview project publishable key |

This yields a stable `*.pages.dev` preview origin while the existing GitHub Pages production deployment remains owned by `main`.

## Receipt splitting experiment

Receipt splitting uses the same isolated-preview boundary but remains a separate feature. Enable it only on the experimental frontend with:

```dotenv
VITE_RECEIPT_SPLIT_ENABLED=true
```

Deploy the `parse-receipt` Edge Function and configure these preview-only server values:

```text
AI_RECEIPT_ENABLED=true
OPENROUTER_RECEIPT_MODEL=google/gemini-2.5-flash-lite
OPENROUTER_RECEIPT_FALLBACK_MODEL=google/gemini-2.5-flash-lite
```

Receipt extraction defaults to `google/gemini-2.5-flash-lite` because it accepts images and is fast and inexpensive. OpenRouter's current Google routes reject this nested receipt contract when sent as provider-enforced JSON Schema, so the experiment uses JSON mode, includes the complete contract in the prompt, and rejects any response that fails strict local Zod validation. Nothing reaches an expense without deterministic reconciliation and human confirmation. Reconsider a free model after the full receipt contract suite passes against it.

The browser converts a selected receipt to a bounded JPEG before upload. The Edge Function consumes quota before reading the request body, accepts only JPEG, PNG, or WebP input, and limits both request and provider-response bytes. Tally does not ask the model to decide who paid or how to split the bill. The model returns only reviewable receipt facts—merchant, items, printed details, subtotal, charges, total, and unresolved lines. Deterministic application code assigns shared dishes, allocates tax, service charges, discounts, and optional tips, reconciles every cent, and creates the final exact-split expense only after confirmation.

Receipt traffic has separate client and project budgets from text and voice expense entry. The preview defaults are 10 requests per 10 minutes and 30 per client per day, with a 200-request project ceiling per rolling day. Provider failures still consume quota so retry storms cannot fan out cost.

The experiment accepts common browser-decodable JPEG, PNG, WebP, HEIC, and HEIF selections. HEIC/HEIF is converted locally and therefore depends on the browser's decoder; when decoding is unavailable, Tally asks the user to choose a JPEG/PNG/WebP copy instead of uploading the original format.

Before sharing the experiment, verify a clear printed receipt, a receipt with item modifiers, a shared dish, a discount, tax/service charges, a custom tip, an unresolved line, a currency mismatch, and a malformed model response. Confirm that no expense is saved until the final review succeeds and that the person totals always equal the receipt total exactly.

### 3. Kill switches and rollback

- Fastest backend stop: set `AI_EXPENSE_ENABLED=false` in the preview Edge Function and redeploy it.
- Frontend stop: set `VITE_AI_EXPENSE_ENABLED=false` and rebuild the preview.
- Full preview rollback: redeploy the previous preview commit. In production, use the independent server and client kill switches documented in [DEPLOYMENT.md](DEPLOYMENT.md).

## Keeping a future AI experiment current

Regular customer fixes continue to land on `main`. Before each preview deployment, bring them into the candidate branch and rerun every gate:

```bash
git fetch origin main
git switch <candidate-ai-branch>
git merge --no-edit origin/main
npm run typecheck
npm run lint
npm run test:coverage
npm run test:backend
npm run test:e2e
```

Resolve any conflict in favor of the current `main` behavior first, then reapply the smallest AI integration. Keep the candidate as a pull request so GitHub continuously shows whether it is mergeable and whether CI remains green. Merge only after model quality, cost, privacy copy, user feedback, production secrets, and every automated gate are acceptable.

## Trial checklist

- Try English and Simplified Chinese descriptions.
- Describe two or more expenses in one text request and one voice request; verify their titles, amounts, payers, order, and splits.
- Edit one generated draft, remove another, and confirm nothing reaches the activity until **Save expenses** is selected.
- Verify a Live batch creates exactly one new shared revision.
- Cover equal splits, a subset of members, and exact amounts.
- Verify ambiguous payer, amount, or participant wording asks for clarification.
- Verify invented member names and malformed provider responses are rejected.
- Confirm manual entry and existing expense editing behave exactly as on `main`.
- Test a short mobile viewport and keyboard-only navigation.
- Review OpenRouter usage and Supabase Function logs after each small friend trial.
- Never paste card numbers, bank details, passwords, or private notes into the preview description.
