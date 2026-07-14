# Privacy note

Tally is designed for small trusted groups.

## Data stored in your browser

Your display name, local activities, saved live shortcuts, friends, and expenses are stored in browser local storage. Clearing site data removes that browser's local copy and shortcuts.

## Data stored for live activities

When someone chooses **Share live**, the activity name, participant names, expenses, splits, and sender identity are stored in the configured Supabase project. The backend stores a one-way hash of the secret edit token, not the token itself. Live activities expire 90 days after their most recent successful update.

Anyone with the complete live URL can read and edit the activity. Share it only with intended participants. Removing a shortcut from one browser does not delete the backend activity for everyone.

## Abuse protection and analytics

The backend rate-limits requests using a one-way hash of the client IP address; the raw address is not stored in the application rate-limit table. Production builds with live sharing enabled do not load the third-party Cloudflare analytics script because it could observe capability URLs in the browser.

## Scope

Tally has no accounts, advertising, payment processing, or sale of activity data. Avoid entering regulated or highly sensitive financial information. Security concerns can be reported through the private process in [SECURITY.md](SECURITY.md).
