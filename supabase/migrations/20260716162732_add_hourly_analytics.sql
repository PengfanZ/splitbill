create view private.analytics_hourly
with (security_invoker = true)
as
select
  date_trunc('hour', occurred_at at time zone 'UTC') at time zone 'UTC' as event_hour,
  event_name,
  surface,
  count(*)::bigint as events,
  count(distinct session_hash)::bigint as sessions
from private.analytics_events
group by
  date_trunc('hour', occurred_at at time zone 'UTC') at time zone 'UTC',
  event_name,
  surface;

revoke all on table private.analytics_hourly from public, anon, authenticated;

comment on view private.analytics_hourly is
  'Anonymous product events aggregated into UTC hour buckets by event and surface.';
