-- paidAt is when an expense was paid; a missing value means the same as createdAt.
-- Missing on an update means an older client rebuilt the expense, so the earlier value is kept.
-- Preserve metadata only; never merge amounts, shares, or concurrent revisions.
create or replace function private.preserve_activity_payment_times(previous jsonb, incoming jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  old_expenses jsonb;
  expense jsonb;
  paid_at jsonb;
  result_expenses jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(incoming -> 'expenses') is distinct from 'array'
    or jsonb_typeof(previous -> 'expenses') is distinct from 'array' then
    return incoming;
  end if;
  select coalesce(jsonb_object_agg(value ->> 'id', value -> 'paidAt'), '{}'::jsonb) into old_expenses
    from jsonb_array_elements(previous -> 'expenses')
    where jsonb_typeof(value) = 'object'
      and jsonb_typeof(value -> 'id') = 'string'
      and jsonb_typeof(value -> 'paidAt') = 'string';
  for expense in select value from jsonb_array_elements(incoming -> 'expenses') loop
    if jsonb_typeof(expense) = 'object' and not (expense ? 'paidAt') and jsonb_typeof(expense -> 'id') = 'string' then
      paid_at := old_expenses -> (expense ->> 'id');
      if paid_at is not null and coalesce(private.is_valid_activity_timestamp(paid_at #>> '{}'), false) then
        expense := jsonb_set(expense, '{paidAt}', paid_at);
      end if;
    end if;
    result_expenses := result_expenses || jsonb_build_array(expense);
  end loop;
  return jsonb_set(incoming, '{expenses}', result_expenses);
end;
$$;

create or replace function private.preserve_activity_payment_times_on_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.snapshot := private.preserve_activity_payment_times(old.snapshot, new.snapshot);
  return new;
end;
$$;
create trigger preserve_activity_payment_times
before update of snapshot on private.shared_activities
for each row execute function private.preserve_activity_payment_times_on_update();

revoke all on function private.preserve_activity_payment_times(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.preserve_activity_payment_times_on_update() from public, anon, authenticated;

-- Same validator as before, with the optional paidAt checked like updatedAt.
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
  if not private.is_valid_activity_categories(p_snapshot) then return false; end if;
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
        expense_data ? 'paidAt'
        and (
          jsonb_typeof(expense_data -> 'paidAt') <> 'string'
          or length(expense_data ->> 'paidAt') not between 1 and 120
          or not private.is_valid_activity_timestamp(expense_data ->> 'paidAt')
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
