create or replace function private.poll_shared_activity(
  p_code text,
  p_edit_token text
)
returns table (
  code text,
  revision bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  perform private.enforce_shared_activity_rate_limit('load', 300, interval '5 minutes');

  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
  end if;

  return query
  select activity.code, activity.revision, activity.updated_at
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp();

  if not found then
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
  end if;
end;
$$;

create or replace function public.poll_shared_activity(
  p_code text,
  p_edit_token text
)
returns table (
  code text,
  revision bigint,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select * from private.poll_shared_activity(p_code, p_edit_token);
$$;

revoke all on function private.poll_shared_activity(text, text) from public, anon, authenticated;
revoke all on function public.poll_shared_activity(text, text) from public;
grant execute on function public.poll_shared_activity(text, text) to anon, authenticated;
