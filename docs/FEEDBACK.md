# In-app feedback

Tally keeps GitHub available for contributors, but ordinary users can rate the experience or send a short note without leaving the current activity. **Send feedback** opens a compact, bilingual dialog in the sidebar. After a successful share, Tally may also show a small one-tap rating prompt. It appears only after the share completes, can be dismissed, and is shown at most once per release on one browser.

A successful submission closes the prompt or dialog, preserves the activity state, and confirms success with a non-blocking status message.

## Data boundary

The browser sends exactly six fields to `public.submit_feedback`:

- category: `general`, `idea`, or `problem`;
- message: optional trimmed text between 3 and 1,000 characters;
- locale: `en` or `zh-CN`;
- rating: an optional integer from 1 through 5;
- surface: `local` or `live`;
- release: the allowlisted Tally release label.

Every submission must contain a rating, a message, or both. The request never includes an activity name or ID, participant, expense, amount, balance, URL, Live activity code, capability token, analytics session token, or contact identity. Because feedback is anonymous, maintainers cannot reply directly unless the person separately opens a GitHub discussion or issue.

The once-per-release prompt state is stored only in browser local storage under `tally:feedback-rating-prompt:v1`. It is not an analytics identifier and is never uploaded.

## Storage and abuse controls

`private.feedback_submissions` has row-level security enabled and no browser, authenticated, or service-role table grants. Browser clients can call only the validated public RPC; they cannot list, edit, or delete submissions.

The RPC uses the existing secret-peppered request identifier to allow up to five attempts per ten minutes and twenty per day for one network. Raw IP addresses and reusable unpeppered hashes are not stored. Rejected attempts remain counted, while only valid, allowed messages are inserted.

## Reviewing feedback

Project administrators can use the Supabase SQL Editor:

```sql
select
  created_at,
  category,
  rating,
  message,
  locale,
  surface,
  release
from private.feedback_submissions
order by created_at desc
limit 100;
```

For a simple daily rating trend:

```sql
select
  created_at::date as day,
  round(avg(rating), 2) as average_rating,
  count(*) as ratings
from private.feedback_submissions
where rating is not null
group by day
order by day desc;
```

Do not expose this table or query through the Data API. If a public feedback dashboard is added later, aggregate and redact it through a separate reviewed view rather than granting access to the raw messages.
