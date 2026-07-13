# Tally

[![CI](https://github.com/PengfanZ/splitbill/actions/workflows/ci.yml/badge.svg)](https://github.com/PengfanZ/splitbill/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/demo-live-e8584f)](https://fanciful-ganache-eb8c6a.netlify.app/)
[![Coverage](https://img.shields.io/badge/coverage-100%25-16724c)](TESTING.md)

A frontend-first shared-expense app for trips, dinners, homes, and other group activities. Tally tracks who paid, supports equal or exact splits, and calculates clear suggested payments to settle the group.

[Try the live demo](https://fanciful-ganache-eb8c6a.netlify.app/)

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
- Vinext / Vite
- Lucide icons
- Vitest and Testing Library
- GitHub Actions for CI
- Netlify for the static deployment

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
| `npm test` | Run the complete automated test suite |
| `npm run test:behavior` | Run focused happy-path and edge-case scenarios |
| `npm run test:coverage` | Run all tests and enforce 100% coverage |
| `npm run build:static` | Build the static Netlify artifact |
| `npm run build` | Build through Vinext |

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
- component and helper tests;
- 100% statement, branch, function, and line coverage;
- a production static build.

The complete contract is documented in [TESTING.md](TESTING.md).

## Deployment

`main` is validated by GitHub Actions. Netlify builds the public site with `npm run build:static` and publishes `dist-static` according to [netlify.toml](netlify.toml).

## Contributing

Contributions and focused bug reports are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and use [SECURITY.md](SECURITY.md) for vulnerability reports.
