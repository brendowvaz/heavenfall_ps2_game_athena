param(
    [string]$AthenaElf = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Dist = Join-Path $ProjectRoot "build\dist"
$DistAssets = Join-Path $Dist "assets"
$DistElf = Join-Path $Dist "athena.elf"

if ([string]::IsNullOrWhiteSpace($AthenaElf)) {
    $RuntimeCandidates = @(
        $env:ATHENA_ELF,
        (Join-Path $ProjectRoot "runtime\athena.elf"),
        $DistElf
    ) | Where-Object { ![string]::IsNullOrWhiteSpace($_) }
    $AthenaElf = $RuntimeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if ([string]::IsNullOrWhiteSpace($AthenaElf) -or !(Test-Path -LiteralPath $AthenaElf -PathType Leaf)) {
    throw "Runtime AthenaEnv nao encontrado. Use -AthenaElf <caminho> ou defina ATHENA_ELF."
}
$AthenaElf = (Resolve-Path -LiteralPath $AthenaElf).Path

$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($NodeCommand) {
    $NodeExe = $NodeCommand.Source
} else {
    $NodeExe = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}
if (!(Test-Path -LiteralPath $NodeExe)) {
    throw "Node.js nao encontrado; necessario para exportar os colisores do editor."
}

& $NodeExe (Join-Path $ProjectRoot "scripts\export-editor-scene.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao exportar editor\scene.json para o runtime."
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
if (Test-Path -LiteralPath $DistAssets) {
    Remove-Item -LiteralPath $DistAssets -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $DistAssets | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot "main.js") -Destination (Join-Path $Dist "main.js") -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "athena.ini") -Destination (Join-Path $Dist "athena.ini") -Force
if (![string]::Equals($AthenaElf, $DistElf, [System.StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item -LiteralPath $AthenaElf -Destination $DistElf -Force
}
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "assets") -Force |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $DistAssets -Recurse -Force }

Write-Host "Nova fase empacotada em: $Dist"
