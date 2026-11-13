# Mappix Studio — start the servers automatically when you sign in to Windows.
#
#   powershell -ExecutionPolicy Bypass -File server\autostart.ps1            # install and start now
#   powershell -ExecutionPolicy Bypass -File server\autostart.ps1 -Remove    # uninstall
#
# Registers a per-user scheduled task, "MappixStudio-Servers", that runs
# server/supervise.mjs hidden at logon. The supervisor keeps the cache,
# accounts and studio servers up and restarts any that stop. Logs are in
# server\data\logs\. No administrator rights are needed.
param([switch]$Remove)

$TaskName = 'MappixStudio-Servers'
$Root = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed $TaskName. The servers will no longer start at sign-in."
  exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$Root\server\supervise.mjs`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Restart the supervisor itself if it ever stops; no time limit; run on battery.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Keeps the Mappix Studio servers (studio :5173, data :8788, accounts :8789) running.' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed $TaskName and started it. Mappix Studio: http://localhost:5173"
Write-Host "Logs: $Root\server\data\logs"
