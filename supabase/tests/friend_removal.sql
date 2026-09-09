begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

create temporary table removed_friend_result as
select updated.* from friend_removal_fixture original
cross join lateral public.update_shared_activity_v3(original.code, original.edit_token, 1,
  jsonb_set(jsonb_set(original.snapshot, '{group,memberIds}', '["me","maya"]'), '{friends}', (original.snapshot->'friends') - 1)
) updated;

select is(revision, 2::bigint, 'removing an unused friend increments the live revision') from removed_friend_result;
select is(conflicted, false, 'unused-friend removal succeeds') from removed_friend_result;
select is(snapshot #> '{group,memberIds}', '["me","maya"]'::jsonb, 'removed friend is absent from the shared member list') from removed_friend_result;
select is(snapshot->'expenses', (select snapshot->'expenses' from friend_removal_fixture), 'existing expenses are unchanged') from removed_friend_result;

select ok(not private.is_valid_activity_snapshot(
  jsonb_set(jsonb_set(snapshot, '{group,memberIds}', '["me"]'), '{friends}', '[]')
), 'database rejects removal that would orphan an expense share') from removed_friend_result;
select ok(not private.is_valid_activity_snapshot(
  jsonb_set(jsonb_set(snapshot, '{group,memberIds}', '["me"]'), '{friends}', '[]')
  || jsonb_build_object('expenses', jsonb_build_array(jsonb_set(snapshot->'expenses'->0, '{payerId}', '"maya"')))
), 'database rejects removal that would orphan a payer') from removed_friend_result;

select is(conflicted, true, 'an older client cannot overwrite removal with a stale snapshot')
from friend_removal_fixture original
cross join lateral public.update_shared_activity_v3(original.code, original.edit_token, 1, original.snapshot);

select is(loaded.snapshot, (select snapshot from removed_friend_result), 'other live sessions load the same preserved expense history and new people list')
from friend_removal_fixture original
cross join lateral public.load_shared_activity(original.code, original.edit_token) loaded;

select * from finish();
rollback;
