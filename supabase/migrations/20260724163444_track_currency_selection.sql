alter table private.analytics_events
  drop constraint analytics_events_event_name_check;

alter table private.analytics_events
  add column currency text,
  add constraint analytics_events_event_name_check
    check (event_name in (
      'app_opened',
      'activity_created',
      'expense_added',
      'live_activity_created',
      'live_activity_opened',
      'settlement_recorded',
      'currency_selected'
    )),
  add constraint analytics_events_currency_code_check
    check (
      currency is null
      or currency in (
        'USD', 'EUR', 'GBP', 'CNY', 'JPY',
        'CAD', 'AUD', 'HKD', 'SGD', 'KRW',
        'INR', 'CHF', 'NZD', 'TWD', 'THB'
      )
    ),
  add constraint analytics_events_currency_event_check
    check ((event_name = 'currency_selected') = (currency is not null));

create or replace function private.record_analytics_event(
  p_event_name text,
  p_surface text,
  p_session_token text,
  p_locale text,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
begin
  perform private.enforce_shared_activity_rate_limit('analytics', 300, interval '5 minutes');

  if p_event_name is null or p_event_name not in (
    'app_opened',
    'activity_created',
    'expense_added',
    'live_activity_created',
    'live_activity_opened',
    'settlement_recorded',
    'currency_selected'
  ) then
    raise exception using errcode = '22023', message = 'invalid_analytics_event';
  end if;
  if p_surface is null or p_surface not in ('local', 'live', 'snapshot') then
    raise exception using errcode = '22023', message = 'invalid_analytics_surface';
  end if;
  if p_session_token is null or p_session_token !~ '^[a-f0-9]{32}$' then
    raise exception using errcode = '22023', message = 'invalid_analytics_session';
  end if;
  if p_locale is null or p_locale not in ('en', 'zh-CN', 'unknown') then
    raise exception using errcode = '22023', message = 'invalid_analytics_locale';
  end if;
  if (
    (p_event_name = 'currency_selected' and (
      p_currency is null
      or p_currency not in (
        'USD', 'EUR', 'GBP', 'CNY', 'JPY',
        'CAD', 'AUD', 'HKD', 'SGD', 'KRW',
        'INR', 'CHF', 'NZD', 'TWD', 'THB'
      )
    ))
    or (p_event_name <> 'currency_selected' and p_currency is not null)
  ) then
    raise exception using errcode = '22023', message = 'invalid_analytics_currency';
  end if;

  if p_event_name = 'app_opened' then
    delete from private.analytics_events
    where id in (
      select id
      from private.analytics_events
      where occurred_at < clock_timestamp() - interval '90 days'
      order by occurred_at
      limit 500
    );
  end if;

  insert into private.analytics_events (
    event_name,
    surface,
    session_hash,
    locale,
    currency
  )
  values (
    p_event_name,
    p_surface,
    extensions.digest(p_session_token, 'sha256'),
    p_locale,
    p_currency
  );
end;
$$;

create or replace function private.record_analytics_event(
  p_event_name text,
  p_surface text,
  p_session_token text,
  p_locale text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.record_analytics_event(
    p_event_name,
    p_surface,
    p_session_token,
    p_locale,
    null
  );
$$;

create or replace function public.record_analytics_event(
  p_event_name text,
  p_surface text,
  p_session_token text,
  p_locale text,
  p_currency text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.record_analytics_event(
    p_event_name,
    p_surface,
    p_session_token,
    p_locale,
    p_currency
  );
$$;

revoke all on function private.record_analytics_event(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function private.record_analytics_event(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.record_analytics_event(text, text, text, text, text)
  from public;
grant execute on function public.record_analytics_event(text, text, text, text, text)
  to anon, authenticated;

create view private.analytics_currency_daily
with (security_invoker = true)
as
select
  (occurred_at at time zone 'utc')::date as event_day,
  currency,
  surface,
  count(*)::bigint as events,
  count(distinct session_hash)::bigint as sessions
from private.analytics_events
where event_name = 'currency_selected'
group by
  (occurred_at at time zone 'utc')::date,
  currency,
  surface;

revoke all on table private.analytics_currency_daily
  from public, anon, authenticated;

comment on column private.analytics_events.currency is
  'Allowlisted activity currency for currency_selected events; null for every other event.';

comment on view private.analytics_currency_daily is
  'Anonymous currency-selector interactions aggregated into UTC day buckets by currency and surface.';
