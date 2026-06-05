@echo off
setlocal EnableExtensions EnableDelayedExpansion

title Extract Subtitles

if "%~1"=="" (
    echo.
    echo  Drag and drop one or more video files onto this batch file.
    echo  All subtitle tracks will be saved as .srt files next to each video.
    echo.
    pause
    exit /b 1
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo ERROR: ffmpeg was not found in your PATH.
    echo Install FFmpeg and make sure ffmpeg.exe is available from the command line.
    pause
    exit /b 1
)

where ffprobe >nul 2>&1
if errorlevel 1 (
    echo ERROR: ffprobe was not found in your PATH.
    echo Install FFmpeg and make sure ffprobe.exe is available from the command line.
    pause
    exit /b 1
)

set "TOTAL=0"
set "EXTRACTED=0"
set "SKIPPED=0"

:next_file
if "%~1"=="" goto finished

set "INPUT=%~f1"
set "DIR=%~dp1"
set "BASENAME=%~n1"

if not exist "!INPUT!" (
    echo.
    echo [SKIP] File not found: !INPUT!
    set /a SKIPPED+=1
    shift
    goto next_file
)

echo.
echo ============================================================
echo Processing: !INPUT!
echo ============================================================

set "FOUND=0"
set "IDX="
set "LANG="
set "NAME="
set "FORCED=0"
set "SDH=0"
set "CAPTIONS=0"

for /f "usebackq delims=" %%L in (`ffprobe -v error -select_streams s -show_entries stream^=index:tags^=language:tags^=name:disposition^=forced:disposition^=hearing_impaired:disposition^=captions -of default^=noprint_wrappers^=1 "!INPUT!" 2^>nul`) do (
    set "LINE=%%L"
    for /f "tokens=1,* delims==" %%A in ("!LINE!") do (
        if /i "%%A"=="index" (
            if defined IDX (
                call :extract_one
            )
            set "IDX=%%B"
            set "LANG="
            set "NAME="
            set "FORCED=0"
            set "SDH=0"
            set "CAPTIONS=0"
        )
        if /i "%%A"=="TAG:language" set "LANG=%%B"
        if /i "%%A"=="TAG:name" set "NAME=%%B"
        if /i "%%A"=="DISPOSITION:forced" set "FORCED=%%B"
        if /i "%%A"=="DISPOSITION:hearing_impaired" set "SDH=%%B"
        if /i "%%A"=="DISPOSITION:captions" set "CAPTIONS=%%B"
    )
)

if defined IDX call :extract_one

if "!FOUND!"=="0" (
    echo   No subtitle tracks found.
)

set /a TOTAL+=1
shift
goto next_file

:extract_one
set "FOUND=1"

if not defined LANG set "LANG=und"

set "OUTNAME=!BASENAME!.!LANG!"
if "!FORCED!"=="1" set "OUTNAME=!OUTNAME!.forced"
if "!SDH!"=="1" set "OUTNAME=!OUTNAME!.sdh"
if "!CAPTIONS!"=="1" if not "!SDH!"=="1" set "OUTNAME=!OUTNAME!.cc"

if defined NAME (
    set "SAFE=!NAME!"
    set "SAFE=!SAFE: =_!"
    set "SAFE=!SAFE:.=_!"
    set "SAFE=!SAFE:(=_!"
    set "SAFE=!SAFE:)=_!"
    set "SAFE=!SAFE:[=_!"
    set "SAFE=!SAFE:]=_!"
    set "OUTNAME=!OUTNAME!.!SAFE!"
)

set "OUTPUT=!DIR!!OUTNAME!.srt"

if exist "!OUTPUT!" (
    set "OUTPUT=!DIR!!OUTNAME!.s!IDX!.srt"
)

echo   Stream !IDX! ^(!LANG!^) -^> !OUTPUT!

ffmpeg -y -nostdin -loglevel error -i "!INPUT!" -map 0:!IDX! -c:s srt "!OUTPUT!"
if errorlevel 1 (
    echo   [ERROR] Failed to extract stream !IDX!
) else (
    set /a EXTRACTED+=1
)

goto :eof

:finished
echo.
echo ============================================================
echo Finished.
echo   Files processed : !TOTAL!
echo   Subtitles saved : !EXTRACTED!
if !SKIPPED! gtr 0 echo   Files skipped   : !SKIPPED!
echo ============================================================
echo.
pause
exit /b 0