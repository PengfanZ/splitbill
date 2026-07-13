# Tally

[![CI](https://github.com/PengfanZ/splitbill/actions/workflows/ci.yml/badge.svg)](https://github.com/PengfanZ/splitbill/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/demo-live-e8584f)](https://pengfanz.github.io/splitbill/)
[![Coverage](https://img.shields.io/badge/coverage-100%25-16724c)](TESTING.md)

A frontend-first shared-expense app for trips, dinners, homes, and other group activities. Tally tracks who paid, supports equal or exact splits, and calculates clear suggested payments to settle the group.

Production visits are measured with privacy-friendly Cloudflare Web Analytics. The beacon is deferred until after the React app mounts, is disabled during local development and tests, and uses no application data. In Cloudflare, filter page paths by `/splitbill/` to isolate this app from other pages on the same GitHub Pages domain.

## Experimental URL-state sharing

The `codex/url-state-sharing` branch adds frontend-only activity snapshots. **Share link** serializes the selected activity into the URL fragment, and opening that URL shows a validated, read-only preview. The recipient can explicitly save an isolated local copy; opening a link never overwrites browser data. Shared-preview URLs also skip analytics because the fragment contains names and expense details. Until activity-scoped identities are added, “You” in a shared snapshot still means the link creator.

This is asynchronous snapshot sharing, not live collaboration. A newer edit produces a new URL, links cannot be revoked, and activities above the conservative 12,000-character URL limit need a future file or backend transport.

[Try the live demo](https://pengfanz.github.io/splitbill/)

![Friends sharing expenses with Tally](public/og.png)

## Highlights

- Create activity groups and add friends without requiring profiles or accounts.
- Record who paid and split expenses equally or by exact amounts.
- Keep historical splits stable when friends join later, then explicitly edit an expense when it should include them.
- See clear person-to-person settlement directions instead of an ambiguous group balance.
- Edit and delete expenses with immediate balance recalculation.
- Export a shareable PNG summary for friends.
- Persist data in the browser and synchronize changes across open tabs.
- Use the responsive interface on desktop or mobile.

## Important data note

Tally is currently a frontend-only prototype. Activities, friends, and expenses are stored in your browser under `localStorage`; there is no account, server database, or cross-device synchronization yet. Clearing browser data removes the saved state for that browser.

## Tech stack

- React 19 and TypeScript
- Vite
- Lucide icons
- Vitest and Testing Library
- GitHub Actions for CI and deployment
- GitHub Pages for static hosting

## Getting started

Requirements:

- Node.js 24 recommended; Node.js 22.13 or newer is supported
- npm

```bash
git clone https://github.com/PengfanZ/splitbill.git
cd splitbill
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run lint` | Lint all TypeScript and React files with zero warnings allowed |
| `npm test` | Run the complete automated test suite |
| `npm run test:behavior` | Run focused happy-path and edge-case scenarios |
| `npm run test:coverage` | Run all tests and enforce 100% coverage |
| `npm run typecheck` | Type-check every TypeScript and TSX file without emitting output |
| `npm run build:pages` | Build the static artifact with the GitHub Pages base path |
| `npm run build` | Build a root-hosted production artifact |
| `npm run preview` | Preview the production build locally |

## Project structure

```text
src/
├── App.tsx                    # Application orchestration
├── components/                # Reusable shell components
├── data/                      # Browser persistence
├── domain/                    # Models and pure financial logic
├── features/
│   ├── activity/              # Dashboard and expense workflows
│   └── sharing/               # Text and PNG exports
└── hooks/                     # React lifecycle integrations
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for dependency boundaries and persistence rules.

## Quality and testing

Every push and pull request must pass:

- realistic happy-path tests;
- edge cases for cents, floating-point inputs, browser APIs, and persistence;
- direct unit tests for pure domain modules;
- compiler validation for every TypeScript and TSX file;
- ESLint with TypeScript and React Hooks rules and zero warnings;
- component and helper tests;
- 100% statement, branch, function, and line coverage;
- a production static build.

The complete contract is documented in [TESTING.md](TESTING.md).

## Deployment

Every pull request is type-checked, linted, tested, and built by GitHub Actions. A successful `main` build is published from `dist` to GitHub Pages.

## Contributing

Contributions and focused bug reports are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and use [SECURITY.md](SECURITY.md) for vulnerability reports.
