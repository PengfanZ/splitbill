-- Keep anonymous RPC throttles effective even when the request is rejected.
-- Expected client failures return an HTTP status through PostgREST instead of
-- raising, because a raised database error rolls the throttle increment back.

create table private.security_secrets (
  name text primary key,
  secret bytea not null check (octet_length(secret) = 32)
);

alter table private.security_secrets enable row level security;
revoke all on table private.security_secrets from public, anon, authenticated, service_role;

insert into private.security_secrets (name, secret)
values ('request_identifier_pepper', extensions.gen_random_bytes(32));

create or replace function private.shared_activity_request_identifier()
returns bytea
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  request_address text;
  identifier_pepper bytea;
begin
  request_address := btrim(coalesce(
    nullif(
      split_part(
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for',
        ',',
        1
      ),
      ''
    ),
    'local-development'
  ));

  select secret
  into identifier_pepper
  from private.security_secrets
  where name = 'request_identifier_pepper';

  if identifier_pepper is null then
    raise exception using errcode = '55000', message = 'request_identifier_pepper_missing';
  end if;

  return extensions.hmac(
    convert_to(request_address, 'UTF8'),
    identifier_pepper,
    'sha256'
  );
end;
$$;

revoke all on function private.shared_activity_request_identifier()
  from public, anon, authenticated, service_role;

-- Hashes created without the secret pepper are no longer reusable. Resetting
-- this short-lived table avoids retaining obsolete pseudonymous identifiers.
delete from private.shared_activity_rate_limits;

create or replace function private.set_anonymous_rpc_status(p_status integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status not in (400, 404, 409) then
    raise exception using errcode = '22023', message = 'invalid_anonymous_rpc_status';
  end if;

  perform set_config('response.status', p_status::text, true);
  perform set_config(
    'response.headers',
    '[{"Cache-Control":"no-store"}]',
    true
  );
end;
$$;

revoke all on function private.set_anonymous_rpc_status(integer)
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
  perform private.enforce_shared_activity_rate_limit('create', 20, interval '1 hour');

  if not coalesce(private.is_valid_activity_snapshot(p_snapshot), false) then
    perform private.set_anonymous_rpc_status(400);
    return;
  end if;

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

create or replace function private.load_shared_activity(p_code text, p_edit_token text)
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
begin
  perform private.enforce_shared_activity_rate_limit('load', 300, interval '5 minutes');

  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    perform private.set_anonymous_rpc_status(404);
    return;
  end if;

  return query
  select activity.code, activity.revision, activity.snapshot, activity.updated_at
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp();

  if not found then
    perform private.set_anonymous_rpc_status(404);
  end if;
end;
$$;

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
    perform private.set_anonymous_rpc_status(404);
    return;
  end if;

  return query
  select activity.code, activity.revision, activity.updated_at
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp();

  if not found then
    perform private.set_anonymous_rpc_status(404);
  end if;
end;
$$;

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

  if not coalesce(private.is_valid_activity_snapshot(p_snapshot), false)
    or p_expected_revision is null
    or p_expected_revision < 1 then
    perform private.set_anonymous_rpc_status(400);
    return;
  end if;
  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    perform private.set_anonymous_rpc_status(404);
    return;
  end if;

  select activity.id, activity.revision
  into activity_id, current_revision
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp()
  for update;

  if not found then
    perform private.set_anonymous_rpc_status(404);
    return;
  end if;
  if current_revision <> p_expected_revision then
    perform private.set_anonymous_rpc_status(409);
    return;
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
    perform private.set_anonymous_rpc_status(400);
    return;
  end if;
  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    perform private.set_anonymous_rpc_status(404);
    return;
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

    if not found then
      perform private.set_anonymous_rpc_status(404);
    end if;
    return;
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

  if not found then
    perform private.set_anonymous_rpc_status(404);
  end if;
end;
$$;

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
    perform private.set_anonymous_rpc_status(400);
    return;
  end if;
  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    perform private.set_anonymous_rpc_status(404);
    return;
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

    if not found then
      perform private.set_anonymous_rpc_status(404);
    end if;
    return;
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

  if not found then
    perform private.set_anonymous_rpc_status(404);
  end if;
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
    'expense_added',
    'live_share_clicked',
    'live_activity_created',
    'live_activity_opened',
    'settlement_recorded',
    'currency_selected'
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

-- New public objects must opt in to Data API access explicitly. Apply the
-- fail-closed defaults to the migration owner and, when permitted, the
-- Supabase platform owner.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on sequences from public, anon, authenticated, service_role;

do $$
begin
  if pg_has_role(current_user, 'supabase_admin', 'MEMBER') then
    execute 'alter default privileges for role supabase_admin in schema public
      revoke all on tables from public, anon, authenticated, service_role';
    execute 'alter default privileges for role supabase_admin in schema public
      revoke all on sequences from public, anon, authenticated, service_role';
    execute 'alter default privileges for role supabase_admin
      revoke execute on functions from public, anon, authenticated, service_role';
    execute 'alter default privileges for role supabase_admin in schema private
      revoke all on tables from public, anon, authenticated, service_role';
    execute 'alter default privileges for role supabase_admin in schema private
      revoke all on sequences from public, anon, authenticated, service_role';
  else
    raise notice 'Skipping supabase_admin default privileges: migration role is not a member';
  end if;
end;
$$;
