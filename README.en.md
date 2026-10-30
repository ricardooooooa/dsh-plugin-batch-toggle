# DSH Plugin Batch Toggle

Pause enabled third-party DeepSeek Harness plugins before updates, then restore the previous enabled set. Plugins that were already off remain off.

## Features

- Disable and restore controls in the shared Plugins header, including Discover and dshmarket tabs, and standalone dshmarket panels.
- A native batch-control tab and add-plugin menu actions as stable fallback entry points.
- Profile-local persistent recovery, serialized operations, per-package results and restart notices.
- Core, read-only, marketplace carrier and self protection; unfinished recovery cannot be overwritten.

The interface currently uses Chinese labels: **一键停用** (disable) and **一键启用** (restore).

## Install

Use the prebuilt `.tgz` in DSH's add-plugin dialog, or run:

```sh
dsh plugin --profile desktop add /absolute/path/dsh-plugin-batch-toggle-0.1.0.tgz
```

Enable the bundle in Plugins and restart if DSH requests it. End users do not need build tools. Registry-name installation is available only after npm publication.

Disable, wait for completion, update packages with the marketplace's existing workflow, then restore. Failed recovery entries remain available for retry. Removed packages are skipped, never reinstalled automatically.

Runtime verification targets DSH rc.3. Relevant manager and slot source contracts were checked as identical in rc.5; rc.5 was not separately runtime-tested. Declared range: `>=0.2.1-rc.3 <0.2.2-0`, Node24+.

DSH appends re-enabled bundles. Target order is preserved within this batch, but the full interleaving with protected bundles cannot be reproduced through the public API. Header integrations rely on DOM markers; the native tab/menu remain the stable fallback if host markup changes. Already disabled internal Cordis rows are never force-enabled.

State stays in `.dsh-plugin-batch-toggle/` inside the active profile. Endpoints use DSH's owner authentication and same-origin checks. No model key, telemetry, extra listener or upload is required.

## Development

Run `tooling/bootstrap.ps1`, then `tooling/pnpm.ps1 run check`, `release:pack`, and `test:integration`. Integration tests use an isolated profile and local fixture bundles.

See [release and community listing guidance](docs/RELEASE.md). MIT License.
