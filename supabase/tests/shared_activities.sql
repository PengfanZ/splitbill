begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

select has_schema('private', 'private schema exists');
select has_table('private', 'shared_activities', 'shared activity storage exists');
select has_column('private', 'shared_activities', 'expires_at', 'shared activities expire');
select has_index('private', 'shared_activities', 'shared_activities_expires_at_idx', 'expiry cleanup is indexed');
select is(
  (select relrowsecurity from pg_class where oid = 'private.shared_activities'::regclass),
  true,
  'shared activity storage has row security enabled'
);
select has_table('private', 'shared_activity_rate_limits', 'private API rate limits exist');
select has_table('private', 'security_secrets', 'private request-identifier secrets exist');
select is(
  has_table_privilege('anon', 'private.security_secrets', 'SELECT'),
  false,
  'anonymous clients cannot read request-identifier secrets'
);
select has_index(
  'private',
  'shared_activity_rate_limits',
  'shared_activity_rate_limits_window_started_at_idx',
  'rate limit cleanup is indexed'
);
select is(
  (select relrowsecurity from pg_class where oid = 'private.shared_activity_rate_limits'::regclass),
  true,
  'rate limit storage has row security enabled'
);
select is(
  has_function_privilege('anon', 'private.create_shared_activity(jsonb)', 'EXECUTE'),
  false,
  'anonymous clients cannot execute private functions directly'
);
select is(
  has_function_privilege('anon', 'public.create_shared_activity(jsonb)', 'EXECUTE'),
  true,
  'anonymous clients can execute only the public create wrapper'
);
select is(
  has_function_privilege('anon', 'public.update_shared_activity_v2(text,text,bigint,jsonb)', 'EXECUTE'),
  true,
  'anonymous clients can execute the conflict-aware update wrapper'
);
select is(
  has_function_privilege('anon', 'public.update_shared_activity_v3(text,text,bigint,jsonb)', 'EXECUTE'),
  true,
  'anonymous clients can execute the rejection-aware update wrapper'
);
select is(
  has_function_privilege('anon', 'private.poll_shared_activity(text,text)', 'EXECUTE'),
  false,
  'anonymous clients cannot execute the private polling function'
);
select is(
  has_function_privilege('anon', 'public.poll_shared_activity(text,text)', 'EXECUTE'),
  true,
  'anonymous clients can execute the revision-only polling wrapper'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.shared_activities'::regclass
      and conname = 'shared_activities_valid_snapshot'
      and convalidated
  ),
  'stored snapshots have a validated database constraint'
);
select has_function('public', 'create_shared_activity', array['jsonb'], 'create RPC exists');
select has_function('public', 'load_shared_activity', array['text', 'text'], 'load RPC exists');
select has_function('public', 'poll_shared_activity', array['text', 'text'], 'poll RPC exists');
select has_function('public', 'update_shared_activity', array['text', 'text', 'bigint', 'jsonb'], 'update RPC exists');
select has_function('public', 'update_shared_activity_v2', array['text', 'text', 'bigint', 'jsonb'], 'conflict-aware update RPC exists');
select has_function('public', 'update_shared_activity_v3', array['text', 'text', 'bigint', 'jsonb'], 'rejection-aware update RPC exists');

create temporary table created_activity as
select * from public.create_shared_activity(jsonb_build_object(
  'version', 2,
  'sender', jsonb_build_object('id', 'me', 'name', 'Alex', 'initials', 'A', 'color', '#16724c'),
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
  (select polled.revision from created_activity created cross join lateral public.poll_shared_activity(created.code, created.edit_token) polled),
  1::bigint,
  'valid capabilities poll only the current revision'
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

select set_config('response.status', '200', true);
select is(
  (
    select count(*)
    from created_activity created
    cross join lateral public.update_shared_activity(
      created.code,
      created.edit_token,
      1,
      created.snapshot
    )
  ),
  0::bigint,
  'legacy stale revisions return no writable record'
);
select is(
  current_setting('response.status', true),
  '409',
  'legacy stale revisions preserve the semantic HTTP conflict status'
);

create temporary table v2_updated_activity as
select updated.*
from created_activity created
cross join lateral public.update_shared_activity_v2(
  created.code,
  created.edit_token,
  2,
  jsonb_set(created.snapshot, '{group,name}', '"Conflict-aware weekend"')
) updated;

select is(revision, 3::bigint, 'conflict-aware updates increment the revision') from v2_updated_activity;
select is(conflicted, false, 'successful conflict-aware updates are not marked conflicted') from v2_updated_activity;

create temporary table v2_conflicted_activity as
select conflicted.*
from created_activity created
cross join lateral public.update_shared_activity_v2(
  created.code,
  created.edit_token,
  2,
  created.snapshot
) conflicted;

select is(conflicted, true, 'stale conflict-aware updates return a normal conflict result') from v2_conflicted_activity;
select is(revision, 3::bigint, 'conflict results include the latest revision') from v2_conflicted_activity;
select is(snapshot #>> '{group,name}', 'Conflict-aware weekend', 'conflict results include the latest snapshot') from v2_conflicted_activity;

create temporary table v2_rejected_activity as
select rejected.*
from created_activity created
cross join lateral public.update_shared_activity_v2(
  created.code,
  created.edit_token,
  3,
  jsonb_set(created.snapshot, '{group,name}', to_jsonb(repeat('x', 121)))
) rejected;

select is(conflicted, true, 'legacy clients receive a normal conflict-shaped result for invalid snapshots') from v2_rejected_activity;
select is(revision, 3::bigint, 'legacy invalid snapshots do not increment the revision') from v2_rejected_activity;

create temporary table update_rate_before_rejection as
select request_count
from private.shared_activity_rate_limits
where identifier_hash = private.shared_activity_request_identifier()
  and operation = 'update';

create temporary table v3_rejected_activity as
select rejected.*
from created_activity created
cross join lateral public.update_shared_activity_v3(
  created.code,
  created.edit_token,
  3,
  jsonb_set(created.snapshot, '{group,name}', to_jsonb(repeat('x', 121)))
) rejected;

select is(rejection_code, 'invalid_activity_snapshot', 'invalid snapshots return a typed normal rejection') from v3_rejected_activity;
select is(conflicted, true, 'snapshot rejections remain safe for older conflict-aware clients') from v3_rejected_activity;
select is(revision, 3::bigint, 'rejected snapshots leave the stored revision unchanged') from v3_rejected_activity;
select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where identifier_hash = private.shared_activity_request_identifier()
      and operation = 'update'
  ),
  (select request_count + 1 from update_rate_before_rejection),
  'rejected snapshots still consume a rate-limit request'
);

select set_config('response.status', '200', true);
select is(
  (
    select count(*)
    from created_activity created
    cross join lateral public.load_shared_activity(created.code, repeat('0', 64))
  ),
  0::bigint,
  'invalid edit tokens do not reveal activities'
);
select is(
  current_setting('response.status', true),
  '404',
  'invalid edit tokens preserve the not-found HTTP status'
);
select is(
  (
    select count(*)
    from created_activity created
    cross join lateral public.poll_shared_activity(created.code, repeat('0', 64))
  ),
  0::bigint,
  'revision polling does not reveal invalid edit tokens'
);

create temporary table create_rate_before_rejection as
select request_count
from private.shared_activity_rate_limits
where identifier_hash = private.shared_activity_request_identifier()
  and operation = 'create';

select is(
  (select count(*) from public.create_shared_activity('{}'::jsonb)),
  0::bigint,
  'invalid snapshots are rejected'
);
select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where identifier_hash = private.shared_activity_request_identifier()
      and operation = 'create'
  ),
  (select request_count + 1 from create_rate_before_rejection),
  'invalid creates still consume a rate-limit request'
);
select is(
  (select count(*) from public.create_shared_activity(null::jsonb)),
  0::bigint,
  'null snapshots are rejected explicitly'
);

