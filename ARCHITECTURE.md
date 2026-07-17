# Application architecture

Tally is local-first rather than frontend-only. Browser persistence powers private local activities, while an optional Supabase backend provides one canonical record for live activities. The codebase keeps those persistence modes and the financial domain separated clearly.

## Module boundaries

- `src/App.tsx` composes the application workflows and shell without owning persistence algorithms.
- `src/domain/` contains data models and pure member, money, settlement, and split helpers.
- `src/data/` owns the versioned local-storage schema and defensive serialization.
- `src/hooks/` connects focused React lifecycle behavior, such as analytics reporting, to application services.
- `src/components/` contains reusable application-shell components with no expense rules.
- `src/features/activity/` contains the activity dashboard, form workflows, and immutable local-state transitions.
- `src/features/liveSharing/liveActivityQuery.ts` decides whether a live refresh needs a full record or only a lightweight revision check.
- `src/features/liveSharing/useLiveActivitySession.ts` owns capability-URL synchronization, backend loading and saving, optimistic-conflict recovery, and local live shortcuts.
- `src/features/sharing/` owns text summaries, PNG generation, and browser sharing fallbacks.
- `src/pwa/` contains pure service-worker cache-manifest helpers, while `src/sw.ts` owns install, activation, and fetch lifecycle events.
- `src/analytics.ts` owns the typed, non-blocking first-party event client and frontend-only Cloudflare fallback.

Dependencies point inward: UI features may use domain and data utilities, while domain modules never import React or feature components. Imports are direct instead of routed through a barrel file.

## Persistence contract

The local-storage key remains `tally:frontend:v2`. Refactors must preserve this schema unless a deliberate migration is included and tested.

The current participant identity is stored separately under `tally:identity:v1`. Keeping it outside the activity schema avoids rewriting existing activity data when the user changes their display name.

Local activities continue to work when no Supabase environment variables are configured. A live activity is not duplicated into the local activity store: the browser saves only a shortcut and its capability, then loads the canonical state from Supabase.

## PWA and offline boundary

The production build generates an installable manifest, standard and maskable icons, and a versioned service worker under the configured Vite base path. The worker precaches only the static application shell and install assets. The large social preview image, cross-origin fonts, analytics requests, Supabase RPC responses, live activity data, and URL fragments are not stored in Cache Storage.

Same-origin precached assets are served by exact URL, with `Vary` ignored because every entry is a build-controlled immutable asset. Any same-origin request that is not already in the versioned precache goes to the network and is not added at runtime. Navigation falls back to the cached `index.html`, allowing browser-local activities from `localStorage` to render offline; live activities still require the network to load or synchronize. New service workers wait until existing app tabs close instead of forcing a reload that could interrupt an expense form.

Safari does not reliably route ordinary HTTPS links into an installed Home Screen web app. Tally handles that boundary explicitly: a shared activity opened in a browser can copy its full fragment-bearing URL, and the installed app's **Join activity** flow validates the live capability or snapshot before applying only its fragment to the current PWA session. The capability remains client-side and is not placed in a query string or sent through an intermediate handoff service.

## URL-state sharing experiment

`shareActivityUrl.ts` defines a versioned activity snapshot independent of the local-storage schema. New snapshots use an LZ-compressed `#share=z.…` payload, while the decoder retains compatibility with earlier base64url links. It validates every member, expense, relationship, and split before rendering a shared URL. Shared fragments open read-only, do not write to local storage, and suppress third-party analytics; first-party measurement receives only the `snapshot` surface. Saving requires the recipient to choose their participant, remaps that participant to `me`, and creates new IDs for every other imported entity so copies cannot overwrite existing records.

URL state is a transport rather than synchronization: every edit produces a new snapshot, and there is no canonical latest version or automatic conflict resolution.

## Live-sharing backend

Supabase stores the canonical live activity. A short activity code identifies the row, while a secret edit token in the URL fragment grants read/write access. The database stores only a SHA-256 hash of that token. Every update supplies an expected revision and increments it atomically, preventing silent last-write-wins data loss.

`src/features/liveSharing/` owns the typed API, URL, configuration, and versioned browser-shortcut contracts. `supabase/` contains RLS-protected private storage, hashed-IP request throttling, expiring activity rows, narrow security-definer RPC wrappers, and pgTAP security tests. Browser roles cannot query the private schema or execute private functions directly.

The frontend treats Supabase as canonical whenever a live capability is active. Local shortcut rows contain only navigation metadata and credentials; they are never a second writable activity copy. Live capabilities are trusted-group bearer credentials rather than user authorization. See `docs/LIVE_SHARING_EXPERIMENT.md` and `docs/DEPLOYMENT.md` before changing this boundary.

## Analytics boundary

The configured production build sends a fixed event enum through `public.record_analytics_event`. Local activities remain entirely in browser storage; recording a local event never uploads the activity itself. The browser sends only the event name, coarse surface, and a random session-scoped token. The database stores a SHA-256 hash of that token in `private.analytics_events`, and browser roles have no table or aggregate-view access.

The RPC validates every value, applies the existing hashed-IP throttle, and incrementally deletes events older than 90 days. Private daily and hourly aggregates support event counts and anonymous session funnels. Third-party Cloudflare analytics is a fallback only for frontend-only production builds and never executes on `#share=` or `#live=` URLs. See `docs/ANALYTICS.md` before adding events or properties.

## Change contract

Put financial calculations in pure domain helpers, browser APIs behind data or feature boundaries, and component-specific state beside the component that owns it. Every behavior change still follows the test requirements in `TESTING.md`.

Equal expenses store shares only for the selected participants. This keeps partial-group splits compatible with the existing expense schema and lets expense history display the participant count without a separate membership field.

Settlement payments use the same transaction shape with `kind: "settlement"`: the payer is the person sending money and the single share belongs to the recipient. This lets the balance engine account for repayments without a parallel ledger. Spending summaries and exports exclude settlement amounts from total spending while preserving the payment in activity history, URL snapshots, and live Supabase state.
