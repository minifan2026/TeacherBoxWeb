@echo off
setlocal
set "D=%~dp0"
set "U=file:///%D:\=/%"
set "PROF=%LOCALAPPDATA%\TeacherBox\score-profile"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
set "EDGE=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
goto plain

:edge
if not exist "%PROF%" mkdir "%PROF%"
start "" "%EDGE%" --user-data-dir="%PROF%" --app="%U%index.html" --window-size=1280,880
goto :eof

:plain
start "" "%D%index.html"
goto :eof
