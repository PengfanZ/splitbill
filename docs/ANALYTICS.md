# First-party analytics

Tally measures a deliberately small set of anonymous product outcomes without uploading local activity data or exposing live-link capabilities to third-party JavaScript.

## Event contract

The browser may send only these event names:

- `app_opened`
- `activity_created`
- `friend_added`
- `expense_added`
- `summary_export_clicked`
- `live_share_clicked`
- `live_activity_created`
- `live_activity_opened`
- `settlement_recorded`
- `currency_selected`
- `ai_text_requested`
- `ai_text_ready`
- `ai_text_clarification`
- `ai_text_failed`
- `ai_voice_requested`
- `ai_voice_ready`
- `ai_voice_clarification`
- `ai_voice_failed`

Each current event also has exactly one surface (`local` or `live`) and one resolved app locale (`en` or `zh-CN`). Historical rows from versions that supported URL snapshots may still contain the legacy `snapshot` surface. `currency_selected` additionally includes one constrained ISO currency code from Tally’s supported list; every other event must omit it. The locale is the language Tally is currently displaying, including a saved manual choice; it is not a country, GPS coordinate, IP-derived location, or full browser-language fingerprint. The request contains a random 128-bit session token stored in browser session storage. The database stores only its SHA-256 hash, which supports within-session funnels without creating a persistent visitor profile.

Historical events and requests from older installed PWAs are stored as `unknown`. This avoids misclassifying legacy traffic as English while the new frontend version rolls out.

Do not add arbitrary metadata to this contract. Analytics must never receive URLs or fragments, activity codes, edit tokens, participant names or IDs, activity names, expense descriptions, amounts, balances, or snapshots.

## Request and storage boundary

`src/analytics.ts` sends events as non-blocking `fetch` requests with `keepalive`, omitted credentials, and no referrer. Failed analytics requests are ignored and never affect local or live workflows.

`public.record_analytics_event` is the only browser-callable database entry point. It validates the event, surface, locale, and session-token shape; applies hashed-IP throttling; consumes one unit from a server-only 5,000-event rolling daily project budget; hashes the session token; and inserts into `private.analytics_events`. Invalid events still consume their client throttle but do not consume project capacity. Browser roles cannot read or write the event or budget tables directly and cannot read `private.analytics_daily`, `private.analytics_hourly`, or `private.analytics_locale_daily`.

Opening the app records its initial surface. Successful product actions are measured only after their local state update or live revision save succeeds. A failed expense or settlement save does not produce a success event. Currency selection is intentionally an interaction event: it records a deliberate change in either currency selector, even if the person later cancels activity creation or a live update cannot be saved.

`friend_added` records one event after a successful friend-add action, including activity creation when at least one initial friend is supplied. Adding several friends in one submission still records one event. Failed Live saves do not count, and the request never includes friend names, IDs, or a friend count.

`expense_added` records one event after a successful add action. Saving an AI-generated batch still records one event, matching the single confirmation and atomic state update rather than sending one analytics request per expense. The request never includes the batch size or any expense data.

`live_share_clicked` is also an intentional interaction event. It records when someone chooses **Start live activity**, before the backend request begins. Compare it with `live_activity_created` to distinguish sharing intent from successful Live activity creation. It contains no activity or link data.

`summary_export_clicked` records when someone chooses **Export full summary**, before PNG generation or any share, download, or clipboard fallback begins. It measures export intent rather than successful delivery and contains no activity name, participants, expenses, balances, Live URL, QR code, or generated image data.

AI entry uses a separate four-step funnel for `text` and `voice`. `requested` is recorded immediately before each real Edge Function request, including model follow-ups. `ready`, `clarification`, or `failed` records the result of that request. Deterministic local clarification, microphone permission errors, unsupported browsers, and empty recordings do not count as AI requests because they never reach the service. These events contain only the event name, surface, locale, and anonymous session hash. Prompts, clarification answers, audio, model output, draft counts, latency, member data, and expense data are never sent to analytics.

## Reports in Supabase

