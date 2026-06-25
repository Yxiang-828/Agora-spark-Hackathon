@echo off
REM Agora fork one-shot for Windows — builds + serves the fork via WSL.
REM Usage:  agora\scripts\fork\up.bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0up.ps1" %*
