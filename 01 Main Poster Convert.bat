@echo off
setlocal enabledelayedexpansion

REM Check if ImageMagick is installed
where magick >nul 2>nul
if %errorlevel% neq 0 (
    echo ImageMagick is not installed or not in the system PATH.
    echo Please install ImageMagick and ensure it's in your system PATH.
    pause
    exit /b 1
)

REM Check if a file was dragged onto the script
if "%~1"=="" (
    echo Please drag an image file onto this batch file.
    pause
    exit /b 1
)

REM Set the target width and output file path
set "target_width=900"
set "output_file=D:\OneDrive\Pictures\Movie Night\The-Bannered-Pony-Mare\CurrentMovieNightPoster.jpg"

REM Resize the image
magick "%~1" -resize %target_width%x -auto-orient "%output_file%"

if %errorlevel% equ 0 (
    echo Image successfully resized and saved to:
    echo %output_file%
) else (
    echo An error occurred while resizing the image.
)

pause