param(
    [int]$Port = 4173
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue

if ($NodeCommand) {
    $NodeExe = $NodeCommand.Source
} else {
    $BundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    if (!(Test-Path -LiteralPath $BundledNode)) {
        throw "Node.js nao encontrado. Instale Node.js 20+ ou execute o editor pelo Codex."
    }
    $NodeExe = $BundledNode
}

$env:ATHENA_EDITOR_PORT = $Port
Write-Host "Athena Visual Editor"
Write-Host "Abra no navegador: http://127.0.0.1:$Port/editor/"
Write-Host "Pressione Ctrl+C para encerrar."
& $NodeExe (Join-Path $ProjectRoot "editor\server.mjs")

