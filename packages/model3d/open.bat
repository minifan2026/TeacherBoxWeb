@echo off
setlocal
set "D=%~dp0"
set "U=file:///%D:\=/%"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
set "EDGE=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
goto plain

:edge
start "" "%EDGE%" --app="%U%index.html" --window-size=1440,900
goto :eof

:plain
start "" "%D%index.html"
goto :eof
