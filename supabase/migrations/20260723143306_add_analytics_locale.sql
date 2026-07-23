alter table private.analytics_events
  add column locale text not null default 'unknown'
  check (locale in ('en', 'zh-CN', 'unknown'));

alter table private.analytics_events
  alter column locale drop default;

create or replace function private.record_analytics_event(
  p_event_name text,
  p_surface text,
  p_session_token text,
  p_locale text
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
    'settlement_recorded'
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

  insert into private.analytics_events (event_name, surface, session_hash, locale)
  values (
    p_event_name,
    p_surface,
    extensions.digest(p_session_token, 'sha256'),
    p_locale
  );
end;
$$;

create or replace function private.record_analytics_event(
  p_event_name text,
  p_surface text,
  p_session_token text
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
    'unknown'
  );
$$;

create or replace function public.record_analytics_event(
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
    p_locale
  );
$$;

create or replace function public.record_analytics_event(
  p_event_name text,
  p_surface text,
  p_session_token text
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
    'unknown'
  );
$$;

revoke all on function private.record_analytics_event(text, text, text, text)
  from public, anon, authenticated;
revoke all on function private.record_analytics_event(text, text, text)
  from public, anon, authenticated;
revoke all on function public.record_analytics_event(text, text, text, text)
  from public;
revoke all on function public.record_analytics_event(text, text, text)
  from public;
grant execute on function public.record_analytics_event(text, text, text, text)
  to anon, authenticated;
grant execute on function public.record_analytics_event(text, text, text)
  to anon, authenticated;

create view private.analytics_locale_daily
with (security_invoker = true)
as
select
  (occurred_at at time zone 'utc')::date as event_day,
  locale,
  event_name,
  surface,
  count(*)::bigint as events,
  count(distinct session_hash)::bigint as sessions
from private.analytics_events
group by
  (occurred_at at time zone 'utc')::date,
  locale,
  event_name,
  surface;

revoke all on table private.analytics_locale_daily
  from public, anon, authenticated;

comment on column private.analytics_events.locale is
  'Resolved Tally UI locale. Unknown identifies events from clients predating locale analytics.';

comment on view private.analytics_locale_daily is
  'Anonymous product events aggregated into UTC day buckets by locale, event, and surface.';
