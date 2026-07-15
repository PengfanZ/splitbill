# Changelog

All notable user-facing changes to Tally are documented here.

Tally follows [Semantic Versioning](https://semver.org/). The `main` branch may deploy between versions; a tagged GitHub Release marks a meaningful, shareable milestone.

## [0.1.0] - 2026-07-14

### Added

- Local-first activity groups with browser persistence and a lightweight participant identity.
- Equal splits for all or selected participants, plus exact-amount splits.
- Expense editing and deletion, activity deletion, and stable historical splits when new friends join.
- Person-to-person balance calculations and full or partial settlement payments with undo support.
- Read-only QR snapshots, copyable links, native device sharing, and shareable PNG summaries.
- Optional Supabase-backed live activities with short capability URLs, optimistic concurrency control, rate limiting, and automatic refresh.
- Privacy-preserving first-party product analytics for local, snapshot, and live workflows.
- Installable PWA support, offline app-shell caching, and handoff from Safari to an installed Tally app.
- Automated unit, behavior, database, integration, accessibility, lint, type, coverage, and production-build checks.

### Security and privacy

- Live edit tokens remain in URL fragments and only SHA-256 hashes are stored by the backend.
- Analytics excludes URLs, capability tokens, activity IDs, names, descriptions, amounts, and balances.

[0.1.0]: https://github.com/PengfanZ/splitbill/releases/tag/v0.1.0
