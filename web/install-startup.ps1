# Registers a per-user logon task that remounts E/H/J and starts the stack.
# Run once (as the logged-in user). Safe to re-run.

$ErrorActionPreference = "Stop"

$taskName = "MovieNight-StartStack"
$script = Join-Path $PSScriptRoot "start-stack.ps1"
if (-not (Test-Path $script)) {
  throw "Missing $script"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Remount NAS drives into Docker Desktop and start movie-night-manager" `
  -Force | Out-Null

Write-Host "Registered scheduled task '$taskName' (At logon for $env:USERNAME)."
Write-Host "It runs: $script"
Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State
