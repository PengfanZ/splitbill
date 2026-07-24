# First-party analytics

Tally measures a deliberately small set of anonymous product outcomes without uploading local activity data or exposing live-link capabilities to third-party JavaScript.

## Event contract

The browser may send only these event names:

- `app_opened`
- `activity_created`
- `expense_added`
- `live_activity_created`
- `live_activity_opened`
- `settlement_recorded`
- `currency_selected`

Each event also has exactly one surface (`local`, `live`, or `snapshot`) and one resolved app locale (`en` or `zh-CN`). `currency_selected` additionally includes one constrained ISO currency code from Tally’s supported list; every other event must omit it. The locale is the language Tally is currently displaying, including a saved manual choice; it is not a country, GPS coordinate, IP-derived location, or full browser-language fingerprint. The request contains a random 128-bit session token stored in browser session storage. The database stores only its SHA-256 hash, which supports within-session funnels without creating a persistent visitor profile.

Historical events and requests from older installed PWAs are stored as `unknown`. This avoids misclassifying legacy traffic as English while the new frontend version rolls out.

Do not add arbitrary metadata to this contract. Analytics must never receive URLs or fragments, activity codes, edit tokens, participant names or IDs, activity names, expense descriptions, amounts, balances, or snapshots.

## Request and storage boundary

`src/analytics.ts` sends events as non-blocking `fetch` requests with `keepalive`, omitted credentials, and no referrer. Failed analytics requests are ignored and never affect local or live workflows.

`public.record_analytics_event` is the only browser-callable database entry point. It validates the event, surface, locale, and session-token shape; applies hashed-IP throttling; hashes the session token; and inserts into `private.analytics_events`. Browser roles cannot read or write that table directly and cannot read `private.analytics_daily`, `private.analytics_hourly`, or `private.analytics_locale_daily`.

Opening the app records its initial surface. Successful product actions are measured only after their local state update or live revision save succeeds. A failed expense or settlement save does not produce a success event. Currency selection is intentionally an interaction event: it records a deliberate change in either currency selector, even if the person later cancels activity creation or a live update cannot be saved.

## Reports in Supabase

Run reports from **Supabase Dashboard → SQL Editor**. The daily aggregate is the default operational view:

```sql
select event_day, event_name, surface, events, sessions
from private.analytics_daily
order by event_day desc, event_name, surface;
```

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
  sum(events)::bigint as selections,
  sum(sessions)::bigint as sessions
from private.analytics_currency_daily
where event_day >= current_date - 29
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

These are anonymous sessions, not authenticated users. One person can create multiple sessions, a selected UI language is not proof of physical location, and offline or self-hosted development use is not measured.

## Retention and fallback

Events older than 90 days are removed in bounded batches when an app-open event is recorded. The timestamp index keeps cleanup bounded as the table grows.

When a production build has no Supabase configuration, the existing Cloudflare Web Analytics page-view beacon remains an optional fallback. It is always disabled on `#share=` and `#live=` URLs. Development and test builds do not initialize either analytics path by default.
