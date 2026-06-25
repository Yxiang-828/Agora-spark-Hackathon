@echo off
REM Agora - 1-shot push. Uses your cached GitHub credentials (Git Credential Manager).
REM   pushgit.bat "your commit message"
setlocal
cd /d "%~dp0"
set "MSG=%~1"
if "%MSG%"=="" set "MSG=update"
git add -A
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "%MSG%"
) else (
    echo nothing to commit
)
git push origin HEAD
endlocal
