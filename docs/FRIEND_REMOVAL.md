# Removing friends from an activity

In **People**, choose the trash icon next to an added friend. The confirmation
explains whether removal affects this local activity or everyone in a live activity.
The original participant (`me`) is retained for compatibility with existing local
and shared activity snapshots; there is no account ownership or access-revocation
model behind this action.

## History comes first

- Remove an unused friend, including one added after earlier expenses.
- Block removal if any record references them as payer or in its shares. This
  includes settlements, paid-off balances, and legacy zero-value share entries.
- Show the reference count and up to three related records. Do not offer a
  destructive confirmation or silently redistribute expenses.
- Existing expense amounts, splits, IDs, timestamps, summaries, and exports remain
  unchanged. Correct a mistaken record explicitly before removing its participant.
- Removing an unused friend from one local activity does not remove them from
  another. Re-adding a name creates a new participant, not a restored identity.

## Live compatibility

No migration, storage version, or API change is needed. The new snapshot removes
the friend from both `friends` and `group.memberIds`. Existing snapshot validation
rejects dangling payer/share references. `update_shared_activity_v3` saves with the
expected revision; conflicts load the latest snapshot without retrying a stale
removal. The open dialog then re-evaluates any new references.

The action is unavailable offline, while disconnected, or after expiry. A failed
save does not remove the friend optimistically. Successful saves update the usual
local recovery mirror and other browsers pick them up through existing polling.
Removing a participant is **not** an access ban: anyone with the live link can
still view and edit the activity. An outdated browser cannot overwrite a newer
revision simply by saving its old member list.

## Verification

- Domain and state tests: references, immutability, shared friends, zero shares,
  settlements, missing members, and original-participant protection.
- App tests: confirmation/cancel, reload persistence, identity fallback, offline
  state, network failures, revision conflicts, and recovery mirrors.
- Playwright: mobile dialogs, two independent live browser sessions, Chinese,
  dark mode, and unchanged expenses.
- Local pgTAP: real RPC removal, reference validation, stale revision rejection,
  and readback from a second load. Tests roll back their fixtures.
