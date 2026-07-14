# Tally

[![CI](https://github.com/PengfanZ/splitbill/actions/workflows/ci.yml/badge.svg)](https://github.com/PengfanZ/splitbill/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/demo-live-e8584f)](https://pengfanz.github.io/splitbill/)
[![Coverage](https://img.shields.io/badge/coverage-100%25-16724c)](TESTING.md)

A local-first shared-expense app for trips, dinners, homes, and other group activities. Tally tracks who paid, supports equal or exact splits, calculates clear suggested payments, and optionally synchronizes a trusted group through a capability-protected live activity.

On first use, Tally asks for a display name and stores that identity only in the current browser. The name replaces the ambiguous generic “You” in participant lists and is included as the sender identity when an activity link is shared.

Frontend-only builds can use privacy-friendly Cloudflare Web Analytics. Production builds with live sharing enabled disable the third-party beacon so a script never gains access to bearer capability fragments.

## Experimental URL-state sharing

**Share QR** compresses the selected activity into the URL fragment and displays a scannable code that opens the Tally website. A copy-link fallback is available in the QR dialog. Opening the destination shows a validated, read-only preview. Before saving an isolated local copy, the recipient chooses which participant they are; that participant and every payer/share reference are remapped consistently to “You.” Existing uncompressed links remain compatible, opening a link never overwrites browser data, and shared-preview URLs skip analytics because the fragment contains names and expense details.

This is asynchronous snapshot sharing, not live collaboration. A newer edit produces a new URL, links cannot be revoked, and activities above the conservative 12,000-character URL limit need a future file or backend transport.

With the two `VITE_SUPABASE_*` settings configured, **Share live** creates a short capability URL that lets trusted recipients edit the same revision-checked activity. Every browser that opens it keeps a local shortcut to the canonical backend activity. See [the live sharing architecture](docs/LIVE_SHARING_EXPERIMENT.md) and [production deployment guide](docs/DEPLOYMENT.md).

[Try the live demo](https://pengfanz.github.io/splitbill/)

![Friends sharing expenses with Tally](public/og.png)

## Highlights

- Create activity groups and add friends without requiring profiles or accounts.
- Record who paid and split expenses equally among everyone or only selected people, or enter exact amounts.
- Keep historical splits stable when friends join later, then explicitly edit an expense when it should include them.
- See clear person-to-person settlement directions instead of an ambiguous group balance.
- Edit and delete expenses, or delete an entire activity and its local data.
- Export a shareable PNG summary for friends.
- Persist data in the browser and synchronize changes across open tabs.
- Use the responsive interface on desktop or mobile.

## Important data note

Local activities remain in browser `localStorage`. Live activities are stored in Supabase and are editable by anyone with the full capability link. There are no user accounts or participant-level permissions. Read [PRIVACY.md](PRIVACY.md) before deploying or sharing real activity data.

## Tech stack

- React 19 and TypeScript
- Vite
- Lucide icons
- Vitest and Testing Library
- GitHub Actions for CI and deployment
- GitHub Pages for static hosting
- Supabase Postgres for optional live activities

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
| `npm run backend:start` | Start the local Supabase stack |
| `npm run backend:reset` | Recreate the local database and apply every migration |
| `npm run test:backend` | Run pgTAP database and security contracts |
| `npm run lint` | Lint all TypeScript and React files with zero warnings allowed |
| `npm test` | Run the Vitest unit, component, and behavior suite |
| `npm run test:all` | Run coverage plus the Playwright integration suite |
| `npm run test:behavior` | Run focused happy-path and edge-case scenarios |
| `npm run test:coverage` | Run all tests and enforce 100% coverage |
| `npm run test:e2e` | Build the GitHub Pages bundle and run the Chromium integration suite |
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
- Playwright integration tests against the production GitHub Pages build;
- 100% statement, branch, function, and line coverage;
- a production static build.

The complete contract is documented in [TESTING.md](TESTING.md).

## Deployment

Every pull request is type-checked, linted, tested, and built by GitHub Actions. A successful `main` release applies pending Supabase migrations before publishing the configured frontend artifact to GitHub Pages. Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the one-time environment setup and release procedure.

## Contributing

Contributions and focused bug reports are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and use [SECURITY.md](SECURITY.md) for vulnerability reports.
