# Security policy

## Supported version

The latest version on `main` and the current public deployment receive security fixes.

## Reporting a vulnerability

Please do not publish sensitive vulnerability details in a public issue. Use [GitHub's private vulnerability reporting](https://github.com/PengfanZ/splitbill/security/advisories/new) to send the report confidentially.

Include the affected flow, reproduction steps, impact, and any suggested mitigation. The project aims to acknowledge reports within seven days.

## Data model

Tally currently stores activity data in browser `localStorage` and has no application backend or user authentication. Reports involving browser storage exposure, exported summaries, dependency vulnerabilities, or deployment configuration are still in scope.
