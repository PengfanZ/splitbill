# Contributing to Tally

Thanks for helping improve Tally. Small, focused changes with user-visible tests are easiest to review.

## Local setup

```bash
npm ci
npm run dev
```

The development app runs at [http://localhost:3000](http://localhost:3000).

## Before opening a pull request

Run the same checks used by CI:

```bash
npm run test:coverage
npx tsc -p tsconfig.app.json --noEmit
npm run build:static
```

All four coverage metrics must remain at 100%.

## Code guidelines

- Keep financial calculations in pure modules under `src/domain/`.
- Keep browser persistence behind `src/data/` and `src/hooks/`.
- Keep reusable shell UI separate from activity-specific features.
- Prefer direct imports over broad barrel exports.
- Preserve the `tally:frontend:v2` storage schema unless the change includes a tested migration.
- Add a regression test for every bug fix and user-focused tests for new behavior.
- Preserve existing data and unrelated changes when working in a shared checkout.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [TESTING.md](TESTING.md) for the full contracts.

## Pull requests

Please include:

- what changed and why;
- the user or developer impact;
- tests added or updated;
- screenshots for visible UI changes;
- known limitations or follow-up work.
