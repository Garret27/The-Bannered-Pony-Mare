# Requires Administrator. Makes Movie Night Manager reachable on the LAN.
# Usage (elevated PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\allow-lan-access.ps1

$ErrorActionPreference = "Stop"
$ruleName = "Movie Night Manager (Docker :3080)"
$port = 3080

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated PowerShell window (Run as administrator)."
}

Get-NetConnectionProfile | Where-Object {
  $_.InterfaceAlias -match 'Ethernet|Wi-Fi|WiFi' -and $_.NetworkCategory -ne 'Private'
} | ForEach-Object {
  Write-Host "Setting $($_.InterfaceAlias) ($($_.Name)) from $($_.NetworkCategory) -> Private"
  Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
}

# Remove the old :3000 LAN rule if present; Docker keeps 3000 localhost-only.
Get-NetFirewallRule -DisplayName "Movie Night Manager (Docker :3000)" -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $port `
    -Profile Private,Domain,Public `
    -Description "Allow LAN access to Movie Night Manager on Docker Desktop port $port" | Out-Null
  Write-Host "Created firewall rule: $ruleName"
} else {
  Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Profile Private,Domain,Public -Action Allow
  Write-Host "Updated firewall rule: $ruleName"
}

Get-NetFirewallRule -DisplayName "Docker Desktop Backend" -ErrorAction SilentlyContinue |
  ForEach-Object {
    Set-NetFirewallRule -Name $_.Name -Enabled True -Action Allow -Profile Private,Domain,Public
    Write-Host "Enabled $($_.DisplayName)"
  }

# Clear obsolete portproxy entries for 3000 / 3080.
foreach ($listen in @("0.0.0.0", "192.168.0.50")) {
  foreach ($p in @(3000, 3080)) {
    netsh interface portproxy delete v4tov4 listenaddress=$listen listenport=$p 2>$null | Out-Null
  }
}

try {
  $vmCreator = "{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}"
  $hvRule = "Movie Night Manager Hyper-V :$port"
  Get-NetFirewallHyperVRule -DisplayName "Movie Night Manager Hyper-V :3000" -ErrorAction SilentlyContinue |
    Remove-NetFirewallHyperVRule -ErrorAction SilentlyContinue
  if (-not (Get-NetFirewallHyperVRule -DisplayName $hvRule -ErrorAction SilentlyContinue)) {
    New-NetFirewallHyperVRule `
      -DisplayName $hvRule `
      -Direction Inbound `
      -VMCreatorId $vmCreator `
      -Protocol TCP `
      -LocalPorts $port `
      -Action Allow | Out-Null
    Write-Host "Created Hyper-V firewall rule: $hvRule"
  }
} catch {
  Write-Host "Hyper-V firewall rule skipped: $($_.Exception.Message)"
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like '192.168.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -First 1 -ExpandProperty IPAddress)

# Mirrored WSL networking: allow this PC to reach services via its own LAN IP.
# Requires [experimental] hostAddressLoopback=true in %USERPROFILE%\.wslconfig
# (then wsl --shutdown and restart Docker Desktop).
try {
  Set-NetFirewallHyperVVMSetting `
    -Name "{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}" `
    -DefaultInboundAction Allow `
    -ErrorAction Stop
  Write-Host "Hyper-V VM default inbound action: Allow"
} catch {
  Write-Host "Hyper-V VM inbound setting skipped: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Done. On this PC:     http://localhost:3000/"
Write-Host "Also on this PC:     http://127.0.0.1:$port/"
Write-Host "From the LAN use:    http://${ip}:$port/"
Write-Host ""
Write-Host "If http://${ip}:$port/ fails on this PC but works from a phone, enable"
Write-Host "hostAddressLoopback=true under [experimental] in %USERPROFILE%\.wslconfig,"
Write-Host "then run: wsl --shutdown  (and restart Docker Desktop)."
