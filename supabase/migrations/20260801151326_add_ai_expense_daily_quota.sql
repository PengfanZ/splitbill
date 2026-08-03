-- Keep the short abuse-control window and add a separate daily cost ceiling.
-- Both counters use the same peppered network identifier and are updated in
-- one transaction before any OpenRouter request is made.

alter table private.shared_activity_rate_limits
  drop constraint shared_activity_rate_limits_operation_check;

alter table private.shared_activity_rate_limits
  add constraint shared_activity_rate_limits_operation_check
    check (operation in (
      'create',
      'load',
      'update',
      'analytics',
      'ai-expense',
      'ai-expense-daily'
    ));

create or replace function public.consume_ai_expense_quota(p_identifier text)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  identifier_pepper bytea;
  hashed_identifier bytea;
  request_time timestamptz := clock_timestamp();
  burst_count integer;
  daily_count integer;
begin
  if p_identifier is null
    or length(btrim(p_identifier)) < 1
    or length(p_identifier) > 200 then
    return false;
  end if;

  select secret
  into identifier_pepper
  from private.security_secrets
  where name = 'request_identifier_pepper';

  if identifier_pepper is null then
    raise exception using errcode = '55000', message = 'request_identifier_pepper_missing';
  end if;

  hashed_identifier := extensions.hmac(
    convert_to(btrim(p_identifier), 'UTF8'),
    identifier_pepper,
    'sha256'
  );

  insert into private.shared_activity_rate_limits (
    identifier_hash,
    operation,
    window_started_at,
    request_count
  ) values (
    hashed_identifier,
    'ai-expense',
    request_time,
    1
  )
  on conflict (identifier_hash, operation) do update
  set window_started_at = case
        when private.shared_activity_rate_limits.window_started_at <= request_time - interval '10 minutes' then request_time
        else private.shared_activity_rate_limits.window_started_at
      end,
      request_count = case
        when private.shared_activity_rate_limits.window_started_at <= request_time - interval '10 minutes' then 1
        else least(private.shared_activity_rate_limits.request_count + 1, 1000000)
      end
  returning request_count into burst_count;

  insert into private.shared_activity_rate_limits (
    identifier_hash,
    operation,
    window_started_at,
    request_count
  ) values (
    hashed_identifier,
    'ai-expense-daily',
    request_time,
    1
  )
  on conflict (identifier_hash, operation) do update
  set window_started_at = case
        when private.shared_activity_rate_limits.window_started_at <= request_time - interval '1 day' then request_time
        else private.shared_activity_rate_limits.window_started_at
      end,
      request_count = case
        when private.shared_activity_rate_limits.window_started_at <= request_time - interval '1 day' then 1
        else least(private.shared_activity_rate_limits.request_count + 1, 1000000)
      end
  returning request_count into daily_count;

  return burst_count <= 30 and daily_count <= 100;
end;
$$;

revoke all on function public.consume_ai_expense_quota(text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_ai_expense_quota(text)
  to service_role;

comment on function public.consume_ai_expense_quota(text) is
  'Consumes server-only AI preview quotas of 30 requests per 10 minutes and 100 requests per day for a peppered identifier.';
