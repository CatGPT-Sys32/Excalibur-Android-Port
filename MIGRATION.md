# Local Excalidraw Vendoring Migration

Date: 2026-04-15

## Privacy guardrails used for this migration

- Work was performed locally only.
- No GitHub fork was created in this workflow.
- No new public remote was added in this workflow.
- No push was performed as part of this migration.

## Safety checkpoints

- Safety branch: `migration/local-excalidraw-fork-2026-04-15`
- Backup tag (annotated): `backup-pre-excalidraw-local-migration-2026-04-15`

## Upstream source pin

- Upstream repository: `https://github.com/excalidraw/excalidraw.git`
- Pinned upstream commit SHA used for vendored source:
  - `1caec99b290c75cda05385e637138998807a65ae`

This SHA is intentionally pinned so future updates are explicit and reproducible.

## What was vendored

Vendored paths in this app repository:

- `vendor/excalidraw`
- `vendor/common`
- `vendor/math`
- `vendor/element`
- `vendor/LICENSE.UPSTREAM`
- `vendor/ATTRIBUTION.md`

Why this scope:

- Package-only vendoring of `@excalidraw/excalidraw` was tried first.
- It failed because internal `@excalidraw/*` package versions required by this pinned upstream state were not resolvable directly from the registry.
- The minimal expanded local scope required for a clean build was `excalidraw + common + math + element`.

## What stayed as app wrapper code

Wrapper and Android project structure remain app-owned.

Core wrapper/app files stayed in place:

- `src/App.tsx`
- `src/main.tsx`
- `src/lib/androidBridge.ts`
- `src/lib/capacitor.ts`
- `src/lib/persistence.ts`
- `android/*`

Minimal compatibility edits were applied in `src/App.tsx` only:

- `excalidrawAPI` prop updated to `onExcalidrawAPI`
- free-draw point literals cast to current branded point type
- removed deprecated `lastCommittedPoint` assignment

These edits are type/API compatibility updates and are not intended to change wrapper behavior.

## Dependency rewiring details

Root dependency switched to local vendored Excalidraw package:

- In `package.json`:
  - `"@excalidraw/excalidraw": "file:vendor/excalidraw"`

Vendored internal package links were made local:

- `vendor/excalidraw/package.json`
  - `@excalidraw/common -> file:../common`
  - `@excalidraw/element -> file:../element`
  - `@excalidraw/math -> file:../math`
- `vendor/element/package.json`
  - `@excalidraw/common -> file:../common`
  - `@excalidraw/math -> file:../math`
- `vendor/math/package.json`
  - `@excalidraw/common -> file:../common`

Asset sync logic was updated to prefer vendored artifacts first:

- `scripts/sync-excalidraw-assets.mjs`
  - checks `vendor/excalidraw/dist/prod` first
  - falls back to `node_modules/@excalidraw/excalidraw/dist/prod`

## Local validation run

Executed locally and passed:

1. `npm install`
2. `npm run sync:excalidraw-assets`
3. `npm run build`
4. `npm run android:sync`
5. `npm run android:build:debug`

Result: web build succeeded and Android debug build completed (`BUILD SUCCESSFUL`).

## How to update vendored upstream later

1. Create a new safety branch and backup tag before changes.
2. Clone upstream to a temporary local directory.
3. Checkout the exact target commit SHA you want to adopt.
4. Build required upstream packages in the temp clone:
   - `@excalidraw/common`
   - `@excalidraw/math`
   - `@excalidraw/element`
   - `@excalidraw/excalidraw`
5. Replace these local vendor folders from the temp clone:
   - `vendor/common`, `vendor/math`, `vendor/element`, `vendor/excalidraw`
6. Keep local `file:` dependency rewiring in vendor package manifests.
7. Run validation pipeline:
   - `npm install`
   - `npm run sync:excalidraw-assets`
   - `npm run build`
   - `npm run android:sync`
   - `npm run android:build:debug`
8. If upstream API/type changes break wrapper typing, keep compatibility edits minimal and behavior-preserving.

## Rollback instructions

To return to pre-migration state:

1. Inspect rollback point:
   - `git show backup-pre-excalidraw-local-migration-2026-04-15 --no-patch`
2. Create a rollback branch from backup tag:
   - `git switch -c rollback/pre-local-vendoring backup-pre-excalidraw-local-migration-2026-04-15`

Or move the migration branch pointer back to the backup tag if explicitly desired:

- `git switch -C migration/local-excalidraw-fork-2026-04-15 backup-pre-excalidraw-local-migration-2026-04-15`
