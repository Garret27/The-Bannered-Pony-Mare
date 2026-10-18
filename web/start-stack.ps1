# Remount E/H/J into Docker Desktop's WSL VM, start the Jellyfin forwarder inside
# that VM, then bring the compose stack up. Prefer this over plain `docker compose up`.
# Also starts stack-helper.py so the Converter popup "Remount drives" button works.

$ErrorActionPreference = "Stop"

function Ensure-DockerDesktopBoot {
  $confSrc = Join-Path $PSScriptRoot ".docker-desktop-wsl.conf"
  $bootSrc = Join-Path $PSScriptRoot "docker-desktop-boot.sh"
  if (-not (Test-Path $confSrc) -or -not (Test-Path $bootSrc)) {
    throw "Missing docker-desktop boot files in $PSScriptRoot"
  }

  # Keep LF line endings for the shell scripts (WSL is picky about CRLF).
  python -c "import pathlib; p=pathlib.Path(r'$bootSrc'); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n'))"

  wsl -d docker-desktop -- sh -c "cp '/mnt/host/d/OneDrive/Pictures/The-Bannered-Pony-Mare/The-Bannered-Pony-Mare/web/.docker-desktop-wsl.conf' /etc/wsl.conf && chmod +x '/mnt/host/d/OneDrive/Pictures/The-Bannered-Pony-Mare/The-Bannered-Pony-Mare/web/docker-desktop-boot.sh' && '/mnt/host/d/OneDrive/Pictures/The-Bannered-Pony-Mare/The-Bannered-Pony-Mare/web/docker-desktop-boot.sh'"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start Docker Desktop Jellyfin forwarder / NAS mounts."
  }
}

function Ensure-StackHelper {
  $helper = Join-Path $PSScriptRoot "stack-helper.py"
  if (-not (Test-Path $helper)) {
    Write-Host "stack-helper.py missing - Converter remount button will not work."
    return
  }

  $listening = $false
  try {
    $listening = [bool](Get-NetTCPConnection -LocalPort 18097 -State Listen -ErrorAction SilentlyContinue)
  } catch {}

  if ($listening) {
    Write-Host "Stack helper already running on http://127.0.0.1:18097/"
    return
  }

  Write-Host "Starting stack helper on http://127.0.0.1:18097/ ..."
  $exe = Join-Path $PSScriptRoot "dist\MovieNightHelper\MovieNightHelper.exe"
  if (Test-Path $exe) {
    Start-Process -FilePath $exe -WindowStyle Hidden | Out-Null
  } else {
    $pythonw = (Get-Command pythonw -ErrorAction SilentlyContinue).Source
    if (-not $pythonw) {
      $pythonw = Join-Path (Split-Path (Get-Command python).Source) "pythonw.exe"
    }
    Start-Process -FilePath $pythonw -ArgumentList @($helper) -WindowStyle Hidden | Out-Null
  }
  Start-Sleep -Seconds 1
}

Write-Host "Starting Docker Desktop Jellyfin forwarder + NAS mounts..."
Ensure-DockerDesktopBoot

Ensure-StackHelper

Write-Host "Starting movie-night-manager..."
Set-Location $PSScriptRoot
# Force recreate so bind mounts pick up freshly remounted E/H/J drives.
docker compose up -d --force-recreate converter-agent movie-night-web
docker compose up -d
docker compose ps
