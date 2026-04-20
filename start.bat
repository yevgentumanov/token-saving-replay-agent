@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

title Token Saving Replay Agent

echo.
echo  =========================================
echo   Token Saving Replay Agent  ^|  Launcher
echo  =========================================
echo.

set "PYDIR=%~dp0python"
set "PYEXE=%PYDIR%\python.exe"
set "PY_VER=3.12.10"
set "PY_URL=https://www.python.org/ftp/python/%PY_VER%/python-%PY_VER%-embed-amd64.zip"

:: ── Already installed — skip to launch ──────────────────────────────────────
if exist "%PYEXE%" goto :launch

:: ── First run: Download portable Python ─────────────────────────────────────
echo [1/3] Downloading portable Python %PY_VER% ...
echo       (one-time setup, ~7 MB)
echo.
if not exist "%PYDIR%" mkdir "%PYDIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -Uri '%PY_URL%' -OutFile '%PYDIR%\py.zip' -UseBasicParsing"
if errorlevel 1 (
    echo.
    echo  ERROR: Download failed. Check your internet connection and try again.
    pause & exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Expand-Archive -Path '%PYDIR%\py.zip' -DestinationPath '%PYDIR%' -Force; ^
     Remove-Item '%PYDIR%\py.zip' -ErrorAction SilentlyContinue"
if errorlevel 1 (
    echo.
    echo  ERROR: Extraction failed.
    pause & exit /b 1
)

:: Enable site-packages so pip can install packages
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$f = '%PYDIR%\python312._pth'; ^
     (Get-Content $f) -replace '#import site', 'import site' | Set-Content $f"

:: Bootstrap pip
echo [2/3] Bootstrapping pip ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' ^
     -OutFile '%PYDIR%\get-pip.py' -UseBasicParsing"
if errorlevel 1 (
    echo.
    echo  ERROR: Could not download pip.
    pause & exit /b 1
)

"%PYEXE%" "%PYDIR%\get-pip.py" --no-warn-script-location --quiet
if errorlevel 1 (
    echo.
    echo  ERROR: pip installation failed.
    pause & exit /b 1
)

echo [3/3] Python ready!
echo.

:launch
:: ── Delegate all remaining setup + launch to portable_launcher.py ────────────
"%PYEXE%" "%~dp0portable_launcher.py"
if errorlevel 1 (
    echo.
    echo  Launcher exited with an error. See output above.
    pause & exit /b 1
)
