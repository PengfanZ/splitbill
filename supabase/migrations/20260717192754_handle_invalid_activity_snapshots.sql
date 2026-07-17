-- Invalid snapshots are expected client input failures, not database failures.
-- Returning the current record keeps the rate-limit increment committed and
-- prevents a held submit key from flooding Postgres ERROR logs.
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

  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'invalid_expected_revision';
  end if;
  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
  end if;

  if not coalesce(private.is_valid_activity_snapshot(p_snapshot), false) then
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

-- V3 adds a typed rejection field. Current clients can distinguish a rejected
-- snapshot from an optimistic-concurrency conflict without raising SQL errors.
create or replace function private.update_shared_activity_v3(
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
  conflicted boolean,
  rejection_code text
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  perform private.enforce_shared_activity_rate_limit('update', 120, interval '5 minutes');

  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'invalid_expected_revision';
  end if;
  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
  end if;

  if not coalesce(private.is_valid_activity_snapshot(p_snapshot), false) then
    return query
    select activity.code,
      activity.revision,
      activity.snapshot,
      activity.updated_at,
      true,
      'invalid_activity_snapshot'::text
    from private.shared_activities activity
    where activity.code = p_code
      and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
      and activity.expires_at > clock_timestamp();

    if found then
      return;
    end if;

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
    false,
    null::text;

  if found then
    return;
  end if;

  return query
  select activity.code,
    activity.revision,
    activity.snapshot,
    activity.updated_at,
    true,
    null::text
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

create or replace function public.update_shared_activity_v3(
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
  conflicted boolean,
  rejection_code text
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.update_shared_activity_v3(p_code, p_edit_token, p_expected_revision, p_snapshot);
$$;

revoke all on function private.update_shared_activity_v3(text, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.update_shared_activity_v3(text, text, bigint, jsonb) from public;
grant execute on function public.update_shared_activity_v3(text, text, bigint, jsonb) to anon, authenticated;
