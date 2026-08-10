-- Collect short, anonymous product feedback without exposing submissions to
-- browser clients. The public RPC validates its narrow input contract and
-- keeps both burst and daily limits in the existing peppered quota table.

create table private.feedback_submissions (
  id bigint generated always as identity primary key,
  category text not null check (category in ('general', 'idea', 'problem')),
  message text not null check (
    message = btrim(message)
    and char_length(message) between 3 and 1000
  ),
  locale text not null check (locale in ('en', 'zh-CN')),
  surface text not null check (surface in ('local', 'live')),
  release text not null check (
    char_length(release) between 1 and 64
    and release ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  created_at timestamptz not null default clock_timestamp()
);

create index feedback_submissions_category_created_at_idx
  on private.feedback_submissions (category, created_at desc);

alter table private.feedback_submissions enable row level security;
revoke all on table private.feedback_submissions
  from public, anon, authenticated, service_role;
revoke all on sequence private.feedback_submissions_id_seq
  from public, anon, authenticated, service_role;

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
    'ai-expense-voice-global-daily',
    'feedback',
    'feedback-daily'
  ));

create function private.submit_feedback(
  p_category text,
  p_message text,
  p_locale text,
  p_surface text,
  p_release text
)
returns text
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  identifier bytea := private.shared_activity_request_identifier();
  request_time timestamptz := clock_timestamp();
  burst_count integer;
  daily_count integer;
  normalized_message text := btrim(p_message);
begin
  insert into private.shared_activity_rate_limits (
    identifier_hash,
    operation,
    window_started_at,
    request_count
  ) values (
    identifier,
    'feedback',
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
    identifier,
    'feedback-daily',
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

  if burst_count > 5 or daily_count > 20 then
    return 'rate_limit';
  end if;

  if p_category is null
    or p_category not in ('general', 'idea', 'problem')
    or p_message is null
    or char_length(normalized_message) not between 3 and 1000
    or p_locale is null
    or p_locale not in ('en', 'zh-CN')
    or p_surface is null
    or p_surface not in ('local', 'live')
    or p_release is null
    or char_length(p_release) not between 1 and 64
    or p_release !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then
    return 'invalid_request';
  end if;

  insert into private.feedback_submissions (
    category,
    message,
    locale,
    surface,
    release
  ) values (
    p_category,
    normalized_message,
    p_locale,
    p_surface,
    p_release
  );

  delete from private.shared_activity_rate_limits
  where (identifier_hash, operation) in (
    select identifier_hash, operation
    from private.shared_activity_rate_limits
    where operation in ('feedback', 'feedback-daily')
      and window_started_at < request_time - interval '2 days'
    order by window_started_at
    limit 100
  );

  return 'submitted';
end;
$$;

create function public.submit_feedback(
  p_category text,
  p_message text,
  p_locale text,
  p_surface text,
  p_release text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.submit_feedback(
    p_category,
    p_message,
    p_locale,
    p_surface,
    p_release
  );
$$;

revoke all on function private.submit_feedback(text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_feedback(text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_feedback(text, text, text, text, text)
  to anon, authenticated;

comment on table private.feedback_submissions is
  'Anonymous in-app feedback. Stores no activity, member, expense, Live capability, network address, or browser session identifier.';
comment on function public.submit_feedback(text, text, text, text, text) is
  'Validates and stores anonymous feedback with limits of 5 submissions per 10 minutes and 20 per day for a peppered network identifier.';
