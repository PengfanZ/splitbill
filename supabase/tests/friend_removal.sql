begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table friend_removal_fixture as
select * from public.create_shared_activity('{
  "version": 2,
  "sender": {"id":"me","name":"Alex","initials":"A","color":"#abc"},
  "group": {"id":"trip","name":"Trip","emoji":"☀","memberIds":["me","maya","sam"]},
  "friends": [
    {"id":"maya","name":"Maya","initials":"M","color":"#def"},
    {"id":"sam","name":"Sam","initials":"S","color":"#fed"}
  ],
  "expenses": [{"id":"dinner","groupId":"trip","title":"Dinner","amount":20,"payerId":"me","splitMethod":"equal","shares":{"me":10,"maya":10},"createdAt":"2026-09-09T12:00:00Z"}]
}'::jsonb);

select ok(private.is_valid_activity_snapshot(snapshot), 'legacy snapshots with no inactive metadata remain valid') from friend_removal_fixture;
select ok(not private.is_valid_activity_snapshot(jsonb_set(snapshot, '{group,inactiveMemberIds}', value)), 'reject invalid inactive membership: ' || value::text)
from friend_removal_fixture cross join (values ('null'::jsonb), ('"maya"'), ('["me"]'), ('["unknown"]'), ('["maya","maya"]'), ('[1]')) invalid(value);

create temporary table removed_friend_result as
select updated.* from friend_removal_fixture original
cross join lateral public.update_shared_activity_v3(original.code, original.edit_token, 1,
  jsonb_set(original.snapshot, '{group,inactiveMemberIds}', '["maya","sam"]')
) updated;

select is(revision, 2::bigint, 'removing referenced and unused friends increments revision') from removed_friend_result;
select is(conflicted, false, 'referenced-friend removal succeeds') from removed_friend_result;
select is(snapshot #> '{group,memberIds}', '["me","maya","sam"]'::jsonb, 'all historical member IDs are retained') from removed_friend_result;
select is(snapshot->'expenses', (select snapshot->'expenses' from friend_removal_fixture), 'existing bills and shares are unchanged') from removed_friend_result;
select is(snapshot->'friends', (select snapshot->'friends' from friend_removal_fixture), 'friend identities are unchanged') from removed_friend_result;

select is(conflicted, true, 'stale clients cannot overwrite a newer removal')
from friend_removal_fixture original
cross join lateral public.update_shared_activity_v3(original.code, original.edit_token, 1, original.snapshot);

select is(rejection_code, 'activity_membership_changed', 'dropping inactive metadata is rejected without a database error')
from friend_removal_fixture original
cross join lateral public.update_shared_activity_v3(original.code, original.edit_token, 2, original.snapshot);

create temporary table invalid_new_bill as
select jsonb_set(snapshot, '{expenses}', snapshot->'expenses' || jsonb_build_array(
  jsonb_set(snapshot->'expenses'->0, '{id}', '"new-dinner"')
)) as snapshot from removed_friend_result;

select is(rejection_code, 'activity_membership_changed', 'new bill cannot include inactive member in shares')
from friend_removal_fixture original, invalid_new_bill proposed,
lateral public.update_shared_activity_v3(original.code, original.edit_token, 2, proposed.snapshot);

select is(conflicted, true, 'v2 clients receive a conflict rather than silently saving the incorrect split')
from friend_removal_fixture original, invalid_new_bill proposed,
lateral public.update_shared_activity_v2(original.code, original.edit_token, 2, proposed.snapshot);

select set_config('response.status', '', true);
select is(count(*), 0::bigint, 'legacy clients cannot save a new bill with inactive participants')
from friend_removal_fixture original, invalid_new_bill proposed,
lateral public.update_shared_activity(original.code, original.edit_token, 2, proposed.snapshot);
select is(current_setting('response.status', true), '409', 'legacy rejection uses committed HTTP conflict status');

select ok(not private.is_valid_membership_transition(snapshot,
  jsonb_set(jsonb_set(snapshot, '{friends}', (snapshot->'friends') - 1), '{group,memberIds}', '["me","maya"]')
), 'inactive identities cannot be physically removed') from removed_friend_result;

select ok(not private.is_valid_membership_transition(snapshot,
  jsonb_set(snapshot, '{expenses,0,payerId}', '"sam"')
), 'editing an old bill cannot introduce a previously uninvolved inactive payer') from removed_friend_result;
select ok(not private.is_valid_membership_transition(snapshot,
  jsonb_set(snapshot, '{expenses,0,shares}', '{"me":10,"maya":10,"sam":0}')
), 'even zero-value new references to inactive people are rejected') from removed_friend_result;
select ok(private.is_valid_membership_transition(
  jsonb_set(snapshot, '{expenses,0,payerId}', '"maya"'),
  jsonb_set(snapshot, '{expenses,0,payerId}', '"maya"')
), 'original inactive payer is retained on an old bill') from removed_friend_result;

create temporary table edited_history as
select updated.* from friend_removal_fixture original, removed_friend_result removed,
lateral public.update_shared_activity_v3(original.code, original.edit_token, 2,
  jsonb_set(removed.snapshot, '{expenses,0,title}', '"Dinner corrected"')
) updated;
select is(revision, 3::bigint, 'editing an old bill preserves its original inactive participants') from edited_history;
select is(snapshot #> '{expenses,0,shares}', '{"me":10,"maya":10}'::jsonb, 'title edits never recalculate old shares') from edited_history;

create temporary table payment_result as
select updated.* from friend_removal_fixture original, edited_history edited,
lateral public.update_shared_activity_v3(original.code, original.edit_token, 3,
  jsonb_set(edited.snapshot, '{expenses}', edited.snapshot->'expenses' || '[{
    "id":"payment","groupId":"trip","title":"Settlement","kind":"settlement","amount":10,
    "payerId":"maya","splitMethod":"exact","shares":{"me":10},"createdAt":"2026-09-09T13:00:00Z"
  }]'::jsonb)
) updated;
select is(revision, 4::bigint, 'inactive friends can still settle old balances') from payment_result;

create temporary table restored_result as
select updated.* from friend_removal_fixture original, payment_result paid,
lateral public.update_shared_activity_v3(original.code, original.edit_token, 4,
  jsonb_set(paid.snapshot, '{group,inactiveMemberIds}', '[]')
) updated;
select is(revision, 5::bigint, 'restore is revision checked') from restored_result;
select is(snapshot #> '{group,inactiveMemberIds}', '[]'::jsonb, 'restore retains metadata for old-client protection') from restored_result;
select ok(private.is_valid_membership_transition(restored.snapshot, proposed.snapshot || jsonb_build_object('group', restored.snapshot->'group')),
  'restored people are eligible for new bills again') from restored_result restored, invalid_new_bill proposed;

select is(loaded.snapshot, (select snapshot from restored_result), 'other sessions see restored membership and all preserved records')
from friend_removal_fixture original
cross join lateral public.load_shared_activity(original.code, original.edit_token) loaded;

select * from finish();
rollback;
