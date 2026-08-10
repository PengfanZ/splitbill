begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- Isolate project-wide counters and records while preserving developer data
-- through the final rollback.
delete from private.public_api_budget_usage;
delete from private.analytics_events;

select has_table('private', 'public_api_budget_limits', 'project API budget configuration exists');
select has_table('private', 'public_api_budget_usage', 'project API budget usage exists');
select is(
  (select relrowsecurity from pg_class where oid = 'private.public_api_budget_limits'::regclass),
  true,
  'project API budget configuration has row security enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'private.public_api_budget_usage'::regclass),
  true,
  'project API budget usage has row security enabled'
);
select is(has_table_privilege('anon', 'private.public_api_budget_limits', 'SELECT'), false, 'anonymous clients cannot read project budgets');
select is(has_table_privilege('authenticated', 'private.public_api_budget_limits', 'SELECT'), false, 'authenticated clients cannot read project budgets');
select is(has_table_privilege('service_role', 'private.public_api_budget_limits', 'SELECT'), false, 'service clients cannot read project budgets directly');
select is(has_table_privilege('anon', 'private.public_api_budget_usage', 'SELECT'), false, 'anonymous clients cannot read project usage');
select is(has_table_privilege('authenticated', 'private.public_api_budget_usage', 'SELECT'), false, 'authenticated clients cannot read project usage');
select is(has_table_privilege('service_role', 'private.public_api_budget_usage', 'SELECT'), false, 'service clients cannot read project usage directly');

select has_function(
  'private',
  'enforce_public_api_project_budget',
  array['text', 'bigint'],
  'the private project budget function exists'
);
select is(has_function_privilege('anon', 'private.enforce_public_api_project_budget(text,bigint)', 'EXECUTE'), false, 'anonymous clients cannot execute the budget function');
select is(has_function_privilege('authenticated', 'private.enforce_public_api_project_budget(text,bigint)', 'EXECUTE'), false, 'authenticated clients cannot execute the budget function');
select is(has_function_privilege('service_role', 'private.enforce_public_api_project_budget(text,bigint)', 'EXECUTE'), false, 'service clients cannot bypass public RPCs through the budget function');
select results_eq(
  $$select operation, daily_limit, enabled from private.public_api_budget_limits order by operation$$,
  $$values ('analytics_events'::text, 5000::bigint, true), ('create_bytes'::text, 5242880::bigint, true)$$,
  'project budgets start with conservative configurable defaults'
);

select is(
  (
    select count(*)
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) privilege
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 'public'::regnamespace
      and defaults.defaclobjtype = 'f'
      and privilege.privilege_type = 'EXECUTE'
      and (
        privilege.grantee = 0
        or privilege.grantee in (
          'anon'::regrole,
          'authenticated'::regrole,
          'service_role'::regrole
        )
      )
  ),
  0::bigint,
  'future public functions created by the app owner do not inherit browser execution'
);

create function public.security_default_privilege_probe()
returns integer
language sql
as $$ select 1; $$;
select is(has_function_privilege('anon', 'public.security_default_privilege_probe()', 'EXECUTE'), false, 'new functions are closed to anonymous clients by default');
select is(has_function_privilege('authenticated', 'public.security_default_privilege_probe()', 'EXECUTE'), false, 'new functions are closed to authenticated clients by default');
select is(has_function_privilege('service_role', 'public.security_default_privilege_probe()', 'EXECUTE'), false, 'new functions are closed to service clients by default');

select throws_like(
  $$select private.enforce_public_api_project_budget('unknown', 1)$$,
  '%invalid_project_budget_configuration%',
  'unknown project budget operations fail closed'
);

create temporary table project_budget_snapshot as
select jsonb_build_object(
  'version', 2,
  'sender', jsonb_build_object('id', 'me', 'name', 'Alex', 'initials', 'A', 'color', '#16724c'),
  'group', jsonb_build_object(
    'id', 'security-budget',
    'name', 'Security budget',
    'emoji', '✦',
    'memberIds', jsonb_build_array('me'),
    'currency', 'USD'
  ),
  'friends', '[]'::jsonb,
  'expenses', '[]'::jsonb,
  'payments', '[]'::jsonb
) as snapshot;

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.201"}', true);
select lives_ok(
  $$select * from public.create_shared_activity('{}'::jsonb)$$,
  'invalid live creation returns a normal rejection'
);
select is(
  (select count(*) from private.public_api_budget_usage where operation = 'create_bytes'),
  0::bigint,
  'invalid live creation does not consume shared storage capacity'
);
select lives_ok(
  $$select * from public.create_shared_activity((select snapshot from project_budget_snapshot))$$,
  'valid live creation succeeds inside the project budget'
);
select ok(
  (select used_units > 0 from private.public_api_budget_usage where operation = 'create_bytes'),
  'valid live creation consumes its encoded snapshot size'
);
update private.public_api_budget_limits
set daily_limit = (
  select used_units from private.public_api_budget_usage where operation = 'create_bytes'
)
where operation = 'create_bytes';
select throws_like(
  $$select * from public.create_shared_activity((select snapshot from project_budget_snapshot))$$,
  '%project_rate_limit_exceeded%',
  'live creation stops before exceeding the project storage budget'
);
select is(
  (
    select used_units
    from private.public_api_budget_usage
    where operation = 'create_bytes'
  ),
  (
    select daily_limit
    from private.public_api_budget_limits
    where operation = 'create_bytes'
  ),
  'a rejected live creation does not inflate committed project usage'
);

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.202"}', true);
select lives_ok(
  $$select public.record_analytics_event('not_allowed', 'local', '0123456789abcdef0123456789abcdef', 'en', null)$$,
  'invalid analytics returns a normal rejection'
);
select is(
  (select count(*) from private.public_api_budget_usage where operation = 'analytics_events'),
  0::bigint,
  'invalid analytics does not consume shared reporting capacity'
);
select lives_ok(
  $$select public.record_analytics_event('expense_added', 'local', '0123456789abcdef0123456789abcdef', 'en', null)$$,
  'valid analytics succeeds inside the project budget'
);
select is(
  (select used_units from private.public_api_budget_usage where operation = 'analytics_events'),
  1::bigint,
  'a valid analytics event consumes one project unit'
);
update private.public_api_budget_limits set daily_limit = 1 where operation = 'analytics_events';
select throws_like(
  $$select public.record_analytics_event('expense_added', 'local', 'abcdef0123456789abcdef0123456789', 'en', null)$$,
  '%project_rate_limit_exceeded%',
  'analytics stops before exceeding the project event budget'
);
select is(
  (select count(*) from private.analytics_events),
  1::bigint,
  'an event rejected by the project budget is not stored'
);

update private.public_api_budget_limits set enabled = false where operation = 'analytics_events';
select throws_like(
  $$select private.enforce_public_api_project_budget('analytics_events', 1)$$,
  '%project_rate_limit_exceeded%',
  'disabling a project budget fails closed'
);
update private.public_api_budget_limits set enabled = true, daily_limit = 5000 where operation = 'analytics_events';
update private.public_api_budget_usage
set window_started_at = clock_timestamp() - interval '2 days', used_units = 4999
where operation = 'analytics_events';
select lives_ok(
  $$select private.enforce_public_api_project_budget('analytics_events', 1)$$,
  'a completed rolling window accepts new usage'
);
select is(
  (select used_units from private.public_api_budget_usage where operation = 'analytics_events'),
  1::bigint,
  'a completed rolling window resets its usage atomically'
);

select * from finish();
rollback;
