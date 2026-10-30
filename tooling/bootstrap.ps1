$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    New-Item -ItemType Directory -Force -Path '.tooling' | Out-Null
    & npm.cmd install --prefix .tooling --ignore-scripts --no-audit --no-fund --save-exact pnpm@11.28.5
    if ($LASTEXITCODE -ne 0) { throw 'Could not install project-local pnpm.' }
    if (Test-Path -LiteralPath 'pnpm-lock.yaml') {
        & node '.tooling/node_modules/pnpm/bin/pnpm.cjs' install --frozen-lockfile
    } else {
        & node '.tooling/node_modules/pnpm/bin/pnpm.cjs' install
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not install development dependencies.' }
    & node '.tooling/node_modules/pnpm/bin/pnpm.cjs' run check
    if ($LASTEXITCODE -ne 0) { throw 'Development checks failed.' }
} finally {
    Pop-Location
}
