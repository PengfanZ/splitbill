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

Each event also has exactly one surface: `local`, `live`, or `snapshot`. The request contains a random 128-bit session token stored in browser session storage. The database stores only its SHA-256 hash, which supports within-session funnels without creating a persistent visitor profile.

Do not add arbitrary metadata to this contract. Analytics must never receive URLs or fragments, activity codes, edit tokens, participant names or IDs, activity names, expense descriptions, amounts, balances, or snapshots.

## Request and storage boundary

`src/analytics.ts` sends events as non-blocking `fetch` requests with `keepalive`, omitted credentials, and no referrer. Failed analytics requests are ignored and never affect local or live workflows.

`public.record_analytics_event` is the only browser-callable database entry point. It validates the event, surface, and session-token shape; applies hashed-IP throttling; hashes the session token; and inserts into `private.analytics_events`. Browser roles cannot read or write that table directly and cannot read `private.analytics_daily`.

Opening the app records its initial surface. Successful product actions are measured only after their local state update or live revision save succeeds. A failed expense or settlement save does not produce a success event.

## Reports in Supabase

Run reports from **Supabase Dashboard → SQL Editor**. The daily aggregate is the default operational view:

```sql
select event_day, event_name, surface, events, sessions
from private.analytics_daily
order by event_day desc, event_name, surface;
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

These are anonymous sessions, not authenticated users. One person can create multiple sessions, and offline or self-hosted development use is not measured.

## Retention and fallback

Events older than 90 days are removed in bounded batches when an app-open event is recorded. The timestamp index keeps cleanup bounded as the table grows.

When a production build has no Supabase configuration, the existing Cloudflare Web Analytics page-view beacon remains an optional fallback. It is always disabled on `#share=` and `#live=` URLs. Development and test builds do not initialize either analytics path by default.