Create saved report queries in **Supabase Dashboard → SQL Editor**, then add them to the custom **Observability → Home** report. The daily aggregate is the default operational view:

```sql
select event_day, event_name, surface, events, sessions
from private.analytics_daily
order by event_day desc, event_name, surface;
```

The Home report's **SplitBill - App Usage Summary** block uses a table instead of a chart so the current usage and trend are immediately readable. `Today` follows the Eastern calendar day. The weekly and monthly rows compare rolling 7- and 30-day windows with the immediately preceding windows of the same length:

```sql
with boundaries as (
  select
    now() as current_end,
    now() - interval '7 days' as week_start,
    now() - interval '14 days' as previous_week_start,
    now() - interval '30 days' as month_start,
    now() - interval '60 days' as previous_month_start,
    (
      date_trunc('day', now() at time zone 'America/New_York')
      at time zone 'America/New_York'
    ) as today_start
),
usage as (
  select
    count(distinct session_hash) filter (
      where occurred_at >= today_start and occurred_at < current_end
    )::bigint as sessions_today,
    count(*) filter (
      where occurred_at >= today_start and occurred_at < current_end
    )::bigint as opens_today,
    count(distinct session_hash) filter (
      where occurred_at >= week_start and occurred_at < current_end
    )::bigint as sessions_week,
    count(distinct session_hash) filter (
      where occurred_at >= previous_week_start and occurred_at < week_start
    )::bigint as sessions_previous_week,
    count(*) filter (
      where occurred_at >= week_start and occurred_at < current_end
    )::bigint as opens_week,
    count(*) filter (
      where occurred_at >= previous_week_start and occurred_at < week_start
    )::bigint as opens_previous_week,
    count(distinct session_hash) filter (
      where occurred_at >= month_start and occurred_at < current_end
    )::bigint as sessions_month,
    count(distinct session_hash) filter (
      where occurred_at >= previous_month_start and occurred_at < month_start
    )::bigint as sessions_previous_month,
    count(*) filter (
      where occurred_at >= month_start and occurred_at < current_end
    )::bigint as opens_month,
    count(*) filter (
      where occurred_at >= previous_month_start and occurred_at < month_start
    )::bigint as opens_previous_month
  from private.analytics_events, boundaries
  where event_name = 'app_opened'
    and occurred_at >= previous_month_start
    and occurred_at < current_end
)
select
  period as "Period",
  sessions_display as "Sessions vs prior",
  opens_display as "App opens vs prior"
from usage
cross join lateral (
  values
    (1, 'Today', sessions_today::text, opens_today::text),
    (
      2,
      'Last 7 days',
      concat(
        sessions_week,
        case
          when sessions_previous_week = 0 then ' · new'
          when sessions_week > sessions_previous_week then ' ↑' || round(100.0 * (sessions_week - sessions_previous_week) / sessions_previous_week)::int || '%'
          when sessions_week < sessions_previous_week then ' ↓' || abs(round(100.0 * (sessions_week - sessions_previous_week) / sessions_previous_week)::int) || '%'
          else ' →0%'
        end
      ),
      concat(
        opens_week,
        case
          when opens_previous_week = 0 then ' · new'
          when opens_week > opens_previous_week then ' ↑' || round(100.0 * (opens_week - opens_previous_week) / opens_previous_week)::int || '%'
          when opens_week < opens_previous_week then ' ↓' || abs(round(100.0 * (opens_week - opens_previous_week) / opens_previous_week)::int) || '%'
          else ' →0%'
        end
      )
    ),
    (
      3,
      'Last 30 days',
      case
        when sessions_previous_month = 0 then sessions_month || ' · no prior data'
        when sessions_month > sessions_previous_month then sessions_month || ' ↑' || round(100.0 * (sessions_month - sessions_previous_month) / sessions_previous_month)::int || '%'
        when sessions_month < sessions_previous_month then sessions_month || ' ↓' || abs(round(100.0 * (sessions_month - sessions_previous_month) / sessions_previous_month)::int) || '%'
        else sessions_month || ' →0%'
      end,
      case
        when opens_previous_month = 0 then opens_month || ' · no prior data'
        when opens_month > opens_previous_month then opens_month || ' ↑' || round(100.0 * (opens_month - opens_previous_month) / opens_previous_month)::int || '%'
        when opens_month < opens_previous_month then opens_month || ' ↓' || abs(round(100.0 * (opens_month - opens_previous_month) / opens_previous_month)::int) || '%'
        else opens_month || ' →0%'
      end
    )
) as summary(sort_order, period, sessions_display, opens_display)
order by sort_order;
```

