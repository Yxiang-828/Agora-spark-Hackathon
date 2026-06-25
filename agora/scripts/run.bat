@echo off
REM Agora - 1-shot run: connect your LOCAL AI to the room over the outbound WebSocket.
REM Drives your local CLI on your subscription (not an API key).
REM Usage:
REM   set AGORA_AGENT=claude && run.bat
setlocal

REM %~dp0 is the directory containing this script. We want the parent (ROOT).
set "ROOT=%~dp0.."

if "%AGORA_AGENT%"=="" set "AGORA_AGENT=claude"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo Python not found.
  exit /b 1
)

if not exist "%ROOT%\connector\.env" (
  echo No connector\.env - run scripts\up.bat first ^(it provisions the bot + token^).
  exit /b 1
)

echo Connecting agent='%AGORA_AGENT%' to the room (Ctrl-C to stop)...
%PY% "%ROOT%\connector\connector.py"
