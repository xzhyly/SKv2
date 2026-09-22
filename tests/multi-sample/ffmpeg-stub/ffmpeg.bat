@echo off
rem Test shim, placed first on PATH by harness.mjs. Every real transcode call is logged;
rem the `-version` probe from get_ffmpeg_path() is delegated but not logged.
rem SK_STUB_FAIL=1 makes transcodes fail (exit 1, no output) to exercise the raw-.webm fallback.
if "%~1"=="-version" goto run
echo %date% %time% %* >> "%SK_FFMPEG_LOG%"
if defined SK_STUB_FAIL exit /b 1
:run
"%SK_REAL_FFMPEG%" %*
exit /b %ERRORLEVEL%