Use the report block's **As table** setting. An upward arrow means growth against the preceding equivalent window, a downward arrow means decline, and `no prior data` means tracking has not yet collected a complete comparison window. Do not label these values as users: `session_hash` identifies an anonymous browser session, and one person can create more than one session.

Add a second **As table** block named **SplitBill - AI Entry Usage** to monitor text and voice frequency and reliability without activity data:

```sql
with usage as (
  select
    event_name,
    count(*) filter (
      where occurred_at >= (
        date_trunc('day', now() at time zone 'America/New_York')
        at time zone 'America/New_York'
      )
    )::bigint as today,
    count(*) filter (where occurred_at >= now() - interval '7 days')::bigint as last_7_days,
    count(*) filter (where occurred_at >= now() - interval '30 days')::bigint as last_30_days
  from private.analytics_events
  where event_name like 'ai\_%' escape '\'
  group by event_name
), rows(event_name, sort_order, label) as (
  values
    ('ai_text_requested', 1, 'Text requests'),
    ('ai_voice_requested', 2, 'Voice requests'),
    ('ai_text_ready', 3, 'Text drafts ready'),
    ('ai_voice_ready', 4, 'Voice drafts ready'),
    ('ai_text_clarification', 5, 'Text clarifications'),
    ('ai_voice_clarification', 6, 'Voice clarifications'),
    ('ai_text_failed', 7, 'Text failures'),
    ('ai_voice_failed', 8, 'Voice failures')
)
select
  rows.label as "AI outcome",
  coalesce(usage.today, 0) as "Today",
  coalesce(usage.last_7_days, 0) as "Last 7 days",
  coalesce(usage.last_30_days, 0) as "Last 30 days"
from rows
left join usage using (event_name)
order by rows.sort_order;
```

`Text requests` and `Voice requests` are the provider-facing frequency metrics. Compare each with its ready, clarification, and failure rows to spot reliability changes. One conversational entry may make several requests when the model asks follow-up questions, so this view intentionally measures AI service usage rather than completed expenses.

For a chronological hourly usage chart, query the UTC hourly aggregate and convert the label to the reporting timezone. This example uses Eastern Time; replace `America/New_York` with `Asia/Shanghai` for China time:

```sql
select
  event_hour at time zone 'America/New_York' as event_hour_local,
  sum(events)::bigint as events
from private.analytics_hourly
where event_hour >= now() - interval '7 days'
group by event_hour
order by event_hour;
```

In the SQL Editor chart, use `event_hour_local` for the X-axis and `events` for the Y-axis. The view retains `event_name` and `surface`, so add either column to the query when you want separate series. Do not sum the view's `sessions` column across event names or surfaces because the same anonymous session may appear in more than one group.

For a 30-day locale breakdown, use app-open events because each anonymous browser session records one initial app open:

```sql
select
  locale,
  sum(events)::bigint as app_opens,
  sum(sessions)::bigint as sessions
from private.analytics_locale_daily
where event_day >= current_date - 29
  and event_name = 'app_opened'
group by locale
order by sessions desc, locale;
```

In the SQL Editor chart, use `locale` for the X-axis and `sessions` for the Y-axis. `unknown` represents historical events and older installed clients, not an additional detected language.

For a 30-day currency-selection chart:

```sql
select
  currency,
  count(*)::bigint as selections,
  count(distinct session_hash)::bigint as sessions
from private.analytics_events
where occurred_at >= current_date - 29
  and event_name = 'currency_selected'
group by currency
order by selections desc, currency;
```

