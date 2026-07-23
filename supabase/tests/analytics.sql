begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

select has_table('private', 'analytics_events', 'private analytics storage exists');
select columns_are(
  'private',
  'analytics_events',
  array['id', 'event_name', 'surface', 'session_hash', 'occurred_at', 'locale'],
  'analytics storage contains only the approved fields'
);
select has_index('private', 'analytics_events', 'analytics_events_event_occurred_at_idx', 'event reports are indexed');
select has_index('private', 'analytics_events', 'analytics_events_session_occurred_at_idx', 'session funnels are indexed');
select has_index('private', 'analytics_events', 'analytics_events_occurred_at_idx', 'retention cleanup is indexed');
select is(
  (select relrowsecurity from pg_class where oid = 'private.analytics_events'::regclass),
  true,
  'analytics storage has row security enabled'
);
select is(
  has_table_privilege('anon', 'private.analytics_events', 'INSERT'),
  false,
  'anonymous clients cannot insert directly'
);
select is(
  has_table_privilege('anon', 'private.analytics_events', 'SELECT'),
  false,
  'anonymous clients cannot read analytics events'
);
select has_view('private', 'analytics_daily', 'a private daily aggregate view exists');
select is(
  has_table_privilege('anon', 'private.analytics_daily', 'SELECT'),
  false,
  'anonymous clients cannot read analytics aggregates'
);
select has_view('private', 'analytics_hourly', 'a private hourly aggregate view exists');
select is(
  has_table_privilege('anon', 'private.analytics_hourly', 'SELECT'),
  false,
  'anonymous clients cannot read hourly analytics aggregates'
);
select has_view('private', 'analytics_locale_daily', 'a private locale aggregate view exists');
select is(
  has_table_privilege('anon', 'private.analytics_locale_daily', 'SELECT'),
  false,
  'anonymous clients cannot read locale analytics aggregates'
);
select is(
  has_function_privilege('anon', 'private.record_analytics_event(text,text,text)', 'EXECUTE'),
  false,
  'anonymous clients cannot execute the private recorder'
);
select is(
  has_function_privilege('anon', 'private.record_analytics_event(text,text,text,text)', 'EXECUTE'),
  false,
  'anonymous clients cannot execute the locale-aware private recorder'
);
select is(
  has_function_privilege('anon', 'public.record_analytics_event(text,text,text)', 'EXECUTE'),
  true,
  'legacy anonymous clients can execute only the public recorder'
);
select is(
  has_function_privilege('anon', 'public.record_analytics_event(text,text,text,text)', 'EXECUTE'),
  true,
  'anonymous clients can execute the locale-aware public recorder'
);
select has_function(
  'public',
  'record_analytics_event',
  array['text', 'text', 'text'],
  'legacy analytics RPC remains available'
);
select has_function(
  'public',
  'record_analytics_event',
  array['text', 'text', 'text', 'text'],
  'locale-aware analytics RPC exists'
);

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.20"}', true);
select lives_ok(
  $$select public.record_analytics_event('expense_added', 'local', '0123456789abcdef0123456789abcdef')$$,
  'an approved local event is recorded'
);
select is(
  (select count(*) from private.analytics_events where event_name = 'expense_added'),
  1::bigint,
  'one event is stored'
);
select is(
  (
    select session_hash
    from private.analytics_events
    where event_name = 'expense_added'
  ),
  extensions.digest('0123456789abcdef0123456789abcdef', 'sha256'),
  'the browser session token is stored only as a one-way hash'
);
select is(
  (
    select locale
    from private.analytics_events
    where event_name = 'expense_added'
  ),
  'unknown',
  'legacy analytics clients are classified without guessing their locale'
);

select lives_ok(
  $$select public.record_analytics_event('activity_created', 'live', 'abcdef0123456789abcdef0123456789', 'zh-CN')$$,
  'an approved locale-aware event is recorded'
);
select is(
  (
    select locale
    from private.analytics_events
    where event_name = 'activity_created' and surface = 'live'
  ),
  'zh-CN',
  'the resolved app locale is stored'
);

