# In-app feedback

Tally keeps GitHub available for contributors, but ordinary users can rate the experience or send a short note without leaving the current activity. **Send feedback** opens a compact, bilingual dialog in the sidebar. A small optional rating prompt also appears after a successful share (once per release), the first completed CSV export, or the first AI attempt.

The AI invitation is shared across text, voice, and receipt entry. It is queued when an AI request finishes, whether it produces a draft, asks for clarification, or fails. It waits until the expense dialog and other overlays are closed, so it never covers a draft or interrupts follow-up answers. Merely selecting an AI tab, recording without submitting, or entering an expense manually does not trigger it. Feedback remains available even if product analytics is disabled.

Selecting stars does not submit or close the prompt. Users can send only the rating, add a note with a **Problem** or **Idea** category, or dismiss it. No rating is required to write a note. Closing the AI invitation or opening its full feedback form marks that invitation handled for this browser, independent of app releases. When storage is unavailable, it is still suppressed for the current app session after dismissal.

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

Prompt state is stored only in browser local storage: `tally:feedback-rating-prompt:v1` for sharing, `tally:feedback-rating-prompt:csv-export:v1` for CSV, and `tally:feedback-rating-prompt:ai:v1` for AI. These flags are not analytics identifiers and are never uploaded. Existing users are eligible for the AI invitation on their next attempt because earlier AI usage was not stored as a first-use flag.

After the feedback RPC succeeds, Tally separately records one `feedback_submitted` product event. That analytics event contains only its allowlisted event name, the local/Live surface, the displayed app locale, and a one-way session hash. It never contains the rating, category, message, release, or activity data. Cancelled and rejected submissions do not create the event.

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
