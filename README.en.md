# DSH Plugin Batch Toggle · One-click plugin updates

One **Update all** action checks DeepSeek Harness plugins, temporarily disables each eligible package when needed, updates it, and restores its enabled intent. There is no separate disable-everything step.

The current interface uses Chinese labels: **一键更新** means Update all, **停止更新** means Stop updates, and **批量更新** is the detailed update tab.

## Use

Open Plugins or dshmarket and select **一键更新**. Packages are processed serially. A definite per-package failure is recorded and, after safe cleanup, processing continues with the remaining packages. The same button becomes **停止更新** while running; stopping waits for the current item to settle or roll back.

Packages that were already disabled remain disabled. Existing v0.1 recovery records are handled first using their saved enabled intent, so the single update action can resume unfinished work.

The shared Plugins header covers Installed, Discover and dshmarket tabs. Standalone dshmarket settings/sidebar panels also get the action. The native **批量更新** tab and add-plugin menu provide fallback entry points.

## Supported packages and update policy

- Manageable third-party bundles installed from an npm registry under their own package name.
- Self, marketplace carriers, official/core bundles, read-only and unmanageable packages are excluded.
- Git, local file/link, tarball/URL and npm alias sources are skipped rather than replaced by a same-named registry package. Exclusions and reasons are available in the detailed view.

Each item is checked, temporarily disabled if needed, removed, installed, and verified with its enabled intent restored. Updates use the official DSH plugin-management SDK and do not rely on marketplace auto-enablement.

The queried `latest` version is a reference. Installation respects the official registry configuration, compatibility checks, script approval and `minimumReleaseAge` policy; the newest release may not yet be eligible. Results distinguish the previous version, queried latest version, installed version and current enabled state.

## Failure and recovery

Failed installation or verification triggers a best-effort reinstall of the previous version and restoration of enabled intent. Results and unresolved recovery responsibility persist independently of legacy recovery records. A later one-click update prioritizes the unfinished items from the previous run.

Rollback can fail and cannot guarantee reversal of third-party install scripts, data changes or runtime effects. Unresolved items remain explicitly marked. Restart requirements are displayed; the plugin does not restart DSH automatically.

## Install or upgrade

Runtime baseline: **DSH 0.2.1-rc.5**. Declared range: `>=0.2.1-rc.5 <0.2.2-0`, Node.js 24+.

Download the published v0.2.0 prebuilt `.tgz` from [GitHub Releases](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases) and enter its absolute path or published asset URL in Plugins → Add Plugin. The Release page determines which artifacts are available. End users do not need build tools.

Upgrade this plugin through DSH's package installation/update flow: the batch updater excludes itself. For desktop-profile CLI installation, fully exit Desktop and use the CLI bundled with that same rc.5 installation. Registry-name installation depends on actual npm publication.

Header integration uses DOM markers; the native tab and menu remain the fallback if host markup changes. Public DSH enablement appends a bundle, so the complete original interleaving and precedence with preserved bundles cannot be guaranteed. Disabled internal Cordis rows are not force-enabled.

Records stay in `.dsh-plugin-batch-toggle/` within the active profile. Endpoints use owner authentication and same-origin protection. There is no additional listener or model-key requirement. This plugin does not upload conversations; package lookup and installation contact the configured registry.

## Development and verification

The development launcher discovers a matching rc.5 installation, with explicit paths available in `config/development.json`.

```powershell
./tooling/bootstrap.ps1
./tooling/pnpm.ps1 run check
./tooling/pnpm.ps1 run release:pack
./tooling/pnpm.ps1 run test:integration:updates
```

The rc.5 controlled-registry integration verified successful A/C/D updates, failed B installation with rollback, continued processing, and D remaining disabled without executing. It uses an isolated profile and does not update the user's normal plugin collection. See [validation scope](docs/VALIDATION.md).

Screenshots are stored under `docs/screenshots/` and declared in `screenshots.json`.

See [release and community listing guidance](docs/RELEASE.md). MIT License.
