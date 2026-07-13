# Frontend architecture

Tally keeps browser persistence and product behavior small enough for a frontend-only release while separating responsibilities clearly.

## Module boundaries

- `src/App.tsx` coordinates selected activity state, user actions, and feature composition.
- `src/domain/` contains data models and pure member, money, settlement, and split helpers.
- `src/data/` owns the versioned local-storage schema and defensive serialization.
- `src/hooks/` connects React lifecycle behavior to the persistence layer.
- `src/components/` contains reusable application-shell components with no expense rules.
- `src/features/activity/` contains the activity dashboard and activity form workflows.
- `src/features/sharing/` owns text summaries, PNG generation, and browser sharing fallbacks.

Dependencies point inward: UI features may use domain and data utilities, while domain modules never import React or feature components. Imports are direct instead of routed through a barrel file.

## Persistence contract

The local-storage key remains `tally:frontend:v2`. Refactors must preserve this schema unless a deliberate migration is included and tested.

The current participant identity is stored separately under `tally:identity:v1`. Keeping it outside the activity schema avoids rewriting existing activity data when the user changes their display name.

## URL-state sharing experiment

`shareActivityUrl.ts` defines a versioned activity snapshot independent of the local-storage schema. New snapshots use an LZ-compressed `#share=z.…` payload, while the decoder retains compatibility with earlier base64url links. It validates every member, expense, relationship, and split before rendering a shared URL. Shared fragments open read-only, do not write to local storage, and suppress analytics. Saving requires the recipient to choose their participant, remaps that participant to `me`, and creates new IDs for every other imported entity so copies cannot overwrite existing records.

URL state is a transport rather than synchronization: every edit produces a new snapshot, and there is no canonical latest version or automatic conflict resolution.

## Change contract

Put financial calculations in pure domain helpers, browser APIs behind data or feature boundaries, and component-specific state beside the component that owns it. Every behavior change still follows the test requirements in `TESTING.md`.

Equal expenses store shares only for the selected participants. This keeps partial-group splits compatible with the existing expense schema and lets expense history display the participant count without a separate membership field.
