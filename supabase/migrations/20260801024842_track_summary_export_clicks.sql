-- Keep the migration version aligned with the migration recorded by Supabase.
alter table private.analytics_events
  drop constraint analytics_events_event_name_check;

alter table private.analytics_events
  add constraint analytics_events_event_name_check
    check (event_name in (
      'app_opened',
      'activity_created',
      'friend_added',
      'expense_added',
      'summary_export_clicked',
      'live_share_clicked',
      'live_activity_created',
      'live_activity_opened',
      'settlement_recorded',
      'currency_selected'
    ));

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
    'friend_added',
    'expense_added',
    'summary_export_clicked',
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

revoke all on function private.record_analytics_event(text, text, text, text, text)
  from public, anon, authenticated, service_role;

comment on constraint analytics_events_event_name_check on private.analytics_events is
  'Allowlisted anonymous product outcomes, including balance-summary export intent.';
