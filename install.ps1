# Zen Stickers installer.
# Copies this folder to %APPDATA%\Adobe\CEP\extensions\ZenStickers.
# No admin needed - the user CEP folder is writable. _build and tools stay behind.

$ErrorActionPreference = 'Stop'
$src  = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\ZenStickers'

New-Item -ItemType Directory -Path $dest -Force | Out-Null
foreach ($item in @('CSXS', 'css', 'js', 'settings', 'host', 'data', 'bin', 'index.html', '.debug', 'README.md')) {
    $from = Join-Path $src $item
    if (-not (Test-Path $from)) { continue }
    $to = Join-Path $dest $item
    if (Test-Path $to) { Remove-Item $to -Recurse -Force }
    Copy-Item $from $dest -Recurse -Force
}
Write-Host "Installed -> $dest" -ForegroundColor Green

# Unsigned panels only load with PlayerDebugMode set. Report, do not assume.
$on = @()
Get-ChildItem 'HKCU:\Software\Adobe' -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -like 'CSXS*' } |
    ForEach-Object {
        $v = (Get-ItemProperty $_.PSPath -Name PlayerDebugMode -ErrorAction SilentlyContinue).PlayerDebugMode
        if ($v -eq '1') { $on += $_.PSChildName }
    }
if ($on.Count -gt 0) { Write-Host "PlayerDebugMode on for: $($on -join ', ')" -ForegroundColor Green }
else { Write-Host 'PlayerDebugMode is NOT set. Fix: reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f' -ForegroundColor Yellow }
