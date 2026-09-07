-- Operational telemetry, separate from product analytics so usage counts stay unchanged.
create table private.receipt_client_diagnostics (
  request_id uuid primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  outcome text not null check (outcome in (
    'success', 'timeout', 'network', 'invalid-input', 'rate-limit', 'credits',
    'model-unavailable', 'invalid-response', 'unavailable', 'configuration'
  )),
  elapsed_ms integer not null check (elapsed_ms between 0 and 3600000),
  http_status integer check (http_status between 100 and 599)
);
create index receipt_client_diagnostics_time_idx on private.receipt_client_diagnostics(occurred_at);
alter table private.receipt_client_diagnostics enable row level security;
revoke all on private.receipt_client_diagnostics from public, anon, authenticated, service_role;

create function private.record_receipt_client_diagnostic(
  p_request_id uuid, p_outcome text, p_elapsed_ms integer, p_status integer
)
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
begin
  perform private.enforce_shared_activity_rate_limit('analytics', 300, interval '5 minutes');
  if p_request_id is null
    or p_request_id::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    or p_outcome is null or p_outcome not in (
      'success', 'timeout', 'network', 'invalid-input', 'rate-limit', 'credits',
      'model-unavailable', 'invalid-response', 'unavailable', 'configuration'
    )
    or p_elapsed_ms is null or p_elapsed_ms not between 0 and 3600000
    or (p_status is not null and p_status not between 100 and 599) then
    perform private.set_anonymous_rpc_status(400);
    return;
  end if;
  perform private.enforce_public_api_project_budget('analytics_events', 1);
  delete from private.receipt_client_diagnostics where request_id in (
    select request_id from private.receipt_client_diagnostics
    where occurred_at < clock_timestamp() - interval '14 days'
    order by occurred_at limit 500
  );
  insert into private.receipt_client_diagnostics(request_id, outcome, elapsed_ms, http_status)
    values (p_request_id, p_outcome, p_elapsed_ms, p_status)
    on conflict (request_id) do nothing;
end;
$$;
create function public.record_receipt_client_diagnostic(
  p_request_id uuid, p_outcome text, p_elapsed_ms integer, p_status integer
)
returns void
language sql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select private.record_receipt_client_diagnostic(p_request_id, p_outcome, p_elapsed_ms, p_status);
$$;
revoke all on function private.record_receipt_client_diagnostic(uuid,text,integer,integer) from public, anon, authenticated, service_role;
revoke all on function public.record_receipt_client_diagnostic(uuid,text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.record_receipt_client_diagnostic(uuid,text,integer,integer) to anon, authenticated;
comment on table private.receipt_client_diagnostics is
  'Untrusted client-reported receipt outcomes. No receipt content or identity. Correlate request_id with Edge Function logs. Opportunistic 14-day retention.';
