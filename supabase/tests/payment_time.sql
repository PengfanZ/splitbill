begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

create temporary table payment_snapshot as select '{
  "version":2,"sender":{"id":"me","name":"Maya","initials":"M","color":"#abc"},
  "group":{"id":"trip","name":"Trip","emoji":"☀","memberIds":["me"]},"friends":[],
  "expenses":[
    {"id":"dinner","groupId":"trip","title":"Dinner","amount":10,"payerId":"me","splitMethod":"equal","shares":{"me":10},"createdAt":"2026-11-15T20:00:00Z","paidAt":"2026-11-13T19:30:00Z"},
    {"id":"taxi","groupId":"trip","title":"Taxi","amount":5,"payerId":"me","splitMethod":"equal","shares":{"me":5},"createdAt":"2026-11-15T21:00:00Z"}
  ]
}'::jsonb as snapshot;

select ok(private.is_valid_activity_snapshot((select snapshot from payment_snapshot)), 'a payment time is accepted');
select ok(private.is_valid_activity_snapshot((select snapshot #- '{expenses,0,paidAt}' from payment_snapshot)), 'a payment time stays optional');
select ok(not private.is_valid_activity_snapshot((select jsonb_set(snapshot, '{expenses,0,paidAt}', '"yesterday"') from payment_snapshot)), 'reject an unreadable payment time');
select ok(not private.is_valid_activity_snapshot((select jsonb_set(snapshot, '{expenses,0,paidAt}', '5') from payment_snapshot)), 'reject a payment time that is not text');
select ok(not private.is_valid_activity_snapshot((select jsonb_set(snapshot, '{expenses,0,paidAt}', 'null') from payment_snapshot)), 'reject a null payment time');
select ok(not private.is_valid_activity_snapshot((select jsonb_set(snapshot, '{expenses,0,paidAt}', to_jsonb('2026-11-13T19:30:00' || repeat('0', 110) || 'Z')) from payment_snapshot)), 'reject an oversized payment time');

select is(private.preserve_activity_payment_times(
  '{"expenses":[{"id":"e","amount":10,"paidAt":"2026-11-13T19:30:00Z"}]}',
  '{"expenses":[{"id":"e","amount":20}]}') #>> '{expenses,0,paidAt}', '2026-11-13T19:30:00Z', 'older-client edit keeps the payment time');
select is(private.preserve_activity_payment_times(
  '{"expenses":[{"id":"e","amount":10,"paidAt":"2026-11-13T19:30:00Z"}]}',
  '{"expenses":[{"id":"e","amount":20}]}') #>> '{expenses,0,amount}', '20', 'preservation never overwrites money');
select is(private.preserve_activity_payment_times(
  '{"expenses":[{"id":"e","paidAt":"2026-11-13T19:30:00Z"}]}',
  '{"expenses":[{"id":"e","paidAt":"2026-11-12T08:00:00Z"}]}') #>> '{expenses,0,paidAt}', '2026-11-12T08:00:00Z', 'a changed payment time is kept as sent');
select is(private.preserve_activity_payment_times(
  '{"expenses":[{"id":"e","paidAt":"2026-11-13T19:30:00Z"}]}',
  '{"expenses":[{"id":"new"},{"id":"e"}]}'), '{"expenses":[{"id":"new"},{"id":"e","paidAt":"2026-11-13T19:30:00Z"}]}'::jsonb, 'new expenses gain nothing and order is unchanged');
select is(private.preserve_activity_payment_times(
  '{"expenses":[{"id":"e","paidAt":"yesterday"}]}',
  '{"expenses":[{"id":"e"}]}'), '{"expenses":[{"id":"e"}]}'::jsonb, 'an unreadable earlier payment time is not copied');
select is(private.preserve_activity_payment_times('{"expenses":[]}', '{"expenses":"none"}'), '{"expenses":"none"}'::jsonb, 'malformed input is left for validation to reject');

create temporary table payment_fixture as
  select created.* from payment_snapshot cross join lateral public.create_shared_activity(payment_snapshot.snapshot) created;
select is((select snapshot #>> '{expenses,0,paidAt}' from payment_fixture), '2026-11-13T19:30:00Z', 'a new shared activity stores the payment time');
create temporary table payment_legacy_edit as select updated.* from payment_fixture fixture
cross join lateral public.update_shared_activity_v3(fixture.code, fixture.edit_token, fixture.revision,
  jsonb_set(fixture.snapshot #- '{expenses,0,paidAt}', '{expenses,0,title}', '"Dinner out"')) updated;
select is((select snapshot #> '{expenses,0}' ->> 'paidAt' from payment_legacy_edit), '2026-11-13T19:30:00Z', 'RPC keeps the payment time when an older client edits the expense');
select is((select snapshot #>> '{expenses,0,title}' from payment_legacy_edit), 'Dinner out', 'the older client''s edit is still saved');
select is((select updated.rejection_code from payment_fixture fixture
cross join lateral public.update_shared_activity_v3(fixture.code, fixture.edit_token, 2,
  jsonb_set(fixture.snapshot, '{expenses,0,paidAt}', '"yesterday"')) updated),
  'invalid_activity_snapshot', 'an unreadable payment time is a structured rejection, not a 500');
select is(has_function_privilege('anon', 'private.preserve_activity_payment_times(jsonb, jsonb)', 'EXECUTE')
  or has_function_privilege('authenticated', 'private.preserve_activity_payment_times(jsonb, jsonb)', 'EXECUTE'), false, 'browser roles cannot call the preservation helper');
select * from finish();
rollback;
