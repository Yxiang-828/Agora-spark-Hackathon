# Agora fork - Windows one-shot (no Git Bash).
#
#   agora\scripts\fork\up.bat                 # build + serve + public share link + connector
#   agora\scripts\fork\up.bat -Local          # localhost only (snappy, no tunnel)
#   agora\scripts\fork\up.bat -NoBuild        # reuse the current dist (fast re-serve)
#
# Windows can't build Mattermost's webapp natively, and Docker Desktop's WSL docker socket is
# unreliable here, so this launcher: builds the webapp inside WSL (ext4), seeds the compiled
# client into a named volume via a tar-stream piped to docker.exe *inside WSL* (binary-safe),
# serves the stack with docker.exe, opens a public link with the Windows cloudflared.exe, sets
# SiteURL in the same compose-up, and launches the connector detached. The Linux/macOS
# equivalent is agora/scripts/fork/up.sh (native Docker, no workarounds).
[CmdletBinding()]
param(
    [string]$Distro = "Ubuntu-22.04",
    [int]$Port = 8066,
    [switch]$Local,
    [switch]$NoBuild,
    [switch]$SkipPlugin
)
$ErrorActionPreference = "Stop"
function Info($m) { Write-Host "[fork-up] $m" -ForegroundColor Cyan }
function Die($m) { Write-Host "[fork-up] $m" -ForegroundColor Red; exit 1 }

$RepoWin = $PSScriptRoot                                # up.ps1 lives at the repo root
$Fork = "$RepoWin\agora\scripts\fork"                   # internal scripts + cloudflared.exe live here
$RepoMnt = "/mnt/" + ($RepoWin.Substring(0, 1).ToLower()) + ($RepoWin.Substring(2) -replace '\\', '/')
$Compose = "$RepoWin\agora\deploy\fork\docker-compose.yml"
$Project = "agora-fork"
$Container = "$Project-mattermost-1"
$Cf = "$Fork\cloudflared.exe"
$ConnDir = "$RepoWin\agora\connector"

# --- prerequisites --------------------------------------------------------
try { docker version --format '{{.Server.Version}}' 2>$null | Out-Null } catch { Die "Docker Desktop isn't running (docker.exe unreachable)." }
$distros = (wsl.exe -l -q) -replace "`0", ""
if (-not ($distros -split "`r?`n" | Where-Object { $_.Trim() -eq $Distro })) {
    Die "WSL distro '$Distro' not found. Run: wsl --install -d Ubuntu-22.04"
}

# mirrored networking (fixes WSL outbound HTTPS behind VPNs) - write once if absent
$wslconfig = "$env:USERPROFILE\.wslconfig"
if (-not (Test-Path $wslconfig) -or -not (Select-String -Path $wslconfig -Pattern "networkingMode=mirrored" -Quiet)) {
    Info "writing $wslconfig (mirrored networking + memory) and restarting WSL..."
    "[wsl2]`nnetworkingMode=mirrored`ndnsTunneling=true`nautoProxy=true`nmemory=12GB`nswap=4GB`n" | Set-Content -Encoding ascii $wslconfig
    wsl.exe --shutdown | Out-Null
    Start-Sleep -Seconds 5
}

$WslHome = (wsl.exe -e bash -lc 'echo $HOME').Trim()
$Dst = "$WslHome/agora-mm"

# --- 1. build the webapp in WSL ------------------------------------------
if (-not $NoBuild) {
    Info "building webapp in WSL (~4-6m, the only slow step)..."
    $rsyncExcl = "--exclude node_modules/ --exclude dist/ --exclude .git/ --exclude '*.log' --exclude .rollup.cache/ --exclude tsconfig.tsbuildinfo"
    $build = "export PATH=`$HOME/.local/node24/bin:`$PATH; rsync -a --delete $rsyncExcl '$RepoMnt/' '$Dst/' && cd '$Dst/webapp/channels' && NODE_OPTIONS='--max-old-space-size=6144' npx tsc -b && cd '$Dst' && bash agora/scripts/fork/build.sh"
    wsl.exe -e bash -lc $build
    if ($LASTEXITCODE -ne 0) { Die "webapp build failed" }
}
else { Info "-NoBuild: reusing the current dist" }

# --- 2. seed the client into the named volume (tar-stream inside WSL) -----
Info "seeding client into ${Project}_mmclient..."
docker volume create "${Project}_mmclient" | Out-Null
$seed = "cd '$Dst/webapp/channels/dist' && tar -cf - . | docker.exe run --rm -i -v ${Project}_mmclient:/dest alpine sh -c 'cd /dest && rm -rf root.html *.js *.css && tar -xf - && chown -R 2000:2000 /dest'"
wsl.exe -e bash -lc $seed
if ($LASTEXITCODE -ne 0) { Die "failed to seed client volume" }

