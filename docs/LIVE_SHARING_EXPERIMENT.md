# Live sharing backend experiment

This branch tests a backend-backed activity without replacing Tally's current local-first behavior.

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

## Prototype architecture

- **GitHub Pages** continues to host the React app.
- **Supabase Postgres** stores the canonical JSON snapshot, hashed edit token, revision, and timestamps.
- **PostgREST RPCs** provide only three operations: create, load, and revision-checked update.
- The storage table and privileged functions live in the non-exposed `private` schema.
- Narrow `public` wrappers are callable with the project's publishable key. They cannot query the table directly.
- The TypeScript client in `src/features/liveSharing/` validates credentials and every returned activity snapshot.

The first schema deliberately stores an activity as one JSON document. That makes each activity update atomic and lets us reuse the existing versioned `SharedActivity` contract. If activity histories or high-frequency concurrent edits become important, we can later normalize members and expenses into separate tables without changing the share-link contract.

## Local setup

Requirements: Node.js 20+, Docker-compatible container runtime, and the checked-in Supabase CLI dependency.

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

The UI shows a conflict banner with **Refresh latest**. Automatic field-level merging should wait until we have evidence that whole-activity optimistic concurrency is too disruptive.

## Security limitations before production

- Add rate limiting for create/load/update calls.
- Add activity expiry or explicit deletion.
- Decide whether separate read-only and edit tokens are useful.
- Rotate a leaked edit token.
- Add abuse monitoring and payload-size metrics.
- Add a Content Security Policy that includes only the configured Supabase project.
- Enable Realtime only after defining how capability-token clients are authorized to subscribe.

## Implemented frontend experiment

- **Share live** creates a backend activity and immediately moves the creator's tab into that live revision, without removing the existing read-only snapshot option.
- The creator's browser remembers the live capability against the original local activity. The sidebar labels that activity with `Live · CODE`, reopens the canonical backend copy, and reconnects to it after a page reload.
- Opening someone else's live link does not silently add it to **My activities**. Only the browser that created the live copy keeps this automatic bookmark for now.
- The QR dialog displays the short `#live=` capability URL and copies it directly to the clipboard.
- Opening a live link loads the canonical backend snapshot and enables adding friends plus creating, editing, and deleting expenses.
- Every mutation sends the last loaded revision. A stale save is rejected with a visible conflict message instead of overwriting someone else's work.
- **Refresh latest** manually loads the current revision, and **Show QR** reopens the same live link for sharing.
- A missing backend configuration, invalid link, network failure, and clipboard failure each have explicit UI feedback.

Automatic polling and Supabase Realtime are intentionally deferred. Manual refresh keeps this first experiment predictable while the capability-token authorization model is evaluated.

The creator bookmark is stored in browser local storage. Clearing site data or moving to another browser removes that bookmark but does not delete the backend activity; the original capability link is still required to reconnect from that browser.

## Verification

- Vitest enforces 100% statement, branch, function, and line coverage, including happy paths and failure states.
- Playwright covers a multi-page collaboration flow: the creator leaves and reopens its bookmarked live activity (including across a page reload), another page edits it, and a third page reopens the same code at the new revision.
- pgTAP verifies the SQL capability, privacy, validation, and optimistic-concurrency contract.
