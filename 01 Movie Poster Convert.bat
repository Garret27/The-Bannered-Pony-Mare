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

REM Check if any files were dragged onto the script
if "%~1"=="" (
    echo Please drag one or more image files onto this batch file.
    pause
    exit /b 1
)

REM Set the target directory
set "target_dir=D:\OneDrive\Pictures\Movie Night\The-Bannered-Pony-Mare\Movie Posters\Regular"

REM Ensure the target directory exists
if not exist "%target_dir%" (
    echo Target directory does not exist. Creating it now...
    mkdir "%target_dir%"
    if %errorlevel% neq 0 (
        echo Failed to create target directory.
        pause
        exit /b 1
    )
)

REM Set the target width
set "target_width=900"

REM Loop through all the files passed as arguments
:loop
if "%~1"=="" goto endloop

REM Get the original file name
set "original_file_name=%~nx1"

REM Set the output file path
set "output_file=%target_dir%\%original_file_name%"

REM Resize the image and save it to the target directory
magick "%~1" -resize %target_width%x -auto-orient "%output_file%"
if %errorlevel% equ 0 (
    echo File successfully resized and saved to:
    echo %output_file%
) else (
    echo An error occurred while processing the file:
    echo %~1
)

REM Shift to the next argument
shift
goto loop

:endloop
echo All files processed.
pause
exit /b 0


