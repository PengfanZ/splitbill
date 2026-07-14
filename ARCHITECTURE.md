# Application architecture

Tally is local-first rather than frontend-only. Browser persistence powers private local activities, while an optional Supabase backend provides one canonical record for live activities. The codebase keeps those persistence modes and the financial domain separated clearly.

## Module boundaries

- `src/App.tsx` composes local activity actions, sharing surfaces, and the application shell.
- `src/domain/` contains data models and pure member, money, settlement, and split helpers.
- `src/data/` owns the versioned local-storage schema and defensive serialization.
- `src/hooks/` connects React lifecycle behavior to the persistence layer.
- `src/components/` contains reusable application-shell components with no expense rules.
- `src/features/activity/` contains the activity dashboard and activity form workflows.
- `src/features/liveSharing/useLiveActivitySession.ts` owns capability-URL synchronization, backend loading and saving, optimistic-conflict recovery, and local live shortcuts.
- `src/features/sharing/` owns text summaries, PNG generation, and browser sharing fallbacks.

Dependencies point inward: UI features may use domain and data utilities, while domain modules never import React or feature components. Imports are direct instead of routed through a barrel file.

## Persistence contract

The local-storage key remains `tally:frontend:v2`. Refactors must preserve this schema unless a deliberate migration is included and tested.

The current participant identity is stored separately under `tally:identity:v1`. Keeping it outside the activity schema avoids rewriting existing activity data when the user changes their display name.

Local activities continue to work when no Supabase environment variables are configured. A live activity is not duplicated into the local activity store: the browser saves only a shortcut and its capability, then loads the canonical state from Supabase.

## URL-state sharing experiment

`shareActivityUrl.ts` defines a versioned activity snapshot independent of the local-storage schema. New snapshots use an LZ-compressed `#share=z.…` payload, while the decoder retains compatibility with earlier base64url links. It validates every member, expense, relationship, and split before rendering a shared URL. Shared fragments open read-only, do not write to local storage, and suppress analytics. Saving requires the recipient to choose their participant, remaps that participant to `me`, and creates new IDs for every other imported entity so copies cannot overwrite existing records.

URL state is a transport rather than synchronization: every edit produces a new snapshot, and there is no canonical latest version or automatic conflict resolution.

## Live-sharing backend

Supabase stores the canonical live activity. A short activity code identifies the row, while a secret edit token in the URL fragment grants read/write access. The database stores only a SHA-256 hash of that token. Every update supplies an expected revision and increments it atomically, preventing silent last-write-wins data loss.

`src/features/liveSharing/` owns the typed API, URL, configuration, and versioned browser-shortcut contracts. `supabase/` contains RLS-protected private storage, hashed-IP request throttling, expiring activity rows, narrow security-definer RPC wrappers, and pgTAP security tests. Browser roles cannot query the private schema or execute private functions directly.

The frontend treats Supabase as canonical whenever a live capability is active. Local shortcut rows contain only navigation metadata and credentials; they are never a second writable activity copy. Live capabilities are trusted-group bearer credentials rather than user authorization. See `docs/LIVE_SHARING_EXPERIMENT.md` and `docs/DEPLOYMENT.md` before changing this boundary.

## Change contract

Put financial calculations in pure domain helpers, browser APIs behind data or feature boundaries, and component-specific state beside the component that owns it. Every behavior change still follows the test requirements in `TESTING.md`.

Equal expenses store shares only for the selected participants. This keeps partial-group splits compatible with the existing expense schema and lets expense history display the participant count without a separate membership field.

Settlement payments use the same transaction shape with `kind: "settlement"`: the payer is the person sending money and the single share belongs to the recipient. This lets the balance engine account for repayments without a parallel ledger. Spending summaries and exports exclude settlement amounts from total spending while preserving the payment in activity history, URL snapshots, and live Supabase state.
