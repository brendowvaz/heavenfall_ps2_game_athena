param(
    [string]$Pcsx2Exe = "C:\Program Files\PCSX2\pcsx2-qt.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Elf = Join-Path $ProjectRoot "build\dist\athena.elf"
$Dist = Split-Path -Parent $Elf

if (!(Test-Path -LiteralPath $Elf)) {
    throw "Execute scripts\build.ps1 antes de iniciar."
}
if (!(Test-Path -LiteralPath $Pcsx2Exe)) {
    throw "PCSX2 nao encontrado: $Pcsx2Exe"
}

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $Pcsx2Exe
$startInfo.WorkingDirectory = $Dist
$startInfo.Arguments = '-elf "' + $Elf + '"'

[System.Diagnostics.Process]::Start($startInfo)
