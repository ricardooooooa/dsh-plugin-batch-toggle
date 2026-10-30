# Marketplace submission handoff

Prepared on 2026-10-30 for [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin). **This is preparation only: no catalog PR has been submitted, npm publication has not occurred, and maintainer approval is not claimed.**

The target is the **dshmarket community catalog**. Official Discover's format 1 index additionally requires npm package identity, version and publication time. This tarball-only release is not eligible for that index; configuring it does not make this plugin discoverable there. References to the Discover header in the README describe an installed plugin's UI entry point, not catalog listing.

## Submission gate

The current [contribution rules](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) require a public implementation repository at least one day old, the `dsh-plugin` topic, suitable DSH manifest metadata, and a single catalog-entry file. npm publication is optional when a downloadable package is supplied.

GitHub reports this repository's creation time as **2026-10-30 04:54:13 UTC**. Its one-day threshold is **2026-10-31 04:54:13 UTC / 2026-10-31 12:54:13 Asia/Shanghai**. The age requirement therefore blocks submission on the preparation date. Passing that time alone does not establish eligibility or approval: recheck the upstream rules and the repository before submitting.

The catalog already contains update tools. Reviewers should assess this implementation on its concrete behavior: in-place plugin-manager/marketplace actions, official-SDK disabling only when needed, preservation of previously disabled state, sequential continuation after a failed item, and recovery across restarts including legacy v0.1 records. No first/only/safest comparison is claimed.

## Prepared entry and evidence

| Item | Prepared evidence |
| --- | --- |
| Repository | [ricardooooooa/dsh-plugin-batch-toggle](https://github.com/ricardooooooa/dsh-plugin-batch-toggle), public source, MIT license and `dsh-plugin` topic |
| Entry source | [`docs/community-entry.yml`](./community-entry.yml) |
| Exact destination | `data/plugins/ricardooooooa__dsh-plugin-batch-toggle.yml` |
| Entry fields | `url`, `name`, `category: market`, English/Chinese `description`, and version-pinned `tarball`; no invented npm field |
| Release | [v0.2.0](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/tag/v0.2.0), with a public [prebuilt `.tgz`](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/download/v0.2.0/dsh-plugin-batch-toggle-0.2.0.tgz) |
| Manifest | `dsh.bundle.patch: ./cordis.patch.yml`, with a real `dsh-plugin-batch-toggle` host insertion; browser declaration targets `web` |
| Prebuilt entry points | `lib/index.js`, `lib/client.js` and `cordis.patch.yml`; end users need no build tools |
| Runtime range | DSH `>=0.2.1-rc.5 <0.2.2-0`, Node.js `>=24.0.0` |
| Official peers | `@deepseek-ai/cordis: ~4.0.5`; `@deepseek-ai/dsh-client-connection` and `@deepseek-ai/dsh-plugin-manager`: `>=0.2.1-rc.5 <0.2.2-0` (both optional) |
| Screenshots | [`screenshots.json`](../screenshots.json) declares three rc.5 isolated-profile screenshots, displayed in both READMEs |
| Local validation | Type checking, 108 automated tests, frontend/backend builds and real rc.5 controlled-registry integration; [scope and limits](./VALIDATION.md) |

Released `.tgz` SHA-256:

```text
9f72801fde15fcfb0900c040a1b6cabead3096c9b10f4e84295fb6c329fdacac
```

These are local verification results and release-artifact evidence, not a claim that an upstream or GitHub Actions check has passed. Later documentation or workflow changes do not replace the already published archive.

## Steps for a future submission

1. Wait until the age threshold above, then reread upstream `contributing.md` and inspect the current entry schema/checks. Confirm that the repository is still public and has the `dsh-plugin` topic.
2. Download the fixed v0.2.0 asset, verify its SHA-256, and inspect its manifest, peer ranges and prebuilt files. Keep the published asset unchanged.
3. Copy `docs/community-entry.yml` to exactly `data/plugins/ricardooooooa__dsh-plugin-batch-toggle.yml` in a checkout of the catalog. Recheck descriptions and the download URL.
4. Run the catalog's current validation instructions. The PR should change only that entry file; do not edit generated READMEs or add custom npm fields.
5. Submit only when separately authorized. Use the draft below, resolve any actual validation or review feedback, and let maintainers decide inclusion. After merging, separately verify the dshmarket catalog's synchronization and client visibility. Official Discover distribution requires separate npm/index eligibility work.

## Prepared PR title

```text
feat: add ricardooooooa/dsh-plugin-batch-toggle
```

## Prepared PR body

```markdown
Add `ricardooooooa/dsh-plugin-batch-toggle` in the `market` category.

The plugin adds one sequential-update action directly to DSH plugin management and dshmarket. It uses the official SDK to disable eligible npm-installed third-party bundles only when needed, preserves previously disabled state, attempts rollback on a failed item, and continues after safe cleanup. Persistent recovery resumes interrupted runs across restarts and handles legacy v0.1 records.

- Source: https://github.com/ricardooooooa/dsh-plugin-batch-toggle
- Release: https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/tag/v0.2.0
- Prebuilt tarball: https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/download/v0.2.0/dsh-plugin-batch-toggle-0.2.0.tgz
- Tested baseline: DSH 0.2.1-rc.5; declared range `>=0.2.1-rc.5 <0.2.2-0`, Node.js 24+.
- Validation: local type checking, 108 automated tests, frontend/backend builds and a real rc.5 controlled-registry scenario covering update success, per-item failure with rollback/continuation, persistence, and disabled-state preservation. Full scope: https://github.com/ricardooooooa/dsh-plugin-batch-toggle/blob/main/docs/VALIDATION.md
- Three screenshots from an isolated test profile are declared in `screenshots.json` and displayed in the README.
- The package is not published to npm; this entry uses the version-pinned GitHub release tarball.

This PR adds only `data/plugins/ricardooooooa__dsh-plugin-batch-toggle.yml`. Rollback is best effort; self/core/marketplace/read-only and non-npm sources are excluded. No official certification or prior catalog approval is claimed.
```

Before using this body, update any facts that have changed and report only checks that actually ran. Do not present this prepared text as an existing PR.
