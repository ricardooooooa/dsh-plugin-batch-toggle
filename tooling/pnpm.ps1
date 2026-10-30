$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pnpmEntry = Join-Path $projectRoot '.tooling/node_modules/pnpm/bin/pnpm.cjs'
if (-not (Test-Path -LiteralPath $pnpmEntry)) { throw 'Run tooling/bootstrap.ps1 first.' }
Push-Location -LiteralPath $projectRoot
try {
    & node $pnpmEntry @args
    $result = $LASTEXITCODE
} finally { Pop-Location }
exit $result
