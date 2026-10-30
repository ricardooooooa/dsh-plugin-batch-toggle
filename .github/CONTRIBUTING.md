# Contributing

Use Node.js 24 and the project-pinned pnpm version. The development SDK and verified runtime baseline are DSH 0.2.1-rc.5.

```powershell
./tooling/bootstrap.ps1
./tooling/pnpm.ps1 run check
```

`check` typechecks, runs the automated tests, and builds both host and browser modules. GitHub CI runs this on Windows and checks the contents of a fresh prebuilt package. Real DSH integration tests are separate because they require a matching desktop installation:

```powershell
./tooling/pnpm.ps1 run release:pack
./tooling/pnpm.ps1 run test:integration:updates
```

Use the isolated homes and test profile provided by the integration tooling. For updater changes, cover failure continuation, original disabled state, best-effort rollback, persistent recovery and npm-source protection. For UI changes, check manager, marketplace and the native detail tab without duplicating the primary action.

Describe the problem, resulting behavior and relevant validation in a pull request. Keep runtime/API support claims consistent with actual tests. Official DSH runtime packages belong in peer dependencies; browser builds consume the host's shared React instance.

Release packaging and marketplace submission instructions are in [docs/RELEASE.md](../docs/RELEASE.md) and [docs/marketplace-submission.md](../docs/marketplace-submission.md). Published tarballs and checksums are immutable; source documentation may improve after a release.
