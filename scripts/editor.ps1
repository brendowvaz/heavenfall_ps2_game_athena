param(
    [int]$Port = 4173
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$EditorUrl = "http://127.0.0.1:$Port/editor/"
$CapabilitiesUrl = "http://127.0.0.1:$Port/api/capabilities"

try {
    $Capabilities = Invoke-RestMethod -Uri $CapabilitiesUrl -TimeoutSec 1
    if ($Capabilities.editorSchemaVersion) {
        Write-Host "Athena Visual Editor ja esta aberto."
        Write-Host "Acesse no navegador: $EditorUrl"
        return
    }
} catch {
    # A porta livre ou ocupada por outro processo e tratada abaixo.
}

$PortInUse = $false
$PortProbe = [System.Net.Sockets.TcpClient]::new()
try {
    $PortProbe.Connect("127.0.0.1", $Port)
    $PortInUse = $true
} catch {
    $PortInUse = $false
} finally {
    $PortProbe.Dispose()
}

if ($PortInUse) {
    throw "A porta $Port esta em uso por outro programa. Execute novamente com -Port 4174."
}

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
Write-Host "Abra no navegador: $EditorUrl"
Write-Host "Pressione Ctrl+C para encerrar."
& $NodeExe (Join-Path $ProjectRoot "editor\server.mjs")
