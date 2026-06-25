param(
    [string]$Pcsx2Exe = "C:\Program Files\PCSX2\pcsx2-qt.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Elf = Join-Path $ProjectRoot "build\dist\athena.elf"
$Dist = Split-Path -Parent $Elf
$Log = Join-Path $ProjectRoot "build\pcsx2-athena.log"

function Initialize-PortablePcsx2 {
    param([string]$InstalledExe)

    $InstalledRoot = Split-Path -Parent $InstalledExe
    $PortableRoot = Join-Path $ProjectRoot "build\pcsx2-portable"
    $PortableExe = Join-Path $PortableRoot "pcsx2-qt.exe"
    $Marker = Join-Path $PortableRoot ".source-version"
    $SourceInfo = Get-Item -LiteralPath $InstalledExe
    $Fingerprint = "$($SourceInfo.FullName)|$($SourceInfo.Length)|$($SourceInfo.LastWriteTimeUtc.Ticks)"
    $CurrentFingerprint = if (Test-Path -LiteralPath $Marker) {
        Get-Content -LiteralPath $Marker -Raw
    } else {
        ""
    }

    if (!(Test-Path -LiteralPath $PortableExe) -or $CurrentFingerprint.Trim() -ne $Fingerprint) {
        Write-Host "Preparando PCSX2 portatil para o ambiente do editor..."
        if (Test-Path -LiteralPath $PortableRoot) {
            Remove-Item -LiteralPath $PortableRoot -Recurse -Force
        }
        New-Item -ItemType Directory -Path $PortableRoot -Force | Out-Null
        Copy-Item -Path (Join-Path $InstalledRoot "*") -Destination $PortableRoot -Recurse -Force

        # PCSX2 2.x selects portable mode through this marker and then keeps
        # settings, BIOS, memory cards, and caches beside the executable.
        New-Item -ItemType File -Path (Join-Path $PortableRoot "portable.ini") -Force | Out-Null

        $Documents = [Environment]::GetFolderPath("MyDocuments")
        $UserData = Join-Path $Documents "PCSX2"
        if (Test-Path -LiteralPath $UserData) {
            Copy-Item -Path (Join-Path $UserData "*") -Destination $PortableRoot -Recurse -Force
        }

        Set-Content -LiteralPath $Marker -Value $Fingerprint -NoNewline
    }

    return $PortableExe
}

if (!(Test-Path -LiteralPath $Elf)) {
    throw "Execute scripts\build.ps1 antes de iniciar."
}
if (!(Test-Path -LiteralPath $Pcsx2Exe)) {
    throw "PCSX2 nao encontrado: $Pcsx2Exe"
}

# Keep project tests independent from the normal PCSX2 profile. This also
# guarantees that cache and memory-card writes stay inside the workspace when
# the editor is running in a restricted environment.
$Pcsx2Exe = Initialize-PortablePcsx2 -InstalledExe $Pcsx2Exe

# Passing the ELF as the boot filename makes PCSX2 start Athena directly.
# `-elf` only overrides the executable of the currently selected disc and can
# therefore reopen an unrelated game when PCSX2 still has a disc configured.
$launchArguments = '-batch -logfile "' + $Log + '" "' + $Elf + '"'
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $Pcsx2Exe
$startInfo.WorkingDirectory = $Dist
$startInfo.Arguments = $launchArguments
$startInfo.UseShellExecute = $true
$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
$pcsx2 = [System.Diagnostics.Process]::Start($startInfo)

$windowDeadline = [DateTime]::UtcNow.AddSeconds(15)
while ([DateTime]::UtcNow -lt $windowDeadline) {
    Start-Sleep -Milliseconds 250
    $pcsx2.Refresh()
    if ($pcsx2.HasExited) {
        throw "O PCSX2 encerrou antes de abrir a janela (codigo $($pcsx2.ExitCode)). Consulte $Log."
    }
    if ($pcsx2.MainWindowHandle -ne 0) {
        break
    }
}

if ($pcsx2.MainWindowHandle -eq 0) {
    $pcsx2.Kill()
    throw "O PCSX2 iniciou sem janela. Abra o editor por scripts\editor.ps1 em um PowerShell normal do Windows e tente novamente. Consulte $Log."
}

Write-Host "PCSX2 iniciado."

# Keep this launcher alive. On Windows, the editor's PowerShell process can be
# placed in a job that also closes its children when the script exits.
$pcsx2.WaitForExit()
Write-Host "PCSX2 encerrado (codigo $($pcsx2.ExitCode))."
if ($pcsx2.ExitCode -ne 0) {
    throw "O PCSX2 encerrou com codigo $($pcsx2.ExitCode)."
}
