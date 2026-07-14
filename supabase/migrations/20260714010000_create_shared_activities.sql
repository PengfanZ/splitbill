create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create table private.shared_activities (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-F0-9]{10}$'),
  edit_token_hash bytea not null check (octet_length(edit_token_hash) = 32),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (updated_at >= created_at)
);

revoke all on table private.shared_activities from public, anon, authenticated;
revoke all on sequence private.shared_activities_id_seq from public, anon, authenticated;

create or replace function private.is_valid_activity_snapshot(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_snapshot) = 'object'
    and p_snapshot ->> 'version' = '2'
    and jsonb_typeof(p_snapshot -> 'sender') = 'object'
    and jsonb_typeof(p_snapshot -> 'group') = 'object'
    and jsonb_typeof(p_snapshot -> 'friends') = 'array'
    and jsonb_typeof(p_snapshot -> 'expenses') = 'array'
    and length(coalesce(p_snapshot #>> '{group,name}', '')) between 1 and 120
    and pg_column_size(p_snapshot) <= 131072;
$$;

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
as $$
declare
  generated_code text;
  generated_token text;
begin
  if not coalesce(private.is_valid_activity_snapshot(p_snapshot), false) then
    raise exception using errcode = '22023', message = 'invalid_activity_snapshot';
  end if;

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
as $$
begin
  if p_code !~ '^[A-F0-9]{10}$' or p_edit_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0002', message = 'shared_activity_not_found';
  end if;

  return query
  select activity.code, activity.revision, activity.snapshot, activity.updated_at
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256');

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
as $$
declare
  activity_id bigint;
  current_revision bigint;
begin
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
      updated_at = clock_timestamp()
  where activity.id = activity_id
  returning activity.code, activity.revision, activity.snapshot, activity.updated_at;
end;
$$;

create or replace function public.create_shared_activity(p_snapshot jsonb)
returns table (code text, edit_token text, revision bigint, snapshot jsonb, updated_at timestamptz)
language sql
security invoker
set search_path = ''
as $$ select * from private.create_shared_activity(p_snapshot); $$;

create or replace function public.load_shared_activity(p_code text, p_edit_token text)
returns table (code text, revision bigint, snapshot jsonb, updated_at timestamptz)
language sql
security invoker
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
security invoker
set search_path = ''
as $$ select * from private.update_shared_activity(p_code, p_edit_token, p_expected_revision, p_snapshot); $$;

revoke all on function private.is_valid_activity_snapshot(jsonb) from public;
revoke all on function private.create_shared_activity(jsonb) from public;
revoke all on function private.load_shared_activity(text, text) from public;
revoke all on function private.update_shared_activity(text, text, bigint, jsonb) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.create_shared_activity(jsonb) to anon, authenticated;
grant execute on function private.load_shared_activity(text, text) to anon, authenticated;
grant execute on function private.update_shared_activity(text, text, bigint, jsonb) to anon, authenticated;

revoke all on function public.create_shared_activity(jsonb) from public;
revoke all on function public.load_shared_activity(text, text) from public;
revoke all on function public.update_shared_activity(text, text, bigint, jsonb) from public;
grant execute on function public.create_shared_activity(jsonb) to anon, authenticated;
grant execute on function public.load_shared_activity(text, text) to anon, authenticated;
grant execute on function public.update_shared_activity(text, text, bigint, jsonb) to anon, authenticated;