select is(
  (
    select count(*)
    from created_activity created
    cross join lateral public.update_shared_activity_v2(
      created.code,
      created.edit_token,
      0,
      created.snapshot
    )
  ),
  0::bigint,
  'invalid revisions are rejected'
);

select is(
  (
    select count(*)
    from created_activity created
    cross join lateral public.update_shared_activity_v2(
      created.code,
      created.edit_token,
      null,
      created.snapshot
    )
  ),
  0::bigint,
  'null revisions are rejected explicitly'
);

select is(
  (
    select count(*)
    from created_activity created
    cross join lateral public.update_shared_activity_v2(
      created.code,
      repeat('0', 64),
      3,
      created.snapshot
    )
  ),
  0::bigint,
  'conflict-aware updates do not reveal invalid edit tokens'
);

select is(
  (
    select count(*)
    from public.create_shared_activity(
      (
        select jsonb_set(
          snapshot,
          '{friends}',
          (
            select jsonb_agg(jsonb_build_object(
              'id', 'friend-' || index,
              'name', 'Friend ' || index,
              'initials', 'F',
              'color', '#abc'
            ))
            from generate_series(1, 101) index
          )
        )
        from created_activity
      )
    )
  ),
  0::bigint,
  'oversized participant lists are rejected'
);

update private.shared_activities
set created_at = clock_timestamp() - interval '100 days',
    updated_at = clock_timestamp() - interval '91 days',
    expires_at = clock_timestamp() - interval '1 day'
where code = (select code from created_activity);

select is(
  (
    select count(*)
    from created_activity created
    cross join lateral public.load_shared_activity(created.code, created.edit_token)
  ),
  0::bigint,
  'expired activities cannot be loaded'
);

select is(
  (
    select count(*)
    from created_activity created
    cross join lateral public.poll_shared_activity(created.code, created.edit_token)
  ),
  0::bigint,
  'expired activities cannot be polled'
);

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.10"}', true);
select lives_ok(
  $$select private.enforce_shared_activity_rate_limit('load', 2, interval '1 hour')$$,
  'the first request is inside the rate limit'
);
select lives_ok(
  $$select private.enforce_shared_activity_rate_limit('load', 2, interval '1 hour')$$,
  'the final allowed request is accepted'
);
select throws_like(
  $$select private.enforce_shared_activity_rate_limit('load', 2, interval '1 hour')$$,
  '%rate_limit_exceeded%',
  'requests above the limit are rejected'
);
select is(
  (
    select octet_length(identifier_hash)
    from private.shared_activity_rate_limits
    where identifier_hash = private.shared_activity_request_identifier()
      and operation = 'load'
  ),
  32,
  'rate limits store only a fixed-length pseudonymous identifier'
);
select isnt(
  private.shared_activity_request_identifier(),
  extensions.digest('203.0.113.10', 'sha256'),
  'request identifiers are protected with a database-secret pepper'
);

create table public.default_privilege_probe (id bigint);
create function public.default_privilege_probe()
returns integer
language sql
as $$ select 1; $$;
select is(
  has_table_privilege('anon', 'public.default_privilege_probe', 'SELECT'),
  false,
  'new public tables are not exposed to anonymous clients by default'
);
select is(
  has_function_privilege('anon', 'public.default_privilege_probe()', 'EXECUTE'),
  false,
  'new public functions are not executable anonymously by default'
);

select * from finish();
rollback;
