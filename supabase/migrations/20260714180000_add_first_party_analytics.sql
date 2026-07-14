alter table private.shared_activity_rate_limits
  drop constraint shared_activity_rate_limits_operation_check;

alter table private.shared_activity_rate_limits
  add constraint shared_activity_rate_limits_operation_check
  check (operation in ('create', 'load', 'update', 'analytics'));

create or replace function private.enforce_shared_activity_rate_limit(
  p_operation text,
  p_limit integer,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  identifier bytea := private.shared_activity_request_identifier();
  request_time timestamptz := clock_timestamp();
  current_count integer;
begin
  if p_operation not in ('create', 'load', 'update', 'analytics')
    or p_limit < 1
    or p_window <= interval '0 seconds' then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_configuration';
  end if;

  insert into private.shared_activity_rate_limits (
    identifier_hash,
    operation,
    window_started_at,
    request_count
  ) values (
    identifier,
    p_operation,
    request_time,
    1
  )
  on conflict (identifier_hash, operation) do update
  set window_started_at = case
        when private.shared_activity_rate_limits.window_started_at <= request_time - p_window then request_time
        else private.shared_activity_rate_limits.window_started_at
      end,
      request_count = case
        when private.shared_activity_rate_limits.window_started_at <= request_time - p_window then 1
        else private.shared_activity_rate_limits.request_count + 1
      end
  returning request_count into current_count;

  if current_count > p_limit then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'rate_limit_exceeded',
        'message', 'Too many requests. Try again later.',
        'details', null,
        'hint', null
      )::text,
      detail = json_build_object(
        'status', 429,
        'status_text', 'Too Many Requests',
        'headers', json_build_object(
          'Retry-After', ceil(extract(epoch from p_window))::integer::text
        )
      )::text;
  end if;
end;
$$;

create table private.analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null check (event_name in (
    'app_opened',
    'activity_created',
    'expense_added',
    'live_activity_created',
    'live_activity_opened',
    'settlement_recorded'
  )),
  surface text not null check (surface in ('local', 'live', 'snapshot')),
  session_hash bytea not null check (octet_length(session_hash) = 32),
  occurred_at timestamptz not null default clock_timestamp()
);

create index analytics_events_event_occurred_at_idx
  on private.analytics_events (event_name, occurred_at);

create index analytics_events_session_occurred_at_idx
  on private.analytics_events (session_hash, occurred_at);

create index analytics_events_occurred_at_idx
  on private.analytics_events (occurred_at);

alter table private.analytics_events enable row level security;
revoke all on table private.analytics_events from public, anon, authenticated;
revoke all on sequence private.analytics_events_id_seq from public, anon, authenticated;

create view private.analytics_daily
with (security_invoker = true)
as
select
  (occurred_at at time zone 'utc')::date as event_day,
  event_name,
  surface,
  count(*)::bigint as events,
  count(distinct session_hash)::bigint as sessions
from private.analytics_events
group by (occurred_at at time zone 'utc')::date, event_name, surface;

revoke all on table private.analytics_daily from public, anon, authenticated;

create or replace function private.record_analytics_event(
  p_event_name text,
  p_surface text,
  p_session_token text
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

  insert into private.analytics_events (event_name, surface, session_hash)
  values (
    p_event_name,
    p_surface,
    extensions.digest(p_session_token, 'sha256')
  );
end;
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
  select private.record_analytics_event(p_event_name, p_surface, p_session_token);
$$;

revoke all on function private.record_analytics_event(text, text, text) from public, anon, authenticated;
revoke all on function public.record_analytics_event(text, text, text) from public;
grant execute on function public.record_analytics_event(text, text, text) to anon, authenticated;
