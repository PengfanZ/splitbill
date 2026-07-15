# Privacy note

Tally is designed for small trusted groups.

## Data stored in your browser

Your display name, local activities, saved live shortcuts, friends, and expenses are stored in browser local storage. A random analytics session token is stored separately in session storage and disappears when the browser session ends. Clearing site data removes that browser's local copy and shortcuts.

When Tally is installed as a PWA, Cache Storage contains only versioned static application files and install icons. The service worker does not cache local activity records, live activity responses, Supabase requests, analytics payloads, shared URL fragments, or the social preview image.

## Data stored for live activities

When someone chooses **Share live**, the activity name, participant names, expenses, splits, and sender identity are stored in the configured Supabase project. The backend stores a one-way hash of the secret edit token, not the token itself. Live activities expire 90 days after their most recent successful update.

Anyone with the complete live URL can read and edit the activity. Share it only with intended participants. Removing a shortcut from one browser does not delete the backend activity for everyone.

## Abuse protection and analytics

The backend rate-limits requests using a one-way hash of the client IP address; the raw address is not stored in the application rate-limit table.

Production records a small allowlist of first-party product events for both local and live workflows. Each event contains only an event name, a coarse `local`, `live`, or `snapshot` surface, a one-way hash of the session token, and the event time. Analytics never receives a page URL or fragment, activity code, edit token, participant identity, activity name, expense description, amount, balance, or activity snapshot. Event rows expire after 90 days. Browser roles can write through a validated, rate-limited RPC but cannot read analytics events or reports.

Frontend-only production builds may use Cloudflare Web Analytics on ordinary app pages. The third-party beacon is always suppressed on `#share=` and `#live=` URLs so it cannot observe shared state or capability tokens.

## Scope

Tally has no accounts, advertising, payment processing, or sale of activity data. Avoid entering regulated or highly sensitive financial information. Security concerns can be reported through the private process in [SECURITY.md](SECURITY.md).
