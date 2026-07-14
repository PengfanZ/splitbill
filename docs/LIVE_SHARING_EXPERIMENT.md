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
5. Every save includes the revision that person loaded. The backend locks the row briefly and accepts the update only if the revision still matches.
6. If another person saved first, the stale editor receives a conflict instead of silently overwriting the newer activity.

The link is intentionally a bearer capability: anyone who has the full link can read and edit the activity. A code without its edit token grants nothing.

## Architecture

- **GitHub Pages** continues to host the React app.
- **Supabase Postgres** stores the canonical JSON snapshot, hashed edit token, revision, timestamps, and sliding expiration.
- **PostgREST RPCs** provide only three operations: create, load, and revision-checked update.
- The storage table and privileged functions live in the non-exposed `private` schema.
- Narrow security-definer `public` wrappers are callable with the project's publishable key. Browser roles cannot query private tables or execute private functions directly.
- RLS, validated JSON constraints, hashed-IP request throttling, statement timeouts, and 90-day sliding expiration provide defense in depth.
- The TypeScript client in `src/features/liveSharing/` validates credentials and every returned activity snapshot.

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

An update sends `expectedRevision`. The database obtains a row lock, compares the current revision, updates the snapshot, and increments the revision in one short transaction.

- Valid capability + current revision: save and return the new revision.
- Valid capability + stale revision: SQLSTATE `40001`, surfaced as `conflict`.
- Unknown code or invalid token: SQLSTATE `P0002`, surfaced as `not-found` without revealing which part was wrong.
- Invalid snapshot or revision: SQLSTATE `22023`, surfaced as `invalid-input`.
- Too many requests from one network: HTTP `429`, surfaced as `rate-limit`.

The UI shows a conflict banner with **Refresh latest**. Automatic field-level merging should wait until we have evidence that whole-activity optimistic concurrency is too disruptive.

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
- The QR dialog displays the short `#live=` capability URL and copies it directly to the clipboard.
- Opening a live link loads the canonical backend snapshot and enables adding friends plus creating, editing, and deleting expenses.
- Every mutation sends the last loaded revision. A stale save is rejected with a visible conflict message instead of overwriting someone else's work.
- **Refresh latest** manually loads the current revision, and **Show QR** reopens the same live link for sharing.
- A missing backend configuration, invalid link, network failure, and clipboard failure each have explicit UI feedback.

Automatic polling and Supabase Realtime are intentionally deferred. Manual refresh keeps this first experiment predictable while the capability-token authorization model is evaluated.

Each browser's shortcut is stored in local storage. Removing the shortcut, clearing site data, or moving to another browser does not delete the backend activity; that browser needs the original capability link to reconnect again.

## Verification

- Vitest enforces 100% statement, branch, function, and line coverage, including happy paths and failure states.
- Playwright covers isolated creator, editor, and observer browser sessions. Recipients persist the live shortcut locally, reopen it without the original URL, and share revision-checked updates through the backend.
- pgTAP verifies the SQL capability, privacy, validation, and optimistic-concurrency contract.
