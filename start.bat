@echo off
title MelodyHub Server
echo ============================================
echo   MelodyHub - Media Download ^& Audio Studio
echo ============================================
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH!
    pause
    exit /b 1
)

REM Check ffmpeg
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo [WARNING] FFmpeg not found! Audio conversion will not work.
    echo Download from: https://ffmpeg.org/download.html
    echo.
)

REM Install dependencies
echo [*] Installing dependencies...
pip install -r requirements.txt -q
echo.

echo [*] Starting server...
echo [*] Open browser: http://localhost:5000
echo.
start http://localhost:5000
python app.py

pause
