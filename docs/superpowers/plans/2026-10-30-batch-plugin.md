# DSH Batch Plugin Implementation Plan

> **For agentic workers:** Use focused parallel implementation and a fresh final code review. Track progress here.

**Goal:** Produce an installable DSH plugin with disable/restore controls in plugin management and market screens.

**Architecture:** Persistent, mutually exclusive batch state machine consumes the official manager. Authenticated connection Fetch routes start asynchronous jobs; React slots and owned DOM portals expose controls.

**Tech Stack:** TypeScript6, React18, Cordis4, DSH rc.3 SDK, esbuild, Node test runner.

**Spec:** ../specs/2026-10-30-batch-plugin-design.md

## Global Constraints

- Real desktop profile and credentials remain outside testing; only .dev isolated profile is mounted.
- Restore previously enabled targets only; skip core, market carrier and self; respect readOnlyReason.
- Save snapshot before mutation; serialize operations; retain incomplete recovery.
- Range >=0.2.1-rc.3 <0.2.2-0; runtime verification rc.3.
- Do not publish or submit to external accounts in this implementation phase.

## Review Focus

- Crash between persisted intent and HMR completion must remain recoverable.
- Repeated clicks and multiple profiles/processes must not overwrite recovery.
- Unauthenticated and cross-origin POSTs must not mutate plugins.
- Market switching/unmount must not duplicate buttons or keep observers/roots.
- A partial failure or restart requirement must remain visible as such.

## Tasks

- [x] 1. Engine and atomic profile-scoped store: tests first for filtering, restore, partial failure, restart, corruption, concurrency and crash recovery; implement src/engine.ts, src/store.ts and tests.
- [x] 2. Host and UI: authenticated async jobs; native management tab/menu and header/market portals with disposal; test routes, rendering and DOM transitions.
- [x] 3. Packaging and integration: real cordis.patch.yml, compatible metadata, release tgz, isolated install and operation tests with fixture bundles; verify package contents.
- [x] 4. Final review, documentation, submission checklist and release evidence; resolve material findings before delivery.

## Completion evidence

43/43 tests, TypeScript and builds pass. Prebuilt release installed and exercised with dshmarket in isolated rc.3; real UI disable/restore and screenshots verified. Independent material findings fixed with regression tests. Public publication remains a separate action.
