# Agora — 1-shot push. Uses your cached GitHub credentials (Git Credential Manager).
#   .\pushgit.ps1 "your commit message"
param([string]$m = "update")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
git add -A
# only commit if there is something staged
if (git diff --cached --quiet; $LASTEXITCODE -ne 0) {
    git commit -m $m
} else {
    Write-Host "nothing to commit"
}
git push origin HEAD
