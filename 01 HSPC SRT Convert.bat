@echo off
setlocal

REM Create log file in same directory as batch file
set "LogFile=%~dp0srt_copy_log.txt"

REM Clear previous log and start new one
echo SRT Copy Log - %date% %time% > "%LogFile%"
echo ================================== >> "%LogFile%"
echo. >> "%LogFile%"

echo Script started >> "%LogFile%"
echo Batch file location: %~dp0 >> "%LogFile%"
echo. >> "%LogFile%"

REM Log all arguments
echo Raw argument 1: "%1" >> "%LogFile%"
echo Clean argument 1: "%~1" >> "%LogFile%"
echo File name: "%~nx1" >> "%LogFile%"
echo File extension: "%~x1" >> "%LogFile%"
echo. >> "%LogFile%"

REM Check if a file was dragged onto the batch file
if "%~1"=="" (
    echo ERROR: No file argument provided >> "%LogFile%"
    goto :end
)

echo File argument exists >> "%LogFile%"

REM Check if the dragged file has .srt extension
if /i not "%~x1"==".srt" (
    echo ERROR: File does not have .srt extension >> "%LogFile%"
    echo Extension found: "%~x1" >> "%LogFile%"
    goto :end
)

echo File has .srt extension >> "%LogFile%"

REM Check if the source file exists
if not exist "%~1" (
    echo ERROR: Source file does not exist at: "%~1" >> "%LogFile%"
    goto :end
)

echo Source file exists >> "%LogFile%"

REM Get target location
set "TargetFile=%~dp0MovieNightHSPCSubtitles.srt"
echo Target file: "%TargetFile%" >> "%LogFile%"
echo. >> "%LogFile%"

REM Attempt copy
echo Attempting copy command... >> "%LogFile%"
copy "%~1" "%TargetFile%" >> "%LogFile%" 2>&1

if %errorlevel% equ 0 (
    echo Copy command returned success (errorlevel 0) >> "%LogFile%"
    if exist "%TargetFile%" (
        echo SUCCESS: Target file exists after copy >> "%LogFile%"
    ) else (
        echo WARNING: Target file does not exist despite successful copy >> "%LogFile%"
    )
) else (
    echo Copy command failed with errorlevel: %errorlevel% >> "%LogFile%"
)

:end
echo. >> "%LogFile%"
echo Script finished >> "%LogFile%"
echo ================================== >> "%LogFile%"

REM Also try to show a message box that will stay visible
echo The log file has been created at: >> "%LogFile%"
echo %LogFile% >> "%LogFile%"