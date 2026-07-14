alter table private.shared_activities enable row level security;

alter table private.shared_activities
  add column expires_at timestamptz not null default (now() + interval '90 days'),
  add constraint shared_activities_expires_after_update check (expires_at >= updated_at);

create index shared_activities_expires_at_idx
  on private.shared_activities (expires_at);

create table private.shared_activity_rate_limits (
  identifier_hash bytea not null check (octet_length(identifier_hash) = 32),
  operation text not null check (operation in ('create', 'load', 'update')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (identifier_hash, operation)
);

alter table private.shared_activity_rate_limits enable row level security;
revoke all on table private.shared_activity_rate_limits from public, anon, authenticated;

create or replace function private.shared_activity_request_identifier()
returns bytea
language sql
stable
security invoker
set search_path = ''
as $$
  select extensions.digest(
    coalesce(
      nullif(
        split_part(
          coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for',
          ',',
          1
        ),
        ''
      ),
      'local-development'
    ),
    'sha256'
  );
$$;

create or replace function private.enforce_shared_activity_rate_limit(
  p_operation text,
  p_limit integer,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  identifier bytea := private.shared_activity_request_identifier();
  request_time timestamptz := clock_timestamp();
  current_count integer;
begin
  if p_operation not in ('create', 'load', 'update')
    or p_limit < 1
    or p_window <= interval '0 seconds' then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_configuration';
  end if;

  insert into private.shared_activity_rate_limits (
    identifier_hash,
    operation,
    window_started_at,
    request_count
  ) values (
    identifier,
    p_operation,
    request_time,
    1
  )
  on conflict (identifier_hash, operation) do update
  set window_started_at = case
        when private.shared_activity_rate_limits.window_started_at <= request_time - p_window then request_time
        else private.shared_activity_rate_limits.window_started_at
      end,
      request_count = case
        when private.shared_activity_rate_limits.window_started_at <= request_time - p_window then 1
        else private.shared_activity_rate_limits.request_count + 1
      end
  returning request_count into current_count;

  if current_count > p_limit then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'rate_limit_exceeded',
        'message', 'Too many requests. Try again later.',
        'details', null,
        'hint', null
      )::text,
      detail = json_build_object(
        'status', 429,
        'status_text', 'Too Many Requests',
        'headers', json_build_object(
          'Retry-After', ceil(extract(epoch from p_window))::integer::text
        )
      )::text;
  end if;
end;
$$;

create or replace function private.is_valid_activity_snapshot(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_snapshot), '') = 'object'
    and coalesce(p_snapshot ->> 'version', '') = '2'
    and coalesce(jsonb_typeof(p_snapshot -> 'sender'), '') = 'object'
    and length(coalesce(p_snapshot #>> '{sender,id}', '')) between 1 and 120
    and length(coalesce(p_snapshot #>> '{sender,name}', '')) between 1 and 120
    and length(coalesce(p_snapshot #>> '{sender,initials}', '')) between 1 and 12
    and length(coalesce(p_snapshot #>> '{sender,color}', '')) between 1 and 32
    and coalesce(jsonb_typeof(p_snapshot -> 'group'), '') = 'object'
    and length(coalesce(p_snapshot #>> '{group,id}', '')) between 1 and 120
    and length(coalesce(p_snapshot #>> '{group,name}', '')) between 1 and 120
    and length(coalesce(p_snapshot #>> '{group,emoji}', '')) between 1 and 16
    and case when jsonb_typeof(p_snapshot #> '{group,memberIds}') = 'array' then
      jsonb_array_length(p_snapshot #> '{group,memberIds}') between 1 and 101
      and not exists (
        select 1
        from jsonb_array_elements(p_snapshot #> '{group,memberIds}') member_id
        where jsonb_typeof(member_id) <> 'string'
          or length(member_id #>> '{}') not between 1 and 120
      )
    else false end
    and case when jsonb_typeof(p_snapshot -> 'friends') = 'array' then
      jsonb_array_length(p_snapshot -> 'friends') <= 100
      and not exists (
        select 1
        from jsonb_array_elements(p_snapshot -> 'friends') friend
        where jsonb_typeof(friend) <> 'object'
          or length(coalesce(friend ->> 'id', '')) not between 1 and 120
          or length(coalesce(friend ->> 'name', '')) not between 1 and 120
          or length(coalesce(friend ->> 'initials', '')) not between 1 and 12
          or length(coalesce(friend ->> 'color', '')) not between 1 and 32
      )
    else false end
    and case when jsonb_typeof(p_snapshot -> 'expenses') = 'array' then
      jsonb_array_length(p_snapshot -> 'expenses') <= 1000
      and not exists (
        select 1
        from jsonb_array_elements(p_snapshot -> 'expenses') expense
        where jsonb_typeof(expense) <> 'object'
          or length(coalesce(expense ->> 'id', '')) not between 1 and 120
          or length(coalesce(expense ->> 'groupId', '')) not between 1 and 120
          or length(coalesce(expense ->> 'title', '')) not between 1 and 200
          or length(coalesce(expense ->> 'payerId', '')) not between 1 and 120
          or coalesce(expense ->> 'splitMethod', '') not in ('equal', 'exact')
          or case when jsonb_typeof(expense -> 'amount') = 'number' then
            abs((expense ->> 'amount')::numeric) > 1000000000
          else true end
          or case when jsonb_typeof(expense -> 'shares') = 'object' then
            exists (
              select 1
              from jsonb_each(expense -> 'shares') share
              where length(share.key) not between 1 and 120
                or case when jsonb_typeof(share.value) = 'number' then
                  abs((share.value #>> '{}')::numeric) > 1000000000
                else true end
            )
          else true end
      )
    else false end
    and pg_column_size(p_snapshot) <= 131072;
$$;

alter table private.shared_activities
  add constraint shared_activities_valid_snapshot
  check (private.is_valid_activity_snapshot(snapshot)) not valid;

alter table private.shared_activities
  validate constraint shared_activities_valid_snapshot;

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
    raise exception using errcode = '22023', message = 'invalid_activity_snapshot';
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
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
  end if;

  return query
  select activity.code, activity.revision, activity.snapshot, activity.updated_at
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp();

  if not found then
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
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
    raise exception using errcode = '40001', message = 'shared_activity_conflict';
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

create or replace function public.create_shared_activity(p_snapshot jsonb)
returns table (code text, edit_token text, revision bigint, snapshot jsonb, updated_at timestamptz)
language sql
security definer
set search_path = ''
as $$ select * from private.create_shared_activity(p_snapshot); $$;

create or replace function public.load_shared_activity(p_code text, p_edit_token text)
returns table (code text, revision bigint, snapshot jsonb, updated_at timestamptz)
language sql
security definer
set search_path = ''
as $$ select * from private.load_shared_activity(p_code, p_edit_token); $$;

create or replace function public.update_shared_activity(
  p_code text,
  p_edit_token text,
  p_expected_revision bigint,
  p_snapshot jsonb
)
returns table (code text, revision bigint, snapshot jsonb, updated_at timestamptz)
language sql
security definer
set search_path = ''
as $$ select * from private.update_shared_activity(p_code, p_edit_token, p_expected_revision, p_snapshot); $$;

revoke usage on schema private from anon, authenticated;
revoke all on function private.shared_activity_request_identifier() from public, anon, authenticated;
revoke all on function private.enforce_shared_activity_rate_limit(text, integer, interval) from public, anon, authenticated;
revoke all on function private.is_valid_activity_snapshot(jsonb) from public, anon, authenticated;
revoke all on function private.create_shared_activity(jsonb) from public, anon, authenticated;
revoke all on function private.load_shared_activity(text, text) from public, anon, authenticated;
revoke all on function private.update_shared_activity(text, text, bigint, jsonb) from public, anon, authenticated;

revoke all on function public.create_shared_activity(jsonb) from public;
revoke all on function public.load_shared_activity(text, text) from public;
revoke all on function public.update_shared_activity(text, text, bigint, jsonb) from public;
grant execute on function public.create_shared_activity(jsonb) to anon, authenticated;
grant execute on function public.load_shared_activity(text, text) to anon, authenticated;
grant execute on function public.update_shared_activity(text, text, bigint, jsonb) to anon, authenticated;
