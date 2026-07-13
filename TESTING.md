# Testing contract

Coverage is necessary, but it is not the definition of correctness. Every product change must include assertions for outcomes a user cares about.

## Required layers

1. **Happy paths** — realistic end-to-end user flows such as creating an activity, adding friends, recording and editing equal and exact expenses, seeing settlements, exporting, deleting, and reloading persisted data.
2. **Edge cases** — cent rounding, floating-point totals, empty and corrupted storage, unavailable browser APIs, cancelled sharing, long expense lists, multiple creditors and debtors, and invalid form input.
3. **Domain unit tests** — direct tests beside pure financial and member modules, independent of React and browser workflows.
4. **Component and helper tests** — focused tests for persistence, rendering states, and browser fallbacks.
5. **Rendered browser integration tests** — Playwright runs the production GitHub Pages build in Chromium and verifies interaction, responsive layout, persistence after reload, destructive confirmations, and console health.

## CI gate

Every push and pull request type-checks and lints all TypeScript files, then runs all domain, happy-path, edge-case, component, and helper tests. CI also requires 100% statements, branches, functions, and lines, followed by a Playwright integration run against the production build.

- `npm test` runs the Vitest unit, component, and behavior suite.
- `npm run test:all` runs full Vitest coverage followed by Playwright integration tests.
- `npm run lint` runs ESLint with TypeScript and React Hooks rules and permits no warnings.
- `npm run test:behavior` runs the focused happy-path and edge-case suite.
- `npm run test:coverage` runs the complete suite and enforces coverage thresholds.
- `npm run test:e2e` builds the GitHub Pages bundle, starts a local preview, and runs the Chromium integration suite.
- `npm run typecheck` validates executable modules, configuration, and type-only files such as `models.ts`.

Add a regression test whenever a bug is fixed. A test should fail for the broken behavior and pass after the fix.
