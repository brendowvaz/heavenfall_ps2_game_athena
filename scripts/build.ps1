param(
    [string]$AthenaElf = "C:\Users\brend\Documents\Teste Athena\build\dist\athena.elf"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Dist = Join-Path $ProjectRoot "build\dist"
$DistAssets = Join-Path $Dist "assets"

if (!(Test-Path -LiteralPath $AthenaElf)) {
    throw "Runtime AthenaEnv nao encontrado: $AthenaElf"
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
if (Test-Path -LiteralPath $DistAssets) {
    Remove-Item -LiteralPath $DistAssets -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $DistAssets | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot "main.js") -Destination (Join-Path $Dist "main.js") -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "athena.ini") -Destination (Join-Path $Dist "athena.ini") -Force
Copy-Item -LiteralPath $AthenaElf -Destination (Join-Path $Dist "athena.elf") -Force
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "assets") -Force |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $DistAssets -Recurse -Force }

Write-Host "Nova fase empacotada em: $Dist"