# --- 3. public link first (so SiteURL is set in one compose-up) -----------
$SiteUrl = "http://localhost:$Port"
$CfUrl = ""
if (-not $Local) {
    if (-not (Test-Path $Cf)) {
        Info "fetching cloudflared.exe..."
        Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $Cf
    }
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force  # clear stale tunnels
    $cfLog = "$Fork\.cf.log"; $cfErr = "$Fork\.cf.err"
    Remove-Item $cfLog, $cfErr -ErrorAction SilentlyContinue
    Info "opening cloudflare tunnel..."
    # cloudflared prints the URL banner to STDERR, so we scan both streams.
    Start-Process -FilePath $Cf -ArgumentList "tunnel", "--url", "http://localhost:$Port", "--protocol", "http2", "--no-autoupdate" -RedirectStandardOutput $cfLog -RedirectStandardError $cfErr -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep 2
        $m = Select-String -Path $cfErr, $cfLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $CfUrl = $m.Matches[0].Value; break }
    }
    if ($CfUrl) { $SiteUrl = $CfUrl } else { Info "tunnel URL not captured - falling back to localhost" }
}

# --- 3.5 auto-terminate: reclaim our ports from any stale/foreign stack ---
# `docker compose up` only reconciles its OWN project; a different project (e.g. the old
# plugin-era agora\deploy\docker-compose.yml) holding host port 8066/8443 yields the
# "port is already allocated" hard-fail. So before serving, stop any container publishing
# our ports that isn't part of THIS fork project. (Our own running stack is left alone;
# `up -d` below reconciles it.)
foreach ($p in @("$Port", "8443")) {
    foreach ($id in @(docker ps -q --filter "publish=$p")) {
        if (-not $id) { continue }
        $nm = (docker inspect --format '{{.Name}}' $id 2>$null) -replace '^/', ''
        if ($nm -and $nm -notlike "$Project*") {
            Info "port $p held by '$nm' (other stack) - stopping it so the fork can bind"
            docker stop $id | Out-Null
        }
    }
}

# --- 4. serve -------------------------------------------------------------
Info "serving with SiteURL=$SiteUrl ..."
$env:AGORA_SITEURL = $SiteUrl
$env:AGORA_PORT = "$Port"
docker compose -f $Compose -p $Project up -d
if ($LASTEXITCODE -ne 0) { Die "docker compose up failed" }
Info "waiting for healthy..."
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    if ((docker inspect --format '{{.State.Health.Status}}' $Container 2>$null) -eq "healthy") { $ok = $true; break }
    Start-Sleep 3
}
if (-not $ok) { Die "server did not become healthy" }

# --- 4.5 build + install the Agora plugin (all backend features) ----------
# This is what brings the room relay, roles, codespace, voice, etc. into the fork. Without it
# the webapp tabs render but their backend 404s. (Linux/macOS up.sh runs this too.)
if (-not $SkipPlugin) {
    Info "building + installing the Agora plugin (com.aegis.agora)... (first build is slow)"
    wsl.exe -e bash -lc "cd '$RepoMnt' && bash agora/scripts/fork/plugin.sh"
    if ($LASTEXITCODE -ne 0) { Die "plugin build/install failed" }
}
else { Info "-SkipPlugin: leaving the installed plugin as-is" }

# --- 4.6 provision the room (admin + team + channels + brand) -------------
# Creates the agora team, the admin, and the default + feature channels (Voice Comms, role
# channels) so a non-dev opens to a laid-out room, not an empty server.
Info "provisioning room (admin, team, channels, brand)..."
wsl.exe -e bash -lc "cd '$RepoMnt' && bash agora/scripts/fork/provision.sh"

# --- 5. connector (codespace + agent replies) -----------------------------
if (Test-Path "$ConnDir\.env") {
    $running = @(Get-CimInstance Win32_Process -Filter "name='python.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'connector\.py' }).Count
    if ($running -eq 0) {
        Info "starting connector (detached)..."
        cmd /c "python -m pip install --quiet websockets >NUL 2>&1"  # cmd swallows pip's notices
        Start-Process -WindowStyle Hidden -FilePath python -ArgumentList "connector.py" -WorkingDirectory $ConnDir
        Start-Sleep 4
    }
    else { Info "connector already running" }
}

# --- done -----------------------------------------------------------------
Write-Host ""
Write-Host "  OK - Agora is up" -ForegroundColor Green
Write-Host "    Local:  http://localhost:$Port"
if ($CfUrl) { Write-Host "    Share:  $CfUrl   (anyone can join while this host runs)" -ForegroundColor Green }
Write-Host "    Login:  agoraadmin / Agora!admin1   (team: agora)"
Write-Host ""
