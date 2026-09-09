-- Inactive membership is activity-scoped: retain identities and historical money.
create or replace function private.is_valid_inactive_members(p_snapshot jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  inactive jsonb := p_snapshot #> '{group,inactiveMemberIds}';
  member jsonb;
  seen text[] := array[]::text[];
begin
  if inactive is null then return true; end if;
  if jsonb_typeof(inactive) <> 'array' then return false; end if;
  if jsonb_array_length(inactive) > 100 then return false; end if;
  for member in select value from jsonb_array_elements(inactive) loop
    if jsonb_typeof(member) <> 'string'
      or member = '"me"'::jsonb
      or not coalesce((p_snapshot #> '{group,memberIds}') @> jsonb_build_array(member), false)
      or (member #>> '{}') = any(seen) then return false; end if;
    seen := array_append(seen, member #>> '{}');
  end loop;
  return true;
end;
$$;

-- Call only after snapshot validation. Existing expense references may survive
-- removal; newly introduced references to inactive people may not.
create or replace function private.is_valid_membership_transition(previous jsonb, next_snapshot jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  old_inactive jsonb := coalesce(previous #> '{group,inactiveMemberIds}', '[]'::jsonb);
  inactive jsonb := coalesce(next_snapshot #> '{group,inactiveMemberIds}', '[]'::jsonb);
  expense jsonb;
  old_expense jsonb;
  previous_expenses jsonb;
  member text;
begin
  if (previous -> 'group') ? 'inactiveMemberIds'
    and not ((next_snapshot -> 'group') ? 'inactiveMemberIds') then return false; end if;
  if not ((next_snapshot #> '{group,memberIds}') @> old_inactive) then return false; end if;
  if jsonb_array_length(inactive) = 0 then return true; end if;
  select coalesce(jsonb_object_agg(value ->> 'id', value), '{}'::jsonb)
    into previous_expenses from jsonb_array_elements(previous -> 'expenses');
  for expense in select value from jsonb_array_elements(next_snapshot -> 'expenses') loop
    if expense ->> 'kind' = 'settlement' then continue; end if;
    old_expense := previous_expenses -> (expense ->> 'id');
    for member in select jsonb_array_elements_text(inactive) loop
      if (expense ->> 'payerId' = member or (expense -> 'shares') ? member)
        and not coalesce(old_expense ->> 'payerId' = member or (old_expense -> 'shares') ? member, false)
        then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

revoke all on function private.is_valid_inactive_members(jsonb) from public, anon, authenticated;
revoke all on function private.is_valid_membership_transition(jsonb, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.is_valid_activity_snapshot(p_snapshot jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
  if not private.is_valid_inactive_members(p_snapshot) then return false; end if;
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
$function$;


CREATE OR REPLACE FUNCTION private.update_shared_activity(p_code text, p_edit_token text, p_expected_revision bigint, p_snapshot jsonb)
 RETURNS TABLE(code text, revision bigint, snapshot jsonb, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
declare
  activity_id bigint;
  current_revision bigint;
  current_snapshot jsonb;
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

  select activity.id, activity.revision, activity.snapshot
  into activity_id, current_revision, current_snapshot
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp()
  for update;

  if not found then
    perform private.set_anonymous_rpc_status(404);
    return;
  end if;
  if current_revision <> p_expected_revision
    or not private.is_valid_membership_transition(current_snapshot, p_snapshot) then
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
$function$;


CREATE OR REPLACE FUNCTION private.update_shared_activity_v2(p_code text, p_edit_token text, p_expected_revision bigint, p_snapshot jsonb)
 RETURNS TABLE(code text, revision bigint, snapshot jsonb, updated_at timestamp with time zone, conflicted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
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
    and private.is_valid_membership_transition(activity.snapshot, p_snapshot)
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
$function$;


CREATE OR REPLACE FUNCTION private.update_shared_activity_v3(p_code text, p_edit_token text, p_expected_revision bigint, p_snapshot jsonb)
 RETURNS TABLE(code text, revision bigint, snapshot jsonb, updated_at timestamp with time zone, conflicted boolean, rejection_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
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
    and private.is_valid_membership_transition(activity.snapshot, p_snapshot)
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
    case when activity.revision = p_expected_revision
      and not private.is_valid_membership_transition(activity.snapshot, p_snapshot)
      then 'activity_membership_changed'::text else null::text end
  from private.shared_activities activity
  where activity.code = p_code
    and activity.edit_token_hash = extensions.digest(p_edit_token, 'sha256')
    and activity.expires_at > clock_timestamp();

  if not found then
    perform private.set_anonymous_rpc_status(404);
  end if;
end;
$function$;
