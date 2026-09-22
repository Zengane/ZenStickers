@echo off
setlocal
title Zen Stickers - fix a blank panel
rem Only needed if the Zen Stickers panel opens but stays blank.
rem Adobe's own advice for that (Known Issue 2024): turn on "PlayerDebugMode", which
rem makes Premiere Pro and After Effects load extensions without checking their
rem signature. It is set for the current Windows user only, in
rem HKEY_CURRENT_USER\Software\Adobe\CSXS.9 to CSXS.13.
rem To undo it later: run this file with the word "undo" (Fix-blank-panel-Windows.cmd undo).

echo.
if /i "%~1"=="undo" goto :undo

echo  This turns on Adobe's "PlayerDebugMode" for your Windows user.
echo  Premiere Pro and After Effects will then load panels without checking
echo  their signature. Only do this if the Zen Stickers panel stays blank.
echo.
choice /c YN /m "  Turn it on"
if errorlevel 2 exit /b 0

for %%V in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo.
echo  Done. Restart Premiere Pro or After Effects.
echo.
pause
exit /b 0

:undo
for %%V in (9 10 11 12 13) do reg delete "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /f >nul 2>nul
echo  PlayerDebugMode is off again.
echo.
pause
