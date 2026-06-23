param(
    [string]$Pcsx2Exe = "C:\Program Files\PCSX2\pcsx2-qt.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Elf = Join-Path $ProjectRoot "build\dist\athena.elf"
$Dist = Split-Path -Parent $Elf
$Log = Join-Path $ProjectRoot "build\pcsx2-athena.log"

if (!(Test-Path -LiteralPath $Elf)) {
    throw "Execute scripts\build.ps1 antes de iniciar."
}
if (!(Test-Path -LiteralPath $Pcsx2Exe)) {
    throw "PCSX2 nao encontrado: $Pcsx2Exe"
}

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $Pcsx2Exe
$startInfo.WorkingDirectory = $Dist
# Passing the ELF as the boot filename makes PCSX2 start Athena directly.
# `-elf` only overrides the executable of the currently selected disc and can
# therefore reopen an unrelated game when PCSX2 still has a disc configured.
$startInfo.Arguments = '-batch -logfile "' + $Log + '" "' + $Elf + '"'

$pcsx2 = [System.Diagnostics.Process]::Start($startInfo)
Start-Sleep -Milliseconds 700
$pcsx2.Refresh()
if ($pcsx2.HasExited) {
    throw "O PCSX2 encerrou antes de iniciar o jogo (codigo $($pcsx2.ExitCode))."
}

Write-Host "PCSX2 iniciado."

# Keep this launcher alive. On Windows, the editor's PowerShell process can be
# placed in a job that also closes its children when the script exits.
$pcsx2.WaitForExit()
Write-Host "PCSX2 encerrado (codigo $($pcsx2.ExitCode))."
if ($pcsx2.ExitCode -ne 0) {
    throw "O PCSX2 encerrou com codigo $($pcsx2.ExitCode)."
}