select throws_ok(
  $$select public.record_analytics_event('expense_with_amount_42', 'local', '0123456789abcdef0123456789abcdef')$$,
  '22023',
  'invalid_analytics_event',
  'unapproved event names are rejected'
);
select throws_ok(
  $$select public.record_analytics_event('expense_added', 'private_activity_ABC123', '0123456789abcdef0123456789abcdef')$$,
  '22023',
  'invalid_analytics_surface',
  'unapproved surfaces are rejected'
);
select throws_ok(
  $$select public.record_analytics_event('expense_added', 'live', 'secret-live-capability')$$,
  '22023',
  'invalid_analytics_session',
  'non-session identifiers are rejected'
);
select throws_ok(
  $$select public.record_analytics_event('expense_added', 'live', '0123456789abcdef0123456789abcdef', 'en-US')$$,
  '22023',
  'invalid_analytics_locale',
  'unapproved locales are rejected'
);

select is(
  (
    select events
    from private.analytics_daily
    where event_name = 'expense_added' and surface = 'local'
  ),
  1::bigint,
  'daily aggregates count approved events'
);
select is(
  (
    select sessions
    from private.analytics_daily
    where event_name = 'expense_added' and surface = 'local'
  ),
  1::bigint,
  'daily aggregates count anonymous sessions'
);
select is(
  (
    select events
    from private.analytics_locale_daily
    where event_name = 'expense_added'
      and surface = 'local'
      and locale = 'unknown'
  ),
  1::bigint,
  'locale aggregates retain legacy events as unknown'
);
select is(
  (
    select sessions
    from private.analytics_locale_daily
    where event_name = 'activity_created'
      and surface = 'live'
      and locale = 'zh-CN'
  ),
  1::bigint,
  'locale aggregates count anonymous sessions by app locale'
);

insert into private.analytics_events (event_name, surface, session_hash, occurred_at, locale)
values
  (
    'activity_created',
    'snapshot',
    extensions.digest('hourly-session-one', 'sha256'),
    timestamptz '2026-07-16 01:15:00+00',
    'en'
  ),
  (
    'activity_created',
    'snapshot',
    extensions.digest('hourly-session-two', 'sha256'),
    timestamptz '2026-07-16 02:45:00+00',
    'zh-CN'
  );
select is(
  (
    select count(*)
    from private.analytics_hourly
    where event_name = 'activity_created' and surface = 'snapshot'
  ),
  2::bigint,
  'hourly aggregates keep separate hours from the same UTC day'
);
select is(
  (
    select min(event_hour)
    from private.analytics_hourly
    where event_name = 'activity_created' and surface = 'snapshot'
  ),
  timestamptz '2026-07-16 01:00:00+00',
  'hourly aggregates truncate timestamps to the start of the UTC hour'
);
select is(
  (
    select max(event_hour)
    from private.analytics_hourly
    where event_name = 'activity_created' and surface = 'snapshot'
  ),
  timestamptz '2026-07-16 02:00:00+00',
  'hourly aggregates preserve a later hour on the same UTC day'
);
select is(
  (
    select sum(events)
    from private.analytics_hourly
    where event_name = 'activity_created' and surface = 'snapshot'
  ),
  2::numeric,
  'hourly aggregates count approved events'
);

insert into private.analytics_events (event_name, surface, session_hash, occurred_at, locale)
values (
  'app_opened',
  'local',
  extensions.digest('old-session', 'sha256'),
  clock_timestamp() - interval '91 days',
  'unknown'
);
select public.record_analytics_event('app_opened', 'live', 'fedcba9876543210fedcba9876543210');
select is(
  (select count(*) from private.analytics_events where occurred_at < clock_timestamp() - interval '90 days'),
  0::bigint,
  'app opens remove expired analytics rows in bounded batches'
);
select is(
  (
    select octet_length(identifier_hash)
    from private.shared_activity_rate_limits
    where operation = 'analytics'
      and identifier_hash = extensions.digest('203.0.113.20', 'sha256')
  ),
  32,
  'analytics throttling stores only a one-way client identifier hash'
);

select * from finish();
rollback;