In the SQL Editor chart, use `currency` for the X-axis and `selections` for the Y-axis. This measures deliberate selector changes, not the currencies of every activity: someone who keeps the preselected default does not generate a selection event.

To compare the usual hour of day rather than a chronological timeline:

```sql
select
  extract(hour from event_hour at time zone 'America/New_York')::integer as hour_of_day,
  sum(events)::bigint as events
from private.analytics_hourly
where event_hour >= now() - interval '30 days'
group by hour_of_day
order by hour_of_day;
```

For a seven-day local-versus-live summary:

```sql
select
  surface,
  event_name,
  count(*) as events,
  count(distinct session_hash) as sessions
from private.analytics_events
where occurred_at >= now() - interval '7 days'
group by surface, event_name
order by surface, event_name;
```

To see when people choose Live sharing, including attempts that do not finish creating a Live activity:

```sql
select
  occurred_at at time zone 'America/New_York' as clicked_at_local
from private.analytics_events
where event_name = 'live_share_clicked'
order by occurred_at desc
limit 100;
```

For an hour-of-day chart, aggregate the same event through the hourly view:

```sql
select
  extract(hour from event_hour at time zone 'America/New_York')::integer as hour_of_day,
  sum(events)::bigint as clicks
from private.analytics_hourly
where event_name = 'live_share_clicked'
  and event_hour >= now() - interval '30 days'
group by hour_of_day
order by hour_of_day;
```

To see how often people successfully add friends:

```sql
select
  surface,
  count(*)::bigint as additions,
  count(distinct session_hash)::bigint as sessions
from private.analytics_events
where event_name = 'friend_added'
  and occurred_at >= now() - interval '30 days'
group by surface
order by surface;
```

One submission can add several friends but counts as one addition event. Use `surface` to compare browser-local and Live activity additions.

To see balance-summary export frequency without exposing activity content:

```sql
with usage as (
  select
    count(*) filter (
      where occurred_at >= (
        date_trunc('day', now() at time zone 'America/New_York')
        at time zone 'America/New_York'
      )
    )::bigint as today_clicks,
    count(distinct session_hash) filter (
      where occurred_at >= (
        date_trunc('day', now() at time zone 'America/New_York')
        at time zone 'America/New_York'
      )
    )::bigint as today_sessions,
    count(*) filter (
      where occurred_at >= now() - interval '7 days'
    )::bigint as week_clicks,
    count(distinct session_hash) filter (
      where occurred_at >= now() - interval '7 days'
    )::bigint as week_sessions,
    count(*) filter (
      where occurred_at >= now() - interval '30 days'
    )::bigint as month_clicks,
    count(distinct session_hash) filter (
      where occurred_at >= now() - interval '30 days'
    )::bigint as month_sessions
  from private.analytics_events
  where event_name = 'summary_export_clicked'
)
select
  period as "Period",
  clicks as "Export clicks",
  sessions as "Sessions"
from usage
cross join lateral (
  values
    (1, 'Today', today_clicks, today_sessions),
    (2, 'Last 7 days', week_clicks, week_sessions),
    (3, 'Last 30 days', month_clicks, month_sessions)
) as periods(sort_order, period, clicks, sessions)
order by sort_order;
```

The saved **SplitBill - Summary Export Clicks** block in the **Home** report uses this text-first view. Repeated clicks count separately, while `Sessions` deduplicates the anonymous browser session within each period. This intentionally measures the action the person chose, even when native sharing is cancelled or image generation falls back to copied text.

These are anonymous sessions, not authenticated users. One person can create multiple sessions, a selected UI language is not proof of physical location, and offline or self-hosted development use is not measured.

## Retention and availability

Events older than 90 days are removed in bounded batches when an app-open event is recorded. The timestamp index keeps cleanup bounded as the table grows.

When a production build has no Supabase configuration, product analytics is disabled. Tally does not load a third-party page-view beacon. Development and test builds do not initialize first-party analytics by default.
