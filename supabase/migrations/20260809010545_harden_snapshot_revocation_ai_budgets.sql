-- Keep the browser and database representations of a Live activity in sync.
-- The previous database predicate only checked shallow JSON shape, which meant
-- a holder of a valid edit capability could store a snapshot that every Tally
-- client would reject when loading it.

create or replace function private.is_valid_activity_timestamp(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  date_year integer;
  date_month integer;
  date_day integer;
  time_hour integer;
  time_minute integer;
  time_second numeric;
  offset_value text;
  offset_hour integer;
  offset_minute integer;
begin
  if length(p_value) not between 1 and 120
    or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return false;
  end if;

  date_year := substring(p_value from 1 for 4)::integer;
  date_month := substring(p_value from 6 for 2)::integer;
  date_day := substring(p_value from 9 for 2)::integer;
  time_hour := substring(p_value from 12 for 2)::integer;
  time_minute := substring(p_value from 15 for 2)::integer;
  time_second := substring(p_value from 18 for 2)::numeric;
  perform pg_catalog.make_date(date_year, date_month, date_day);

  if time_hour > 23 or time_minute > 59 or time_second >= 60 then
    return false;
  end if;

  if right(p_value, 1) <> 'Z' then
    offset_value := right(p_value, 6);
    offset_hour := substring(offset_value from 2 for 2)::integer;
    offset_minute := substring(offset_value from 5 for 2)::integer;
    if offset_hour > 14 or offset_minute > 59 or (offset_hour = 14 and offset_minute <> 0) then
      return false;
    end if;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function private.is_valid_activity_snapshot(p_snapshot jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  sender_data jsonb;
  group_data jsonb;
  friend_data jsonb;
  expense_data jsonb;
  member_value jsonb;
  share_entry record;
  member_id text;
  expense_id text;
  settlement_recipient_id text;
  member_ids text[] := array[]::text[];
  group_member_ids text[] := array[]::text[];
  expense_ids text[] := array[]::text[];
  expense_amount numeric;
  share_amount numeric;
  share_total numeric;
  share_count integer;
begin
  if p_snapshot is null
    or jsonb_typeof(p_snapshot) <> 'object'
    or octet_length(p_snapshot::text) > 131072
    or jsonb_typeof(p_snapshot -> 'version') <> 'number'
    or p_snapshot -> 'version' <> '2'::jsonb then
    return false;
  end if;

  sender_data := p_snapshot -> 'sender';
  if jsonb_typeof(sender_data) <> 'object'
    or jsonb_typeof(sender_data -> 'id') <> 'string'
    or sender_data ->> 'id' <> 'me'
    or jsonb_typeof(sender_data -> 'name') <> 'string'
    or length(sender_data ->> 'name') not between 1 and 120
    or jsonb_typeof(sender_data -> 'initials') <> 'string'
    or length(sender_data ->> 'initials') not between 1 and 12
    or jsonb_typeof(sender_data -> 'color') <> 'string'
    or length(sender_data ->> 'color') not between 1 and 32 then
    return false;
  end if;
  member_ids := array['me'];

  if jsonb_typeof(p_snapshot -> 'friends') <> 'array'
    or jsonb_array_length(p_snapshot -> 'friends') > 100 then
    return false;
  end if;

  for friend_data in
    select value from jsonb_array_elements(p_snapshot -> 'friends')
  loop
    if jsonb_typeof(friend_data) <> 'object'
      or jsonb_typeof(friend_data -> 'id') <> 'string'
      or length(friend_data ->> 'id') not between 1 and 120
      or jsonb_typeof(friend_data -> 'name') <> 'string'
      or length(friend_data ->> 'name') not between 1 and 120
      or jsonb_typeof(friend_data -> 'initials') <> 'string'
      or length(friend_data ->> 'initials') not between 1 and 12
      or jsonb_typeof(friend_data -> 'color') <> 'string'
      or length(friend_data ->> 'color') not between 1 and 32 then
      return false;
    end if;

    member_id := friend_data ->> 'id';
    if member_id = any(member_ids) then
      return false;
    end if;
    member_ids := array_append(member_ids, member_id);
  end loop;

  group_data := p_snapshot -> 'group';
  if jsonb_typeof(group_data) <> 'object'
    or jsonb_typeof(group_data -> 'id') <> 'string'
    or length(group_data ->> 'id') not between 1 and 120
    or jsonb_typeof(group_data -> 'name') <> 'string'
    or length(group_data ->> 'name') not between 1 and 120
    or jsonb_typeof(group_data -> 'emoji') <> 'string'
    or length(group_data ->> 'emoji') not between 1 and 16
    or jsonb_typeof(group_data -> 'memberIds') <> 'array'
    or jsonb_array_length(group_data -> 'memberIds') not between 1 and 101
    or (
      group_data ? 'currency'
      and (
        jsonb_typeof(group_data -> 'currency') <> 'string'
        or group_data ->> 'currency' not in (
          'USD', 'EUR', 'GBP', 'CNY', 'JPY',
          'CAD', 'AUD', 'HKD', 'SGD', 'KRW',
          'INR', 'CHF', 'NZD', 'TWD', 'THB'
        )
      )
    ) then
    return false;
  end if;

  for member_value in
    select value from jsonb_array_elements(group_data -> 'memberIds')
  loop
    if jsonb_typeof(member_value) <> 'string'
      or length(member_value #>> '{}') not between 1 and 120 then
      return false;
    end if;

    member_id := member_value #>> '{}';
    if member_id = any(group_member_ids)
      or not (member_id = any(member_ids)) then
      return false;
    end if;
    group_member_ids := array_append(group_member_ids, member_id);
  end loop;

  -- A snapshot contains only members participating in this activity. Requiring
  -- both sets to match prevents hidden or ambiguous participant references.
  if cardinality(group_member_ids) <> cardinality(member_ids)
    or not ('me' = any(group_member_ids)) then
    return false;
  end if;

  if jsonb_typeof(p_snapshot -> 'expenses') <> 'array'
    or jsonb_array_length(p_snapshot -> 'expenses') > 1000 then
    return false;
  end if;

  for expense_data in
    select value from jsonb_array_elements(p_snapshot -> 'expenses')
  loop
    if jsonb_typeof(expense_data) <> 'object'
      or jsonb_typeof(expense_data -> 'id') <> 'string'
      or length(expense_data ->> 'id') not between 1 and 120
      or jsonb_typeof(expense_data -> 'groupId') <> 'string'
      or expense_data ->> 'groupId' <> group_data ->> 'id'
      or jsonb_typeof(expense_data -> 'title') <> 'string'
      or length(expense_data ->> 'title') not between 1 and 200
      or jsonb_typeof(expense_data -> 'amount') <> 'number'
      or jsonb_typeof(expense_data -> 'payerId') <> 'string'
      or not ((expense_data ->> 'payerId') = any(group_member_ids))
      or jsonb_typeof(expense_data -> 'splitMethod') <> 'string'
      or expense_data ->> 'splitMethod' not in ('equal', 'exact')
      or jsonb_typeof(expense_data -> 'shares') <> 'object'
      or jsonb_typeof(expense_data -> 'createdAt') <> 'string'
      or length(expense_data ->> 'createdAt') not between 1 and 120
      or not private.is_valid_activity_timestamp(expense_data ->> 'createdAt')
      or (
        expense_data ? 'updatedAt'
        and (
          jsonb_typeof(expense_data -> 'updatedAt') <> 'string'
          or not private.is_valid_activity_timestamp(expense_data ->> 'updatedAt')
        )
      )
      or (
        expense_data ? 'kind'
        and (
          jsonb_typeof(expense_data -> 'kind') <> 'string'
          or expense_data ->> 'kind' not in ('expense', 'settlement')
        )
      ) then
      return false;
    end if;

    expense_id := expense_data ->> 'id';
    if expense_id = any(expense_ids) then
      return false;
    end if;
    expense_ids := array_append(expense_ids, expense_id);

    expense_amount := (expense_data ->> 'amount')::numeric;
    if expense_amount < 0 or expense_amount > 1000000000 then
      return false;
    end if;

    share_total := 0;
    share_count := 0;
    settlement_recipient_id := null;
    for share_entry in
      select key, value from jsonb_each(expense_data -> 'shares')
    loop
      if length(share_entry.key) not between 1 and 120
        or not (share_entry.key = any(group_member_ids))
        or jsonb_typeof(share_entry.value) <> 'number' then
        return false;
      end if;

      share_amount := (share_entry.value #>> '{}')::numeric;
      if share_amount < 0 or share_amount > 1000000000 then
        return false;
      end if;
      share_total := share_total + share_amount;
      share_count := share_count + 1;
      settlement_recipient_id := share_entry.key;
    end loop;

    if share_count < 1
      or share_count > cardinality(group_member_ids)
      or abs(share_total - expense_amount) >= 0.005 then
      return false;
    end if;

    if expense_data ->> 'kind' = 'settlement'
      and (
        expense_amount <= 0
        or expense_data ->> 'splitMethod' <> 'exact'
        or share_count <> 1
        or settlement_recipient_id = expense_data ->> 'payerId'
      ) then
      return false;
    end if;
  end loop;

  return true;
exception
  when numeric_value_out_of_range or invalid_text_representation then
    return false;
end;
$$;

alter table private.shared_activities
  drop constraint shared_activities_valid_snapshot;
alter table private.shared_activities
  add constraint shared_activities_valid_snapshot
  check (private.is_valid_activity_snapshot(snapshot)) not valid;
alter table private.shared_activities
  validate constraint shared_activities_valid_snapshot;

revoke all on function private.is_valid_activity_timestamp(text)
  from public, anon, authenticated, service_role;
revoke all on function private.is_valid_activity_snapshot(jsonb)
  from public, anon, authenticated, service_role;

-- Let any holder of the current capability deliberately revoke it. The local
-- recovery mirror remains in each browser, but the old URL stops loading or
-- accepting edits immediately.

create function private.end_shared_activity(p_code text, p_edit_token text)
returns table (code text)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  perform private.enforce_shared_activity_rate_limit('update', 120, interval '5 minutes');

  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    perform private.set_anonymous_rpc_status(404);
    return;
  end if;

  return query
  delete from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp()
  returning activity.code;

  if not found then
    perform private.set_anonymous_rpc_status(404);
  end if;
end;
$$;

create function public.end_shared_activity(p_code text, p_edit_token text)
returns table (code text)
language sql
security definer
set search_path = ''
as $$
  select * from private.end_shared_activity(p_code, p_edit_token);
$$;

revoke all on function private.end_shared_activity(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.end_shared_activity(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.end_shared_activity(text, text)
  to anon, authenticated;

comment on function public.end_shared_activity(text, text) is
  'Revokes a Live activity capability while browser recovery copies remain local.';

-- Add a project-wide safety ceiling on top of the existing per-client limits.
-- This prevents distributed clients from creating unbounded OpenRouter spend.

create table private.ai_expense_budget_limits (
  input_mode text primary key check (input_mode in ('text', 'voice')),
  daily_limit integer not null check (daily_limit between 1 and 100000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table private.ai_expense_budget_limits enable row level security;
revoke all on table private.ai_expense_budget_limits
  from public, anon, authenticated, service_role;

insert into private.ai_expense_budget_limits (input_mode, daily_limit)
values ('text', 500), ('voice', 100);

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
    'ai-expense-global-daily',
    'ai-expense-voice-global-daily'
  ));

create function private.consume_ai_expense_quota_v2(
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
    or p_input_mode not in ('text', 'voice') then
    return 'invalid_request';
  end if;

  if p_input_mode = 'voice' then
    burst_operation := 'ai-expense-voice';
    daily_operation := 'ai-expense-voice-daily';
    global_operation := 'ai-expense-voice-global-daily';
    burst_limit := 10;
    client_daily_limit := 25;
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

create function public.consume_ai_expense_quota_v2(
  p_identifier text,
  p_input_mode text default 'text'
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.consume_ai_expense_quota_v2(p_identifier, p_input_mode);
$$;

create or replace function public.consume_ai_expense_quota(
  p_identifier text,
  p_input_mode text default 'text'
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.consume_ai_expense_quota_v2(p_identifier, p_input_mode) = 'allowed';
$$;

revoke all on function private.consume_ai_expense_quota_v2(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.consume_ai_expense_quota_v2(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.consume_ai_expense_quota(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_ai_expense_quota_v2(text, text)
  to service_role;
grant execute on function public.consume_ai_expense_quota(text, text)
  to service_role;

comment on function public.consume_ai_expense_quota_v2(text, text) is
  'Consumes per-client and project-wide AI budgets and returns the limiting scope.';
comment on table private.ai_expense_budget_limits is
  'Server-only project budget controls. Defaults: 500 text and 100 voice provider calls per rolling day.';
