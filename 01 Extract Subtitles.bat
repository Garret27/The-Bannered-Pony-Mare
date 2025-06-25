@echo off
setlocal enabledelayedexpansion

REM Check if a file was dragged onto the script
if "%~1"=="" (
    echo Please drag a video file onto this batch file.
    pause
    exit /b
)

REM Set the FFmpeg path
set "FFMPEG_PATH=D:\C Drive OffLoad\ripja\Downloads\ffmpeg-2025-06-23-git-e6298e0759-full_build\ffmpeg-2025-06-23-git-e6298e0759-full_build\bin\ffmpeg.exe"

REM Get the input file and its directory
set "INPUT_FILE=%~1"
set "INPUT_DIR=%~dp1"
set "INPUT_NAME=%~n1"

echo Processing: %INPUT_FILE%
echo Output directory: %INPUT_DIR%

REM First, check what subtitle streams are available
echo.
echo Checking for subtitle streams...
"%FFMPEG_PATH%" -i "%INPUT_FILE%" 2>&1 | findstr "Stream.*subtitle"

if errorlevel 1 (
    echo No subtitle streams found in this file.
    pause
    exit /b
)

echo.
echo Extracting subtitle streams...

REM Extract all subtitle streams
"%FFMPEG_PATH%" -i "%INPUT_FILE%" -map 0:s -c:s srt "%INPUT_DIR%%INPUT_NAME%_subtitle_%%d.srt" 2>nul

if errorlevel 1 (
    echo Failed to extract subtitles. The file may not contain extractable subtitle streams.
) else (
    echo.
    echo Subtitles extracted successfully to:
    echo %INPUT_DIR%
    echo.
    echo Files created:
    dir /b "%INPUT_DIR%%INPUT_NAME%_subtitle_*.srt" 2>nul
)

echo.
pause