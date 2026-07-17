# Live sharing backend

Live sharing adds a backend-backed activity without replacing Tally's local-first behavior.

## Proposed user flow

1. A person creates an activity locally and chooses **Share live**.
2. The backend stores one canonical activity snapshot and returns:
   - a 10-character activity code, such as `A1B2C3D4E5`;
   - a random 64-character edit token, shown only inside the share link;
   - revision `1`.
3. Tally builds a short capability link:

   ```text
   https://pengfanz.github.io/splitbill/#live=A1B2C3D4E5.<secret-edit-token>
   ```

4. A friend opens the link. Browser code reads the fragment and sends the code plus token to the backend. URL fragments are not included in the browser's initial HTTP request to GitHub Pages.
5. Every save includes the revision that person loaded. The backend atomically accepts the update only if the revision still matches.
6. If another person saved first, the stale editor receives the latest snapshot as a normal conflict result instead of silently overwriting it or producing a database error.

The link is intentionally a bearer capability: anyone who has the full link can read and edit the activity. A code without its edit token grants nothing.

## Architecture

- **GitHub Pages** continues to host the React app.
- **Supabase Postgres** stores the canonical JSON snapshot, hashed edit token, revision, timestamps, and sliding expiration.
- **PostgREST RPCs** provide create, lightweight revision polling, full snapshot loading, and revision-checked update operations.
- The storage table and privileged functions live in the non-exposed `private` schema.
- Narrow security-definer `public` wrappers are callable with the project's publishable key. Browser roles cannot query private tables or execute private functions directly.
- RLS, validated JSON constraints, hashed-IP request throttling, statement timeouts, and 90-day sliding expiration provide defense in depth.
- TanStack Query owns the in-memory live record, visibility-aware polling, reconnect/focus refreshes, and revision-checked mutations.
- Zod schemas validate versioned snapshots, references, settlements, and size limits before data enters or leaves the client.

The first schema deliberately stores an activity as one JSON document. That makes each activity update atomic and lets us reuse the existing versioned `SharedActivity` contract. If activity histories or high-frequency concurrent edits become important, we can later normalize members and expenses into separate tables without changing the share-link contract.

## Local setup

Requirements: Node.js 22.13+, a Docker-compatible container runtime, and the checked-in Supabase CLI dependency.

```bash
cp .env.example .env.local
npm run backend:start
npm run backend:reset
npm run test:backend
```

`npm run backend:start` prints the local API URL and publishable key. Put those values in `.env.local`, then start the frontend normally with `npm run dev`.

Database changes must be added under `supabase/migrations/`; do not make untracked production-only edits in the Supabase dashboard.

## Conflict contract

An update sends `expectedRevision`. A conditional database update compares the current revision, stores the snapshot, and increments the revision atomically in one short transaction.

- Valid capability + current revision: save and return the new revision.
- Valid capability + stale revision: return the latest record with `conflicted: true`; this is an expected application result, not a PostgreSQL serialization failure.
- Unknown code or invalid token: SQLSTATE `P0002`, surfaced as `not-found` without revealing which part was wrong.
- Invalid snapshot or revision: SQLSTATE `22023`, surfaced as `invalid-input`.
- Too many requests from one network: HTTP `429`, surfaced as `rate-limit`.

The UI immediately loads the latest record, keeps the editor open, and asks the person to review and save again. Visible live-activity tabs poll a lightweight revision-only RPC every 15 seconds and fetch the full snapshot only when that revision changes. They also check immediately when they regain focus or reconnect. **Refresh latest** remains available as a manual fallback. Automatic field-level merging should wait until we have evidence that whole-activity optimistic concurrency is too disruptive.

## Remaining trusted-group limitations

- Decide whether separate read-only and edit tokens are useful.
- Add token rotation, explicit backend deletion, and participant-level revocation.
- Configure production alerts from API/database logs and tune request limits from observed traffic.
- Replace the broad `*.supabase.co` CSP connection source if a dedicated custom API domain is introduced.
- Enable Realtime only after defining how capability-token clients are authorized to subscribe.

## Implemented frontend

- **Share live** creates a backend activity and immediately moves the creator's tab into that live revision, without removing the existing read-only snapshot option.
- Every browser that successfully opens a live capability remembers it under **Your activities**. The creator keeps the original local activity entry; recipients receive a lightweight `Live · CODE` shortcut that always reopens the canonical backend copy.
- A remembered live activity stays selected until another activity is chosen. Returning to the app or clicking its sidebar shortcut reconnects to the latest backend revision without requiring the link again.
- The QR dialog displays the short `#live=` capability URL, opens the device's native share sheet, and retains an explicit copy-link fallback. Installed PWA users can paste a browser-opened capability link into **Join activity** to continue in their existing app session.
- Opening a live link loads the canonical backend snapshot and enables adding friends plus creating, editing, and deleting expenses.
- Every mutation sends the last loaded revision. A stale save loads the current activity with a visible conflict message instead of overwriting someone else's work.
- Newer revisions load automatically while the live activity is visible. Polling pauses for hidden, offline, or actively-saving tabs and backs off to at most one request per minute after failures.
- **Refresh latest** manually loads the current revision, and **Show QR** reopens the same live link for sharing.
- A missing backend configuration, invalid link, network failure, and clipboard failure each have explicit UI feedback.

Supabase Realtime remains deferred until the capability-token authorization model is evaluated. Visibility-aware polling provides automatic synchronization without exposing the private activity table or requiring user accounts.

Each browser's shortcut is stored in local storage. Removing the shortcut, clearing site data, or moving to another browser does not delete the backend activity; that browser needs the original capability link to reconnect again.

## Verification

- Vitest enforces 100% statement, branch, function, and line coverage, including happy paths and failure states.
- Playwright covers isolated creator, editor, and observer browser sessions, including a stale save, latest-state recovery, and successful retry. Recipients persist the live shortcut locally, reopen it without the original URL, and share revision-checked updates through the backend.
- pgTAP verifies the SQL capability, privacy, validation, and optimistic-concurrency contract.
