@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "LOGDIR=%~dp0.replay\logs"
set "STARTUP_LOG=%LOGDIR%\startup.log"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" 2>nul
call :log "start.bat.enter script=%~f0 cwd=%CD%"

title Token Saving Replay Agent

echo.
echo  =========================================
echo   Token Saving Replay Agent  ^|  Launcher
echo  =========================================
echo.

set "PYDIR=%~dp0python"
set "PYEXE=%PYDIR%\python.exe"
set "PY_READY=%PYDIR%\.setup_complete"
set "PY_VER=3.12.10"
set "PY_URL=https://www.python.org/ftp/python/%PY_VER%/python-%PY_VER%-embed-amd64.zip"

call :log "start.bat.config pyexe=%PYEXE% py_ready=%PY_READY% py_ver=%PY_VER%"

if exist "%PY_READY%" (
    call :log "start.bat.python_ready_marker_found"
    goto :launch
)

echo [1/3] Downloading portable Python %PY_VER% ...
echo       One-time setup, about 7 MB.
echo.
if not exist "%PYDIR%" (
    mkdir "%PYDIR%"
    set "RC=!ERRORLEVEL!"
    call :log "start.bat.mkdir_pydir rc=!RC!"
    if not "!RC!"=="0" (
        echo.
        echo  ERROR: Could not create Python directory.
        pause & exit /b !RC!
    )
)

call :log "start.bat.python_download.start url=%PY_URL%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -Uri '%PY_URL%' -OutFile '%PYDIR%\py.zip' -UseBasicParsing"
set "RC=%ERRORLEVEL%"
call :log "start.bat.python_download.done rc=%RC%"
if not "%RC%"=="0" (
    echo.
    echo  ERROR: Download failed. Check your internet connection and try again.
    pause & exit /b %RC%
)

call :log "start.bat.python_extract.start"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%PYDIR%\py.zip' -DestinationPath '%PYDIR%' -Force"
set "RC=%ERRORLEVEL%"
call :log "start.bat.python_extract.done rc=%RC%"
if not "%RC%"=="0" (
    echo.
    echo  ERROR: Extraction failed.
    pause & exit /b %RC%
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item '%PYDIR%\py.zip' -ErrorAction SilentlyContinue"
set "RC=%ERRORLEVEL%"
call :log "start.bat.python_zip_cleanup rc=%RC%"

:: Enable site-packages so pip can install packages.
call :log "start.bat.enable_site_packages.start"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f = '%PYDIR%\python312._pth'; (Get-Content $f) -replace '#import site', 'import site' | Set-Content $f"
set "RC=%ERRORLEVEL%"
call :log "start.bat.enable_site_packages.done rc=%RC%"
if not "%RC%"=="0" (
    echo.
    echo  ERROR: Could not enable site-packages in portable Python.
    pause & exit /b %RC%
)

echo [2/3] Bootstrapping pip ...
call :log "start.bat.get_pip_download.start"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '%PYDIR%\get-pip.py' -UseBasicParsing"
set "RC=%ERRORLEVEL%"
call :log "start.bat.get_pip_download.done rc=%RC%"
if not "%RC%"=="0" (
    echo.
    echo  ERROR: Could not download pip.
    pause & exit /b %RC%
)

call :log "start.bat.pip_bootstrap.start"
"%PYEXE%" "%PYDIR%\get-pip.py" --no-warn-script-location --quiet
set "RC=%ERRORLEVEL%"
call :log "start.bat.pip_bootstrap.done rc=%RC%"
if not "%RC%"=="0" (
    echo.
    echo  ERROR: pip installation failed.
    pause & exit /b %RC%
)

echo [3/3] Python ready.
echo.
echo. > "%PY_READY%"
call :log "start.bat.python_ready_marker_written"

:launch
call :log "start.bat.portable_launcher.start pyexe=%PYEXE%"
"%PYEXE%" "%~dp0portable_launcher.py"
set "RC=%ERRORLEVEL%"
call :log "start.bat.portable_launcher.done rc=%RC%"
if not "%RC%"=="0" (
    echo.
    echo  Launcher exited with an error. See output above.
    pause & exit /b %RC%
)

call :log "start.bat.exit rc=0"
exit /b 0

:log
>>"%STARTUP_LOG%" echo [%DATE% %TIME%] %~1
exit /b 0
