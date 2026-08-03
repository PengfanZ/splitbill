-- Give the higher-cost voice path its own tighter burst and daily budgets.
-- The text defaults preserve compatibility with already-deployed clients.

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
      'ai-expense-daily',
      'ai-expense-voice',
      'ai-expense-voice-daily'
    ));

drop function public.consume_ai_expense_quota(text);

create function public.consume_ai_expense_quota(
  p_identifier text,
  p_input_mode text default 'text'
)
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
  burst_operation text;
  daily_operation text;
  burst_limit integer;
  daily_limit integer;
  burst_count integer;
  daily_count integer;
begin
  if p_identifier is null
    or length(btrim(p_identifier)) < 1
    or length(p_identifier) > 200
    or p_input_mode not in ('text', 'voice') then
    return false;
  end if;

  if p_input_mode = 'voice' then
    burst_operation := 'ai-expense-voice';
    daily_operation := 'ai-expense-voice-daily';
    burst_limit := 10;
    daily_limit := 25;
  else
    burst_operation := 'ai-expense';
    daily_operation := 'ai-expense-daily';
    burst_limit := 30;
    daily_limit := 100;
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
    burst_operation,
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
    daily_operation,
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

  return burst_count <= burst_limit and daily_count <= daily_limit;
end;
$$;

revoke all on function public.consume_ai_expense_quota(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_ai_expense_quota(text, text)
  to service_role;

comment on function public.consume_ai_expense_quota(text, text) is
  'Consumes server-only AI quotas for text (30/10 minutes, 100/day) or voice (10/10 minutes, 25/day) using a peppered identifier.';
