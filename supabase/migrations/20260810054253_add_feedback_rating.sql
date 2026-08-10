-- Let users leave either a one-tap 1-5 rating, a written note, or both.
-- The public endpoint remains narrow and keeps the same anonymous quotas.

alter table private.feedback_submissions
  add column rating smallint;

alter table private.feedback_submissions
  drop constraint feedback_submissions_message_check;
alter table private.feedback_submissions
  alter column message drop not null;
alter table private.feedback_submissions
  add constraint feedback_submissions_message_check
  check (
    message is null
    or (
      message = btrim(message)
      and char_length(message) between 3 and 1000
    )
  );
alter table private.feedback_submissions
  add constraint feedback_submissions_rating_check
  check (rating is null or rating between 1 and 5);
alter table private.feedback_submissions
  add constraint feedback_submissions_content_check
  check (rating is not null or message is not null);

create index feedback_submissions_rating_created_at_idx
  on private.feedback_submissions (created_at desc)
  where rating is not null;

drop function public.submit_feedback(text, text, text, text, text);
drop function private.submit_feedback(text, text, text, text, text);

create function private.submit_feedback(
  p_category text,
  p_message text,
  p_locale text,
  p_surface text,
  p_release text,
  p_rating smallint
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
  normalized_message text := nullif(btrim(p_message), '');
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
    or (normalized_message is not null and char_length(normalized_message) not between 3 and 1000)
    or (p_rating is not null and p_rating not between 1 and 5)
    or (normalized_message is null and p_rating is null)
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
    release,
    rating
  ) values (
    p_category,
    normalized_message,
    p_locale,
    p_surface,
    p_release,
    p_rating
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
  p_release text,
  p_rating smallint
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
    p_release,
    p_rating
  );
$$;

revoke all on function private.submit_feedback(text, text, text, text, text, smallint)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_feedback(text, text, text, text, text, smallint)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_feedback(text, text, text, text, text, smallint)
  to anon, authenticated;

comment on table private.feedback_submissions is
  'Anonymous in-app feedback and optional 1-5 rating. Stores no activity, member, expense, Live capability, network address, or browser session identifier.';
comment on function public.submit_feedback(text, text, text, text, text, smallint) is
  'Validates and stores an anonymous rating, written note, or both, with limits of 5 submissions per 10 minutes and 20 per day for a peppered network identifier.';
