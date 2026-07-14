begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select has_schema('private', 'private schema exists');
select has_table('private', 'shared_activities', 'shared activity storage exists');
select has_function('public', 'create_shared_activity', array['jsonb'], 'create RPC exists');
select has_function('public', 'load_shared_activity', array['text', 'text'], 'load RPC exists');
select has_function('public', 'update_shared_activity', array['text', 'text', 'bigint', 'jsonb'], 'update RPC exists');

create temporary table created_activity as
select * from public.create_shared_activity(jsonb_build_object(
  'version', 2,
  'sender', jsonb_build_object('id', 'me'),
  'group', jsonb_build_object('id', 'trip', 'name', 'Weekend', 'emoji', '✦', 'memberIds', jsonb_build_array('me')),
  'friends', '[]'::jsonb,
  'expenses', '[]'::jsonb
));

select matches(code, '^[A-F0-9]{10}$', 'create returns a short activity code') from created_activity;
select matches(edit_token, '^[a-f0-9]{64}$', 'create returns a secret edit token') from created_activity;
select is(revision, 1::bigint, 'new activities start at revision one') from created_activity;

select is(
  (select loaded.revision from created_activity created cross join lateral public.load_shared_activity(created.code, created.edit_token) loaded),
  1::bigint,
  'valid capabilities load the activity'
);

select is(
  (select updated.revision from created_activity created cross join lateral public.update_shared_activity(
    created.code,
    created.edit_token,
    1,
    jsonb_set(created.snapshot, '{group,name}', '"Updated weekend"')
  ) updated),
  2::bigint,
  'updates increment the revision atomically'
);

select throws_ok(
  format(
    'select public.update_shared_activity(%L, %L, 1, %L::jsonb)',
    (select code from created_activity),
    (select edit_token from created_activity),
    (select snapshot::text from created_activity)
  ),
  '40001',
  'shared_activity_conflict',
  'stale revisions cannot overwrite newer data'
);

select throws_ok(
  format('select public.load_shared_activity(%L, %L)', (select code from created_activity), repeat('0', 64)),
  'P0002',
  'shared_activity_not_found',
  'invalid edit tokens do not reveal activities'
);

select throws_ok(
  $$select public.create_shared_activity('{}'::jsonb)$$,
  '22023',
  'invalid_activity_snapshot',
  'invalid snapshots are rejected'
);

select throws_ok(
  $$select public.create_shared_activity(null::jsonb)$$,
  '22023',
  'invalid_activity_snapshot',
  'null snapshots are rejected explicitly'
);

select throws_ok(
  format(
    'select public.update_shared_activity(%L, %L, 0, %L::jsonb)',
    (select code from created_activity),
    (select edit_token from created_activity),
    (select snapshot::text from created_activity)
  ),
  '22023',
  'invalid_expected_revision',
  'invalid revisions are rejected'
);

select throws_ok(
  format(
    'select public.update_shared_activity(%L, %L, null, %L::jsonb)',
    (select code from created_activity),
    (select edit_token from created_activity),
    (select snapshot::text from created_activity)
  ),
  '22023',
  'invalid_expected_revision',
  'null revisions are rejected explicitly'
);

select * from finish();
rollback;
