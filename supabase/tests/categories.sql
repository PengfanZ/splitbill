begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);
select ok(private.is_valid_activity_categories('{"group":{},"expenses":[]}'::jsonb), 'legacy activities remain valid');
select ok(private.is_valid_activity_categories('{"group":{},"expenses":[{"categoryId":"food"}]}'::jsonb), 'default categories are valid without materializing a list');
select ok(private.is_valid_activity_categories('{"group":{"categories":[]},"expenses":[{"categoryId":null}]}'::jsonb), 'General remains available after all custom categories are deleted');
select ok(not private.is_valid_activity_categories('{"group":{"categories":null},"expenses":[]}'::jsonb), 'reject invalid list');
select ok(not private.is_valid_activity_categories('{"group":{"categories":[{"id":"x","name":"General","color":"#719d86"}]},"expenses":[]}'::jsonb), 'reject reserved General category');
select ok(not private.is_valid_activity_categories('{"group":{"categories":[{"id":"x","name":"Test","color":"red"}]},"expenses":[]}'::jsonb), 'reject unsupported colors');
select ok(not private.is_valid_activity_categories('{"group":{},"expenses":[{"categoryId":"unknown"}]}'::jsonb), 'reject dangling references');
select ok(not private.is_valid_activity_categories('{"group":{},"expenses":[{"categoryId":"food","kind":"settlement"}]}'::jsonb), 'repayments cannot be categorized');
select is(private.preserve_activity_categories(
  '{"group":{},"expenses":[{"id":"e","amount":10,"categoryId":"food"}]}',
  '{"group":{},"expenses":[{"id":"e","amount":20}]}') #>> '{expenses,0,categoryId}', 'food', 'older-client edit preserves category');
select is(private.preserve_activity_categories(
  '{"group":{},"expenses":[{"id":"e","amount":10,"categoryId":"food"}]}',
  '{"group":{},"expenses":[{"id":"e","amount":20,"categoryId":null}]}') #> '{expenses,0,categoryId}', 'null'::jsonb, 'explicit General is not overwritten');
select is(private.preserve_activity_categories(
  '{"group":{},"expenses":[{"id":"e","amount":10,"categoryId":"food"}]}',
  '{"group":{},"expenses":[{"id":"e","amount":20}]}') #>> '{expenses,0,amount}', '20', 'compatibility preservation never overwrites money');
create temporary table category_fixture as select * from public.create_shared_activity('{
  "version":2,"sender":{"id":"me","name":"Maya","initials":"M","color":"#abc"},
  "group":{"id":"trip","name":"Trip","emoji":"☀","memberIds":["me"]},"friends":[],
  "expenses":[{"id":"e","groupId":"trip","title":"Lunch","amount":10,"payerId":"me","splitMethod":"equal","shares":{"me":10},"createdAt":"2026-09-22T12:00:00Z","categoryId":"food"}]
}'::jsonb);
create temporary table category_updated as select updated.* from category_fixture fixture
cross join lateral public.update_shared_activity_v3(fixture.code, fixture.edit_token, fixture.revision,
  fixture.snapshot #- '{expenses,0,categoryId}') updated;
select is((select snapshot #>> '{expenses,0,categoryId}' from category_updated), 'food', 'RPC returns preserved category to older clients');
select is((select revision from category_updated), 2::bigint, 'normal revision control remains intact');
create temporary table category_cleared as select updated.* from category_fixture fixture
cross join lateral public.update_shared_activity_v3(fixture.code, fixture.edit_token, 2,
  jsonb_set(fixture.snapshot, '{expenses,0,categoryId}', 'null'::jsonb)) updated;
select is((select snapshot #> '{expenses,0,categoryId}' from category_cleared), 'null'::jsonb, 'RPC can explicitly clear a category');
select is((select updated.rejection_code from category_fixture fixture
cross join lateral public.update_shared_activity_v3(fixture.code, fixture.edit_token, 3,
  jsonb_set(fixture.snapshot, '{expenses,0,categoryId}', '"missing"'::jsonb)) updated),
  'invalid_activity_snapshot', 'invalid category produces structured rejection, not a 500');
create temporary table custom_category_activity as select updated.* from category_fixture fixture
cross join lateral public.update_shared_activity_v3(fixture.code, fixture.edit_token, 3,
  jsonb_set(jsonb_set(fixture.snapshot, '{group,categories}', '[{"id":"coffee","name":"Coffee","color":"#719d86"}]'), '{expenses,0,categoryId}', '"coffee"')) updated;
create temporary table legacy_category_edit as select updated.* from category_fixture fixture, custom_category_activity current_activity
cross join lateral public.update_shared_activity_v3(fixture.code, fixture.edit_token, 4,
  jsonb_set(jsonb_set(current_activity.snapshot #- '{group,categories}' #- '{expenses,0,categoryId}', '{expenses,0,amount}', '20'), '{expenses,0,shares,me}', '20')) updated;
select is((select snapshot #>> '{group,categories,0,id}' from legacy_category_edit), 'coffee', 'older clients preserve custom category definitions');
select is((select snapshot #>> '{expenses,0,categoryId}' from legacy_category_edit), 'coffee', 'older clients preserve custom category assignment');
select is((select snapshot #>> '{expenses,0,amount}' from legacy_category_edit), '20', 'older clients can still edit expense money normally');
select is((select updated.conflicted from category_fixture fixture
cross join lateral public.update_shared_activity_v3(fixture.code, fixture.edit_token, 3, fixture.snapshot) updated), true, 'stale clients cannot overwrite newer category or expense changes');
select * from finish();
rollback;
