# Changelog

## [0.2.0](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/tag/v0.2.0) — 2026-10-30

- Replace separate disable/restore buttons with one **一键更新** action in plugin management and dshmarket, plus a native detailed-results tab and menu entry.
- Update eligible npm-installed third-party bundles sequentially: check, disable if needed, remove, install, restore enabled intent and verify. Previously disabled bundles remain disabled.
- Record per-item failures, attempt rollback to the previous version and continue after safe cleanup. Persist unfinished recovery work across restarts and resume legacy v0.1 snapshots.
- Add a stop action that waits for the current item to settle or roll back. Exclude self, marketplace/core/read-only bundles and unsupported non-npm sources.
- Target and validate against DSH 0.2.1-rc.5 (`>=0.2.1-rc.5 <0.2.2-0`, Node.js 24+). Remove the duplicate header action from the detailed tab.
- Local validation: type checking, 108 automated tests, frontend/backend builds, and real rc.5 controlled-registry update/rollback/state-preservation tests. See [validation details](./docs/VALIDATION.md).

## [0.1.0](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/tag/v0.1.0) — 2026-10-30

- Initial prebuilt release with **一键停用 / 一键启用** controls in plugin management and dshmarket, a native detailed tab and an add-plugin menu entry.
- Save the currently enabled third-party bundle selection before disabling; restore that selection while keeping previously disabled bundles off.
- Persist recovery records across restarts, retain failed recovery items and exclude core/read-only bundles, marketplace carriers and self.
- Validate the initial runtime against DSH 0.2.1-rc.3. Updating packages remained a separate manual step; v0.2.0 replaces that workflow with sequential updates.