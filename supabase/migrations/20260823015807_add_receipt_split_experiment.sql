-- Separate quota lane for receipt-photo parsing. Receipt scans are deliberately
-- stricter than text or voice because every accepted request invokes a vision
-- model with an uploaded image.

alter table private.ai_expense_budget_limits
  drop constraint ai_expense_budget_limits_input_mode_check;
alter table private.ai_expense_budget_limits
  add constraint ai_expense_budget_limits_input_mode_check
  check (input_mode in ('text', 'voice', 'receipt'));

insert into private.ai_expense_budget_limits (input_mode, daily_limit)
values ('receipt', 200)
on conflict (input_mode) do nothing;

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
    'ai-expense-voice-daily',
    'ai-expense-receipt',
    'ai-expense-receipt-daily',
    'ai-expense-global-daily',
    'ai-expense-voice-global-daily',
    'ai-expense-receipt-global-daily',
    'feedback',
    'feedback-daily'
  ));

create or replace function private.consume_ai_expense_quota_v2(
  p_identifier text,
  p_input_mode text default 'text'
)
returns text
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  identifier_pepper bytea;
  hashed_identifier bytea;
  global_identifier bytea;
  request_time timestamptz := clock_timestamp();
  burst_operation text;
  daily_operation text;
  global_operation text;
  burst_limit integer;
  client_daily_limit integer;
  project_daily_limit integer;
  project_enabled boolean;
  burst_count integer;
  daily_count integer;
  global_count integer;
begin
  if p_identifier is null
    or length(btrim(p_identifier)) < 1
    or length(p_identifier) > 200
    or p_input_mode not in ('text', 'voice', 'receipt') then
    return 'invalid_request';
  end if;

  if p_input_mode = 'voice' then
    burst_operation := 'ai-expense-voice';
    daily_operation := 'ai-expense-voice-daily';
    global_operation := 'ai-expense-voice-global-daily';
    burst_limit := 10;
    client_daily_limit := 25;
  elsif p_input_mode = 'receipt' then
    burst_operation := 'ai-expense-receipt';
    daily_operation := 'ai-expense-receipt-daily';
    global_operation := 'ai-expense-receipt-global-daily';
    burst_limit := 3;
    client_daily_limit := 10;
  else
    burst_operation := 'ai-expense';
    daily_operation := 'ai-expense-daily';
    global_operation := 'ai-expense-global-daily';
    burst_limit := 30;
    client_daily_limit := 100;
  end if;

  select secret
  into identifier_pepper
  from private.security_secrets
  where name = 'request_identifier_pepper';

  if identifier_pepper is null then
    raise exception using errcode = '55000', message = 'request_identifier_pepper_missing';
  end if;

  select daily_limit, enabled
  into project_daily_limit, project_enabled
  from private.ai_expense_budget_limits
  where input_mode = p_input_mode;

  if not found or not project_enabled then
    return 'global_limit';
  end if;

  hashed_identifier := extensions.hmac(
    convert_to(btrim(p_identifier), 'UTF8'),
    identifier_pepper,
    'sha256'
  );
  global_identifier := extensions.hmac(
    convert_to('tally-global-ai-budget:' || p_input_mode, 'UTF8'),
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

  if burst_count > burst_limit or daily_count > client_daily_limit then
    return 'client_limit';
  end if;

  insert into private.shared_activity_rate_limits (
    identifier_hash,
    operation,
    window_started_at,
    request_count
  ) values (
    global_identifier,
    global_operation,
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
  returning request_count into global_count;

  if global_count > project_daily_limit then
    return 'global_limit';
  end if;
  return 'allowed';
end;
$$;

comment on function public.consume_ai_expense_quota_v2(text, text) is
  'Consumes private per-client and project-wide AI quota for text, voice, or receipt entry.';

alter table private.analytics_events
  drop constraint analytics_events_event_name_check;
alter table private.analytics_events
  add constraint analytics_events_event_name_check
  check (event_name in (
    'app_opened',
    'activity_created',
    'friend_added',
    'expense_added',
    'feedback_submitted',
    'summary_export_clicked',
    'live_share_clicked',
    'live_activity_created',
    'live_activity_opened',
    'settlement_recorded',
    'currency_selected',
    'expense_input_manual_selected',
    'expense_input_ai_text_selected',
    'expense_input_ai_voice_selected',
    'expense_input_receipt_selected',
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
  ));

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
    'friend_added',
    'expense_added',
    'feedback_submitted',
    'summary_export_clicked',
    'live_share_clicked',
    'live_activity_created',
    'live_activity_opened',
    'settlement_recorded',
    'currency_selected',
    'expense_input_manual_selected',
    'expense_input_ai_text_selected',
    'expense_input_ai_voice_selected',
    'expense_input_receipt_selected',
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
  )
    or p_surface is null
    or p_surface not in ('local', 'live', 'snapshot')
    or p_session_token is null
    or p_session_token !~ '^[a-f0-9]{32}$'
    or p_locale is null
    or p_locale not in ('en', 'zh-CN', 'unknown')
    or (
      p_event_name = 'currency_selected'
      and (
        p_currency is null
        or p_currency not in (
          'USD', 'EUR', 'GBP', 'CNY', 'JPY',
          'CAD', 'AUD', 'HKD', 'SGD', 'KRW',
          'INR', 'CHF', 'NZD', 'TWD', 'THB'
        )
      )
    )
    or (p_event_name <> 'currency_selected' and p_currency is not null) then
    perform private.set_anonymous_rpc_status(400);
    return;
  end if;

  perform private.enforce_public_api_project_budget('analytics_events', 1);

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

revoke all on function private.record_analytics_event(text, text, text, text, text)
  from public, anon, authenticated, service_role;

comment on constraint analytics_events_event_name_check on private.analytics_events is
  'Allowlisted anonymous product outcomes, including preview receipt entry usage without receipt content.';
