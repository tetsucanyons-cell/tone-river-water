@echo off
rem Tone River Water Level App Launcher
cd /d "%~dp0"
python server.py
if errorlevel 1 (
    echo.
    echo [Error] Python may not be installed or an error occurred.
    pause
)
