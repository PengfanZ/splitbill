# Removing friends without losing history

In **People**, choose Remove next to a friend. The confirmation lists every
related bill and settlement in a scrollable area, with dates, the bill total,
their share, whether they paid, and their remaining balance. Removal is still
allowed when they have records or an unpaid balance.

The original participant (`me`) cannot be removed. This is an activity membership
rule, not an account ownership or access-control system.

## What users see

| Area | After removal |
| --- | --- |
| People | Friend moves to **Removed friends**, with a Restore action. |
| Old bills | Names, IDs, amounts, shares and dates are retained. Bills identify removed participants. |
| New manual, AI text and voice expenses | Active people only; the payer and split selectors use the same eligibility rule. |
| AI identity | An inactive selected identity is not sent as “I”; choose an active person before requesting an AI draft. |
| Receipt splitting | Dish assignment, “Everyone”, payer choices, and charge allocation use active people. |
| Editing an old bill | Active people plus that bill's original inactive payer/share participants are available. Saving a title-only edit preserves shares. |
| Balances and settlements | All historical participants remain included. Payments involving inactive people are still supported. |
| CSV and image exports | Historical data remains complete. Inactive people remain selectable for personal CSV export. |
| Restore | Restores the same member ID for future expenses; does not recalculate old bills. |

Removing a friend affects only the selected activity. To change an old split,
edit that expense explicitly. To add an existing removed friend again, use
**People → Removed friends → Restore**, not a new name entry.

## Data model and compatibility

`ActivityGroup.inactiveMemberIds?: string[]` records inactive membership. Both
`group.memberIds` and the friend records retain all identities. Missing metadata
means all members are active, so existing local and version-2 live snapshots
continue to work without a storage reset.

Inactive IDs must be unique, must refer to group members, and cannot contain
`me`. The domain helpers in `src/domain/memberRemoval.ts` centralize selectors,
removal, restoration and expense-reference eligibility.

A saved independent local copy remaps inactive IDs along with all expense
references. If an inactive participant chooses themselves as the owner of that
new copy, they become its active `me`; the source live activity is unchanged.

## Live synchronization and older clients

Deploy `20260909140009_preserve_inactive_activity_members.sql` before enabling
the frontend in production. Local verification does not deploy this migration.

All changes keep the existing expected-revision checks. Removal and restoration
are unavailable offline, while saving, or after the session expires. Successful
saves update recovery mirrors and are visible to other browsers through polling.

The database validates membership transitions for all three update RPC versions:

- New expenses cannot reference inactive participants, including zero shares.
- Edits can keep the original inactive payer/share references, but cannot
  introduce a different inactive participant.
- Settlements can reference inactive people because their old balances remain.
- Existing inactive identities cannot be physically dropped.
- Once membership metadata exists, clients must keep it, even as an empty array
  after restore. Older clients cannot silently discard it.
- An outdated split gets a normal rejection/conflict response, not a database
  exception. The new client loads the latest people and keeps the form open for
  explicit review. It does not silently retry or redistribute the bill.

Older cached app versions may still display removed people as selectable until
they update; the database prevents those incorrect new splits from being saved.
Removing a participant does **not** revoke the live link: anyone holding it can
still view and edit the activity.

## Verification

- Domain/state: active selectors, identity retention, original participants,
  zero shares, historical edits, settlements, atomic batch rejection and restore.
- UI: warnings with all affected records, active-only new forms, marked original
  participants on old bills, AI identity/context, stale drafts, receipt payers,
  CSV scopes, cancellation, reload, offline and network errors.
- Playwright: mobile and desktop, English/Chinese, dark mode, preserved old
  splits, new active-only bills, restore and two independent live sessions.
- Local pgTAP: real update/load RPCs, all old-client endpoints, invalid metadata,
  revision conflicts, original reference preservation and settlement/restore.
  Database tests roll back their fixtures.
