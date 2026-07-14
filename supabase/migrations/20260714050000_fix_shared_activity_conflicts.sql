-- A stale application revision is not a PostgreSQL serialization failure.
-- Keep the legacy RPC compatible, but return a semantic HTTP conflict instead
-- of SQLSTATE 40001 so infrastructure does not treat it as retryable.
create or replace function private.update_shared_activity(
  p_code text,
  p_edit_token text,
  p_expected_revision bigint,
  p_snapshot jsonb
)
returns table (
  code text,
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
  activity_id bigint;
  current_revision bigint;
begin
  perform private.enforce_shared_activity_rate_limit('update', 120, interval '5 minutes');

  if not coalesce(private.is_valid_activity_snapshot(p_snapshot), false) then
    raise exception using errcode = '22023', message = 'invalid_activity_snapshot';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'invalid_expected_revision';
  end if;
  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
  end if;

  select activity.id, activity.revision
  into activity_id, current_revision
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
  end if;
  if current_revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'shared_activity_conflict';
  end if;

  return query
  update private.shared_activities activity
  set snapshot = p_snapshot,
      revision = activity.revision + 1,
      updated_at = clock_timestamp(),
      expires_at = clock_timestamp() + interval '90 days'
  where activity.id = activity_id
  returning activity.code, activity.revision, activity.snapshot, activity.updated_at;
end;
$$;

-- The current client uses a normal result for expected revision conflicts. This
-- avoids error-log noise and gives the browser the latest record without a
-- second request. The conditional update is atomic and keeps row locks short.
create or replace function private.update_shared_activity_v2(
  p_code text,
  p_edit_token text,
  p_expected_revision bigint,
  p_snapshot jsonb
)
returns table (
  code text,
  revision bigint,
  snapshot jsonb,
  updated_at timestamptz,
  conflicted boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  perform private.enforce_shared_activity_rate_limit('update', 120, interval '5 minutes');

  if not coalesce(private.is_valid_activity_snapshot(p_snapshot), false) then
    raise exception using errcode = '22023', message = 'invalid_activity_snapshot';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'invalid_expected_revision';
  end if;
  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
  end if;

  return query
  update private.shared_activities activity
  set snapshot = p_snapshot,
      revision = activity.revision + 1,
      updated_at = clock_timestamp(),
      expires_at = clock_timestamp() + interval '90 days'
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp()
    and activity.revision = p_expected_revision
  returning activity.code,
    activity.revision,
    activity.snapshot,
    activity.updated_at,
    false;

  if found then
    return;
  end if;

  return query
  select activity.code,
    activity.revision,
    activity.snapshot,
    activity.updated_at,
    true
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp();

  if found then
    return;
  end if;

  raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
end;
$$;

create or replace function public.update_shared_activity_v2(
  p_code text,
  p_edit_token text,
  p_expected_revision bigint,
  p_snapshot jsonb
)
returns table (
  code text,
  revision bigint,
  snapshot jsonb,
  updated_at timestamptz,
  conflicted boolean
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.update_shared_activity_v2(p_code, p_edit_token, p_expected_revision, p_snapshot);
$$;

revoke all on function private.update_shared_activity_v2(text, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.update_shared_activity_v2(text, text, bigint, jsonb) from public;
grant execute on function public.update_shared_activity_v2(text, text, bigint, jsonb) to anon, authenticated;
