# Expense categories

Categories are optional activity-scoped metadata. They never change expense amounts,
participants, shares, settlements, or balances.

## Behavior

- Every expense starts in **General** (通用). Missing or null `categoryId` means General.
- Existing activities need no data rewrite. Food & drinks, Stay, Transport, and
  Activities are suggested defaults until a category list is explicitly saved.
- Users can create, rename, and delete categories. General cannot be deleted.
- Deleting a category moves its expenses to General in the same atomic update.
- By category summarizes expense totals only; repayments are excluded. Selecting a
  category filters the expense list.
- The expense form suggests a built-in category (Food & drinks, Stay, Transport,
  Activities) from English or Chinese keywords in a new expense's description. The
  suggestion is shown preselected with a note and follows the description until someone
  picks a category; after that their choice wins. It is only offered while that built-in
  still exists under its original name. Edits never change an existing category.
  Single AI drafts pass through this form and get suggestions; AI batches and receipts
  do not infer categories. See [ANALYTICS.md](ANALYTICS.md) for the kept/changed events.

## Storage and collaboration

`ActivityGroup.categories` contains `{ id, name, color }` records. `Expense.categoryId`
references a record in that activity. Category names are trimmed, unique, and at most
32 characters. Activities support up to 40 categories with a fixed color palette.

Local changes persist through the existing browser storage. Live changes use the
existing revision-checked snapshot API and require an editable online session.
The database migration validates references and preserves category metadata when an
older client omits it. Explicit null intentionally resets an expense to General.

Before a future production rollout, apply
`20260922141512_add_expense_categories.sql` **before** shipping the frontend. The
implementation branch has only been tested against the local database; it does not
change production.

## Verification

- Domain tests: defaults, localization, validation, aggregation, deletion, persistence.
- Component and app tests: management, assignment, stale category review, live API saves.
- Playwright: desktop/mobile creation, assignment, reload, summary filtering, deletion.
- Database tests: legacy clients, explicit clearing, validation, actual RPC updates.

Run `npm run test:coverage`, `npm run test:e2e`, `npm run typecheck`,
`npm run lint`, and the Supabase database tests before release. Do not weaken the
coverage thresholds to accommodate new code.
