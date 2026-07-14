# Security policy

## Supported version

The latest version on `main` and the current public deployment receive security fixes.

## Reporting a vulnerability

Please do not publish sensitive vulnerability details in a public issue. Use [GitHub's private vulnerability reporting](https://github.com/PengfanZ/splitbill/security/advisories/new) to send the report confidentially.

Include the affected flow, reproduction steps, impact, and any suggested mitigation. The project aims to acknowledge reports within seven days.

## Data model

Local activities and identities are stored in browser `localStorage`. Live activities are stored in a private Supabase schema and accessed only through capability-checked public RPC wrappers. The edit token remains in the URL fragment and only its SHA-256 hash is stored by the backend.

Anyone with a complete live URL can read and edit that activity. There are no accounts, participant-level permissions, token revocation, or audit trail in this release. Treat leaked URLs as compromised and avoid regulated or highly sensitive data.

Reports involving capability leakage, RPC privilege escalation, rate-limit bypasses, browser storage exposure, exported summaries, dependency vulnerabilities, or deployment configuration are in scope. Never include a real live activity URL, database password, service-role key, or Supabase access token in a report.
