@echo off
rem tools\pi\export-from-laptop.cmd - pack the laptop's kiosk data for the Pi (tools/pi/transfer.md).
rem   tools\pi\export-from-laptop.cmd F:\
rem Writes F:\sk-transfer\ :
rem   sining_kamay_db.sql   mysqldump of sining_kamay_db (structure + data) from XAMPP
rem   saved_gestures\       an exact mirror of the repo's saved_gestures\ (signs, samples, audio, avatar clips)
rem   models\               an exact mirror of the repo's models\ (knn_ESL.bin, knn_FSL.bin, the Vosk model)
rem   manifest.txt          file counts and sizes, checked by tools/pi/import-on-pi.sh
rem Start XAMPP's MySQL first. Videos are not copied (they are never in saved_gestures\ or models\).
setlocal EnableExtensions

if "%~1"=="" (
  echo Usage: tools\pi\export-from-laptop.cmd ^<USB drive or folder^>   e.g.  tools\pi\export-from-laptop.cmd F:\
  exit /b 2
)
set "REPO=%~dp0..\.."
pushd "%REPO%" || exit /b 1
set "REPO=%CD%"
popd
set "OUT=%~1"
if not "%OUT:~-1%"=="\" set "OUT=%OUT%\"
set "OUT=%OUT%sk-transfer"
set "MYSQLDUMP=C:\xampp\mysql\bin\mysqldump.exe"
set "MYSQL=C:\xampp\mysql\bin\mysql.exe"
rem Windows find.exe by full path: a Unix "find" earlier in PATH (Git Bash) would hang here.
set "FINDEXE=%SystemRoot%\System32\find.exe"

if not exist "%MYSQLDUMP%" ( echo mysqldump not found: %MYSQLDUMP% & exit /b 1 )
if not exist "%OUT%" mkdir "%OUT%" || exit /b 1
echo Exporting to %OUT%

echo [1/3] Database...
"%MYSQLDUMP%" -u root --single-transaction --routines --triggers --default-character-set=utf8mb4 sining_kamay_db > "%OUT%\sining_kamay_db.sql" 2> "%OUT%\mysqldump-errors.txt"
if errorlevel 1 ( echo mysqldump failed - is XAMPP MySQL running? See %OUT%\mysqldump-errors.txt & exit /b 1 )
del "%OUT%\mysqldump-errors.txt" 2>nul

echo [2/3] saved_gestures and models (mirror)...
robocopy "%REPO%\saved_gestures" "%OUT%\saved_gestures" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
if errorlevel 8 ( echo robocopy saved_gestures failed & exit /b 1 )
robocopy "%REPO%\models" "%OUT%\models" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XF *.tmp
if errorlevel 8 ( echo robocopy models failed & exit /b 1 )

echo [3/3] Manifest...
set "MAN=%OUT%\manifest.txt"
> "%MAN%" echo exported=%DATE% %TIME%
for /f %%n in ('dir /s /b /a-d "%OUT%\saved_gestures" ^| "%FINDEXE%" /c /v ""') do >> "%MAN%" echo saved_gestures_files=%%n
for /f %%n in ('dir /s /b /a-d "%OUT%\saved_gestures\*audio_*" 2^>nul ^| "%FINDEXE%" /c /v ""') do >> "%MAN%" echo audio_files=%%n
for /f %%n in ('dir /s /b /a-d "%OUT%\saved_gestures\avatar.json" 2^>nul ^| "%FINDEXE%" /c /v ""') do >> "%MAN%" echo avatar_files=%%n
for /f %%n in ('dir /s /b /a-d "%OUT%\models" ^| "%FINDEXE%" /c /v ""') do >> "%MAN%" echo models_files=%%n
for %%f in ("%OUT%\sining_kamay_db.sql") do >> "%MAN%" echo sql_bytes=%%~zf
rem "call": a for /f command that starts with a quoted path loses its quotes otherwise.
for /f %%n in ('call "%MYSQL%" -u root -N -e "SELECT COUNT(*) FROM sining_kamay_db.gestures"') do >> "%MAN%" echo db_gestures=%%n
for /f %%n in ('call "%MYSQL%" -u root -N -e "SELECT COUNT(*) FROM sining_kamay_db.gesture_recordings"') do >> "%MAN%" echo db_recordings=%%n
for /f %%n in ('call "%MYSQL%" -u root -N -e "SELECT COUNT(*) FROM sining_kamay_db.users"') do >> "%MAN%" echo db_users=%%n
type "%MAN%"
echo.
echo Done. Eject the USB drive, plug it into the Pi and run:  bash tools/pi/import-on-pi.sh
exit /b 0
