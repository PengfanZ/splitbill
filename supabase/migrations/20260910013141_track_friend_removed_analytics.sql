alter table "private"."analytics_events" drop constraint "analytics_events_event_name_check";

alter table "private"."analytics_events" add constraint "analytics_events_event_name_check" CHECK ((event_name = ANY (ARRAY['app_opened'::text, 'activity_created'::text, 'friend_added'::text, 'friend_removed'::text, 'expense_added'::text, 'feedback_submitted'::text, 'summary_export_clicked'::text, 'csv_export_completed'::text, 'live_share_clicked'::text, 'live_activity_created'::text, 'live_activity_opened'::text, 'settlement_recorded'::text, 'currency_selected'::text, 'expense_input_manual_selected'::text, 'expense_input_ai_text_selected'::text, 'expense_input_ai_voice_selected'::text, 'expense_input_receipt_selected'::text, 'ai_text_requested'::text, 'ai_text_ready'::text, 'ai_text_clarification'::text, 'ai_text_failed'::text, 'ai_voice_requested'::text, 'ai_voice_ready'::text, 'ai_voice_clarification'::text, 'ai_voice_failed'::text, 'ai_receipt_requested'::text, 'ai_receipt_ready'::text, 'ai_receipt_failed'::text, 'ai_receipt_confirmed'::text]))) not valid;

alter table "private"."analytics_events" validate constraint "analytics_events_event_name_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.record_analytics_event(p_event_name text, p_surface text, p_session_token text, p_locale text, p_currency text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '2s'
AS $function$
begin
  perform private.enforce_shared_activity_rate_limit('analytics', 300, interval '5 minutes');

  if p_event_name is null or p_event_name not in (
    'app_opened',
    'activity_created',
    'friend_added',
    'friend_removed',
    'expense_added',
    'feedback_submitted',
    'summary_export_clicked',
    'csv_export_completed',
    'live_share_clicked',
    'live_activity_created',
    'live_activity_opened',
    'settlement_recorded',
    'currency_selected',
    'expense_input_manual_selected',
    'expense_input_ai_text_selected',
    'expense_input_ai_voice_selected',
    'expense_input_receipt_selected',
    'ai_text_requested',
    'ai_text_ready',
    'ai_text_clarification',
    'ai_text_failed',
    'ai_voice_requested',
    'ai_voice_ready',
    'ai_voice_clarification',
    'ai_voice_failed',
    'ai_receipt_requested',
    'ai_receipt_ready',
    'ai_receipt_failed',
    'ai_receipt_confirmed'
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

  perform private.enforce_public_api_project_budget('analytics_events', 1);

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
$function$
;


