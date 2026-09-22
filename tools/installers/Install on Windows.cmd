@echo off
setlocal
title Install Zen Stickers
rem Installs Zen Stickers for the current Windows user.
rem It unpacks the .zxp next to this file into %APPDATA%\Adobe\CEP\extensions\ZenStickers.
rem No Creative Cloud sign-in, no admin rights and no Adobe installer are needed.
rem The .zxp's signature files are unpacked unchanged, so Adobe still sees a signed extension.

echo.
echo  Zen Stickers installer
echo  ----------------------
echo.

rem ZS_IGNORE_RUNNING=1 skips this check (used by the test that installs into a temporary folder).
if defined ZS_IGNORE_RUNNING goto :install
tasklist /fi "imagename eq Adobe Premiere Pro.exe" 2>nul | find /i "Adobe Premiere Pro.exe" >nul && goto :running
tasklist /fi "imagename eq AfterFX.exe" 2>nul | find /i "AfterFX.exe" >nul && goto :running
goto :install

:running
echo  Please close Premiere Pro and After Effects first, then run this again.
echo.
pause
exit /b 1

:install
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$here = '%~dp0';" ^
  "$zxp = Get-ChildItem -LiteralPath $here -Filter 'ZenStickers*.zxp' | Sort-Object LastWriteTime -Descending | Select-Object -First 1;" ^
  "if (-not $zxp) { Write-Host '  No ZenStickers .zxp file next to this installer. Put both files in the same folder.' -ForegroundColor Red; exit 1 }" ^
  "Write-Host ('  Installing ' + $zxp.Name);" ^
  "$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\ZenStickers';" ^
  "if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }" ^
  "New-Item -ItemType Directory -Force -Path $dest | Out-Null;" ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "[IO.Compression.ZipFile]::ExtractToDirectory($zxp.FullName, $dest);" ^
  "if (-not (Test-Path -LiteralPath (Join-Path $dest 'CSXS\manifest.xml'))) { Write-Host '  The .zxp file looks damaged. Download it again.' -ForegroundColor Red; exit 1 }" ^
  "Get-ChildItem -LiteralPath $dest -Recurse -File | Unblock-File -ErrorAction SilentlyContinue;" ^
  "Write-Host ('  Installed to ' + $dest) -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo  Installation failed. See the message above.
  echo.
  pause
  exit /b 1
)

echo.
echo  Done. Start Premiere Pro or After Effects, then choose
echo  Window ^> Extensions ^> Zen Stickers.
echo.
echo  If the panel stays blank, run "Fix blank panel (Windows).cmd".
echo.
pause
