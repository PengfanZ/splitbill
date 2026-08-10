-- Keep future browser-facing database functions fail closed, and bound the
-- project-wide storage impact of anonymous live creation and analytics.

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;

create table private.public_api_budget_limits (
  operation text primary key check (operation in ('create_bytes', 'analytics_events')),
  daily_limit bigint not null check (daily_limit between 1 and 1000000000),
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);

create table private.public_api_budget_usage (
  operation text primary key references private.public_api_budget_limits(operation) on delete cascade,
  window_started_at timestamptz not null,
  used_units bigint not null check (used_units > 0)
);

alter table private.public_api_budget_limits enable row level security;
alter table private.public_api_budget_usage enable row level security;
revoke all on table private.public_api_budget_limits, private.public_api_budget_usage
  from public, anon, authenticated, service_role;

-- Five MiB of validated live snapshots and 5,000 validated product events per
-- rolling day are generous for current traffic while providing a firm circuit
-- breaker. These values can be raised without a deployment if usage grows.
insert into private.public_api_budget_limits (operation, daily_limit)
values
  ('create_bytes', 5 * 1024 * 1024),
  ('analytics_events', 5000);

create function private.enforce_public_api_project_budget(
  p_operation text,
  p_units bigint
)
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  request_time timestamptz := clock_timestamp();
  configured_limit bigint;
  budget_enabled boolean;
  current_units bigint;
begin
  if p_operation not in ('create_bytes', 'analytics_events')
    or p_units is null
    or p_units < 1
    or p_units > 1000000000 then
    raise exception using errcode = '22023', message = 'invalid_project_budget_configuration';
  end if;

  select daily_limit, enabled
  into configured_limit, budget_enabled
  from private.public_api_budget_limits
  where operation = p_operation;

  if not found or not budget_enabled or p_units > configured_limit then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'project_rate_limit_exceeded',
        'message', 'This project is temporarily at capacity. Try again later.',
        'details', null,
        'hint', null
      )::text,
      detail = json_build_object(
        'status', 429,
        'status_text', 'Too Many Requests',
        'headers', json_build_object('Retry-After', '86400')
      )::text;
  end if;

  insert into private.public_api_budget_usage (
    operation,
    window_started_at,
    used_units
  ) values (
    p_operation,
    request_time,
    p_units
  )
  on conflict (operation) do update
  set window_started_at = case
        when private.public_api_budget_usage.window_started_at <= request_time - interval '1 day'
          then request_time
        else private.public_api_budget_usage.window_started_at
      end,
      used_units = case
        when private.public_api_budget_usage.window_started_at <= request_time - interval '1 day'
          then p_units
        else least(private.public_api_budget_usage.used_units + p_units, 2000000000::bigint)
      end
  returning used_units into current_units;

  if current_units > configured_limit then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'project_rate_limit_exceeded',
        'message', 'This project is temporarily at capacity. Try again later.',
        'details', null,
        'hint', null
      )::text,
      detail = json_build_object(
        'status', 429,
        'status_text', 'Too Many Requests',
        'headers', json_build_object('Retry-After', '86400')
      )::text;
  end if;
end;
$$;

revoke all on function private.enforce_public_api_project_budget(text, bigint)
  from public, anon, authenticated, service_role;

create or replace function private.create_shared_activity(p_snapshot jsonb)
returns table (
  code text,
  edit_token text,
  revision bigint,
  snapshot jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  generated_code text;
  generated_token text;
begin
  perform private.enforce_shared_activity_rate_limit('create', 10, interval '1 hour');

  if not coalesce(private.is_valid_activity_snapshot(p_snapshot), false) then
    perform private.set_anonymous_rpc_status(400);
    return;
  end if;

  -- Charge only validated input so malformed anonymous traffic cannot exhaust
  -- the shared project circuit breaker.
  perform private.enforce_public_api_project_budget(
    'create_bytes',
    pg_column_size(p_snapshot)::bigint
  );

  delete from private.shared_activities
  where id in (
    select id
    from private.shared_activities
    where expires_at <= clock_timestamp()
    order by expires_at
    limit 100
  );
  delete from private.shared_activity_rate_limits
  where (identifier_hash, operation) in (
    select identifier_hash, operation
    from private.shared_activity_rate_limits
    where window_started_at < clock_timestamp() - interval '1 day'
    limit 500
  );

  for attempt in 1..5 loop
    generated_code := upper(encode(extensions.gen_random_bytes(5), 'hex'));
    generated_token := encode(extensions.gen_random_bytes(32), 'hex');
    begin
      return query
      insert into private.shared_activities (code, edit_token_hash, snapshot)
      values (generated_code, extensions.digest(generated_token, 'sha256'), p_snapshot)
      returning private.shared_activities.code,
        generated_token,
        private.shared_activities.revision,
        private.shared_activities.snapshot,
        private.shared_activities.updated_at;
      return;
    exception when unique_violation then
      -- A 40-bit code collision is unlikely; generate another capability code.
    end;
  end loop;

  raise exception using errcode = '54000', message = 'activity_code_generation_failed';
end;
$$;

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
    'summary_export_clicked',
    'live_share_clicked',
    'live_activity_created',
    'live_activity_opened',
    'settlement_recorded',
    'currency_selected',
    'ai_text_requested',
    'ai_text_ready',
    'ai_text_clarification',
    'ai_text_failed',
    'ai_voice_requested',
    'ai_voice_ready',
    'ai_voice_clarification',
    'ai_voice_failed'
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

  -- Invalid telemetry remains constrained by the client rate limit above, but
  -- cannot consume the project-wide budget or poison analytics storage.
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

revoke all on function private.create_shared_activity(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.record_analytics_event(text, text, text, text, text)
  from public, anon, authenticated, service_role;

comment on table private.public_api_budget_limits is
  'Server-only rolling daily circuit breakers for anonymous live storage and analytics.';
comment on table private.public_api_budget_usage is
  'Project-wide rolling usage counters; contains no client identifiers or activity data.';
comment on function private.enforce_public_api_project_budget(text, bigint) is
  'Atomically consumes validated project capacity and returns HTTP 429 when exhausted.';
