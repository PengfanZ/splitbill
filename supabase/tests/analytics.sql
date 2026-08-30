begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

select has_table('private', 'analytics_events', 'private analytics storage exists');
select columns_are(
  'private',
  'analytics_events',
  array['id', 'event_name', 'surface', 'session_hash', 'occurred_at', 'locale', 'currency'],
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
select has_view('private', 'analytics_currency_daily', 'a private currency aggregate view exists');
select is(
  has_table_privilege('anon', 'private.analytics_currency_daily', 'SELECT'),
  false,
  'anonymous clients cannot read currency analytics aggregates'
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
  has_function_privilege('anon', 'private.record_analytics_event(text,text,text,text,text)', 'EXECUTE'),
  false,
  'anonymous clients cannot execute the currency-aware private recorder'
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
select is(
  has_function_privilege('anon', 'public.record_analytics_event(text,text,text,text,text)', 'EXECUTE'),
  true,
  'anonymous clients can execute the currency-aware public recorder'
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
select has_function(
  'public',
  'record_analytics_event',
  array['text', 'text', 'text', 'text', 'text'],
  'currency-aware analytics RPC exists'
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

select lives_ok(
  $$select public.record_analytics_event('currency_selected', 'local', '123456789abcdef0123456789abcdef0', 'en', 'CNY')$$,
  'an approved currency selection is recorded'
);
select is(
  (
    select currency
    from private.analytics_events
    where event_name = 'currency_selected'
  ),
  'CNY',
  'the selected allowlisted currency is stored'
);

select lives_ok(
  $$select public.record_analytics_event('live_share_clicked', 'local', '23456789abcdef0123456789abcdef01', 'en')$$,
  'a Live sharing click is recorded'
);
select is(
  (
    select count(*)
    from private.analytics_events
    where event_name = 'live_share_clicked'
      and surface = 'local'
      and occurred_at is not null
  ),
  1::bigint,
  'Live sharing clicks retain their server-side event time without activity data'
);

select lives_ok(
  $$select public.record_analytics_event('friend_added', 'local', '3456789abcdef0123456789abcdef012', 'en')$$,
  'a successful friend addition is recorded'
);
select is(
  (
    select count(*)
    from private.analytics_events
    where event_name = 'friend_added'
      and surface = 'local'
      and currency is null
      and occurred_at is not null
  ),
  1::bigint,
  'friend additions retain only the approved anonymous event fields'
);
select is(
  (
    select events
    from private.analytics_daily
    where event_name = 'friend_added' and surface = 'local'
  ),
  1::bigint,
  'daily analytics reports include successful friend additions'
);

select lives_ok(
  $$select public.record_analytics_event('summary_export_clicked', 'live', '456789abcdef0123456789abcdef0123', 'zh-CN')$$,
  'a balance-summary export click is recorded'
);
select is(
  (
    select count(*)
    from private.analytics_events
    where event_name = 'summary_export_clicked'
      and surface = 'live'
      and locale = 'zh-CN'
      and currency is null
      and occurred_at is not null
  ),
  1::bigint,
  'summary export clicks retain only approved anonymous event fields'
);
select is(
  (
    select events
    from private.analytics_daily
    where event_name = 'summary_export_clicked' and surface = 'live'
  ),
  1::bigint,
  'daily analytics reports include summary export clicks'
);

select lives_ok(
  $$select public.record_analytics_event('csv_export_completed', 'local', '46789abcdef0123456789abcdef01234', 'en')$$,
  'a completed CSV export is recorded'
);
select is(
  (
    select count(*)
    from private.analytics_events
    where event_name = 'csv_export_completed'
      and surface = 'local'
      and locale = 'en'
      and currency is null
      and occurred_at is not null
  ),
  1::bigint,
  'completed CSV exports retain only approved anonymous event fields'
);
select is(
  (
    select events
    from private.analytics_daily
    where event_name = 'csv_export_completed' and surface = 'local'
  ),
  1::bigint,
  'daily analytics reports include completed CSV exports'
);

select lives_ok(
  $$select public.record_analytics_event('feedback_submitted', 'live', '56789abcdef0123456789abcdef01234', 'zh-CN')$$,
  'a successful feedback submission is recorded'
);
select is(
  (
    select count(*)
    from private.analytics_events
    where event_name = 'feedback_submitted'
      and surface = 'live'
      and locale = 'zh-CN'
      and currency is null
      and occurred_at is not null
  ),
  1::bigint,
  'feedback analytics retain only approved anonymous event fields'
);
select is(
  (
    select events
    from private.analytics_daily
    where event_name = 'feedback_submitted' and surface = 'live'
  ),
  1::bigint,
  'daily analytics reports include successful feedback submissions'
);

select lives_ok(
  $$
    select public.record_analytics_event(
      event_name,
      'local',
      '6789abcdef0123456789abcdef012345',
      'en'
    )
    from unnest(array[
      'ai_text_requested',
      'ai_text_ready',
      'ai_text_clarification',
      'ai_text_failed',
      'ai_voice_requested',
      'ai_voice_ready',
      'ai_voice_clarification',
      'ai_voice_failed',
      'ai_receipt_requested',
      'ai_receipt_ready',
      'ai_receipt_failed',
      'ai_receipt_confirmed'
    ]) as event_name
  $$,
  'all privacy-safe AI funnel events are recorded'
);
select is(
  (select count(*) from private.analytics_events where event_name like 'ai\_%' escape '\'),
  12::bigint,
  'AI analytics store only the twelve allowlisted outcomes'
);
select is(
  (
    select count(distinct event_name)
    from private.analytics_daily
    where event_name like 'ai\_%' escape '\'
  ),
  12::bigint,
  'daily analytics reports distinguish every AI text, voice, and receipt outcome'
);

select lives_ok(
  $$
    select public.record_analytics_event(
      event_name,
      'local',
      '789abcdef0123456789abcdef0123456',
      'en'
    )
    from unnest(array[
      'expense_input_manual_selected',
      'expense_input_ai_text_selected',
      'expense_input_ai_voice_selected',
      'expense_input_receipt_selected'
    ]) as event_name
  $$,
  'all expense-input tab selections are recorded'
);
select is(
  (
    select count(*)
    from private.analytics_events
    where event_name like 'expense\_input\_%\_selected' escape '\'
  ),
  4::bigint,
  'one event is stored for each allowlisted expense-input tab'
);
select is(
  (
    select count(distinct event_name)
    from private.analytics_daily
    where event_name like 'expense\_input\_%\_selected' escape '\'
  ),
  4::bigint,
  'daily analytics distinguish manual, AI text, AI voice, and receipt exploration'
);
select is(
  (
    select sum(sessions)
    from private.analytics_daily
    where event_name like 'expense\_input\_%\_selected' escape '\'
  ),
  4::numeric,
  'each tab-selection event retains anonymous session counts'
);
select is(
  (
    select count(*)
    from private.analytics_events
    where event_name like 'expense\_input\_%\_selected' escape '\'
      and currency is null
      and locale = 'en'
  ),
  4::bigint,
  'tab exploration stores no expense or currency metadata'
);

create temporary table analytics_count_before_invalid as
select count(*) as event_count
from private.analytics_events;

create temporary table analytics_rate_before_invalid as
select request_count
from private.shared_activity_rate_limits
where identifier_hash = private.shared_activity_request_identifier()
  and operation = 'analytics';

select lives_ok(
  $$select public.record_analytics_event('expense_with_amount_42', 'local', '0123456789abcdef0123456789abcdef')$$,
  'unapproved event names are rejected without rolling back the throttle'
);
select lives_ok(
  $$select public.record_analytics_event('expense_added', 'private_activity_ABC123', '0123456789abcdef0123456789abcdef')$$,
  'unapproved surfaces are rejected without rolling back the throttle'
);
select lives_ok(
  $$select public.record_analytics_event('expense_added', 'live', 'secret-live-capability')$$,
  'non-session identifiers are rejected without rolling back the throttle'
);
select lives_ok(
  $$select public.record_analytics_event('expense_added', 'live', '0123456789abcdef0123456789abcdef', 'en-US')$$,
  'unapproved locales are rejected without rolling back the throttle'
);
select lives_ok(
  $$select public.record_analytics_event('currency_selected', 'local', '0123456789abcdef0123456789abcdef', 'en', 'BTC')$$,
  'unsupported currencies are rejected without rolling back the throttle'
);
select lives_ok(
  $$select public.record_analytics_event('expense_added', 'local', '0123456789abcdef0123456789abcdef', 'en', 'USD')$$,
  'currency metadata is rejected for unrelated events without rolling back the throttle'
);
select is(
  (select count(*) from private.analytics_events),
  (select event_count from analytics_count_before_invalid),
  'invalid analytics input never writes an event'
);
select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where identifier_hash = private.shared_activity_request_identifier()
      and operation = 'analytics'
  ),
  (select request_count + 6 from analytics_rate_before_invalid),
  'every invalid analytics request consumes rate-limit budget'
);
select is(
  current_setting('response.status', true),
  '400',
  'invalid analytics input preserves the bad-request HTTP status'
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
select is(
  (
    select events
    from private.analytics_currency_daily
    where currency = 'CNY' and surface = 'local'
  ),
  1::bigint,
  'currency aggregates count approved selection events'
);
select is(
  (
    select sessions
    from private.analytics_currency_daily
    where currency = 'CNY' and surface = 'local'
  ),
  1::bigint,
  'currency aggregates count anonymous selection sessions'
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
      and identifier_hash = private.shared_activity_request_identifier()
  ),
  32,
  'analytics throttling stores only a fixed-length pseudonymous identifier'
);
select isnt(
  private.shared_activity_request_identifier(),
  extensions.digest('203.0.113.20', 'sha256'),
  'analytics request identifiers are protected with the database-secret pepper'
);

select * from finish();
rollback;
