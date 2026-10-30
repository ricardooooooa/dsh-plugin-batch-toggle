# rc.5 one-click update plan

Spec: ../specs/2026-10-30-rc5-one-click-update.md

- [x] Runtime: discover actual rc.5 installation, upgrade pinned development SDKs, preserve isolated homes.
- [x] Engine: separate persistent update journal, shared lock, npm-only official adapter, sequential failure continuation and best-effort rollback; old-snapshot migration.
- [x] UI: one primary action, current package/stage and per-item version/result; bounded HTTP and clear recovery/error states.
- [x] Integration: real SDK with controlled local registry, failed middle item, rollback and disabled-state preservation; actual rc.5 page verification.
- [x] Release/install: v0.2.0 package, updated screenshots/docs, independent review, update only this plugin in desktop profile with backup.

Final evidence: 108 passing automated tests, typecheck/build, real rc.5 registry integration and UI checks. GitHub v0.2.0 asset verified by SHA-256. Desktop installation changed only this plugin; other installed versions, selection, configuration and the v0.1 recovery snapshot were preserved. No real bulk update was triggered.
