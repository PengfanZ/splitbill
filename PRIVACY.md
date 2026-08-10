# Privacy note

Tally is designed for small trusted groups.

## Data stored in your browser

Your display name, local activities, saved live shortcuts, friends, and expenses are stored in browser local storage. A random analytics session token is stored separately in session storage and disappears when the browser session ends. Clearing site data removes that browser's local copy and shortcuts.

The selected language is also stored locally. Automatic language selection reads only the browser's language preferences and device time-zone name. Tally does not request GPS access or send locale or time-zone data to an IP-location service. Expense times are formatted on the device in the browser's current time zone.

When Tally is installed as a PWA, Cache Storage contains only versioned static application files and install icons. The service worker does not cache local activity records, live activity responses, Supabase requests, analytics payloads, shared URL fragments, or the social preview image.

## Data stored for live activities

When someone chooses **Share live**, the activity name, participant names, expenses, splits, and sender identity are stored in the configured Supabase project. The backend stores a one-way hash of the secret edit token, not the token itself. Live activities expire 90 days after their most recent successful update.

Anyone with the complete live URL can read and edit the activity. Share it only with intended participants. Removing a shortcut from one browser does not delete the backend activity for everyone.

## Abuse protection and analytics

The backend rate-limits requests using a secret-peppered one-way identifier derived from the client IP address; neither the raw address nor an unpeppered IP hash is stored in the application rate-limit table.

Production records a small allowlist of first-party product events for both local and live workflows. Each current event contains only an event name, a coarse `local` or `live` surface, a one-way hash of the session token, and the event time; historical rows may retain the retired `snapshot` surface. Analytics never receives a page URL or fragment, activity code, edit token, participant identity, activity name, expense description, amount, balance, or activity state. Event rows expire after 90 days. Browser roles can write through a validated, rate-limited RPC but cannot read analytics events or reports.

Tally does not load a third-party analytics beacon. A deployment without Supabase analytics configuration simply records no product analytics.

## Feedback submissions

The in-app feedback flow sends an optional 1–5 rating, the text a person intentionally writes, one selected category, the app language, the coarse `local` or `live` surface, and a release label to a private Supabase table. It does not attach an activity name or ID, participant, expense, amount, balance, page URL, Live capability, analytics session token, or contact identity. Browser roles can submit through a validated, rate-limited RPC but cannot read stored feedback.

Whether the post-share rating prompt has already been handled for the current release is stored only in local storage. That value is not uploaded and contains no activity information.

Feedback attempts share the same secret-peppered network abuse protection described above. The feedback row itself contains no network identifier, so separate messages cannot be linked through the stored feedback data.

## Scope

Tally has no accounts, advertising, payment processing, or sale of activity data. Avoid entering regulated or highly sensitive financial information. Security concerns can be reported through the private process in [SECURITY.md](SECURITY.md).
