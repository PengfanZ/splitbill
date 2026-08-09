# Security policy

## Supported version

The latest version on `main` and the current public deployment receive security fixes.

## Reporting a vulnerability

Please do not publish sensitive vulnerability details in a public issue. Use [GitHub's private vulnerability reporting](https://github.com/PengfanZ/splitbill/security/advisories/new) to send the report confidentially.

Include the affected flow, reproduction steps, impact, and any suggested mitigation. The project aims to acknowledge reports within seven days.

## Data model

Local activities and identities are stored in browser `localStorage`. Live activities are stored in a private Supabase schema and accessed only through capability-checked public RPC wrappers. The edit token remains in the URL fragment and only its SHA-256 hash is stored by the backend.

Anyone with a complete live URL can read, edit, and end that activity. **End live sharing** deletes the canonical backend record immediately; browsers that previously opened it retain only their local recovery copies. There are no accounts, participant-level permissions, token rotation, or audit trail in this release. Treat leaked URLs as compromised and avoid regulated or highly sensitive data.

Anonymous RPCs use a secret-peppered request identifier for throttling, and expected invalid input consumes rate-limit budget without being stored. AI calls have separate per-client text/voice quotas plus server-only project-wide daily ceilings. Live activity payloads are validated against the same bounded graph, reference, amount, settlement, timestamp, and snapshot-size rules in the browser and database. Production builds allow connections only to the configured HTTPS Supabase origin. The static host cannot set `frame-ancestors` headers, so the app also refuses to render interactive controls while embedded in another page.

Reports involving capability leakage, RPC privilege escalation, rate-limit bypasses, browser storage exposure, exported summaries, dependency vulnerabilities, or deployment configuration are in scope. Never include a real live activity URL, database password, service-role key, or Supabase access token in a report.
