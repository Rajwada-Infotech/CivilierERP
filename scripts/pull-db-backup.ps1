<#
  Copies the newest nightly database backup from the EC2 box to this PC.

  The nightly "Nightly database backup" workflow (.github/workflows/db-backup.yml) leaves the .bak files in
  /home/administrator/db-backups on the box. This fetches the newest one over SSH (scp), skips it if it is already
  here, checks the size matches, and keeps the newest -Keep files in -Dest.

  Run once by hand:
    powershell -ExecutionPolicy Bypass -File scripts\pull-db-backup.ps1 -Server <box IP or domain> -KeyPath C:\path\to\key

  Run it every morning automatically (registers a Windows scheduled task for the current user, 03:30 —
  an hour after the 02:00 IST backup):
    powershell -ExecutionPolicy Bypass -File scripts\pull-db-backup.ps1 -Server <box> -KeyPath <key> -Register

  Needs: the PC's IP allowed for SSH on the box (same as when you SSH in by hand), and the key for -User.
  The .bak is a full copy of the production database: keep -Dest on an encrypted / private drive.
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$User = "administrator",
  [string]$KeyPath = "",
  [string]$Dest = "C:\CivilierBackups",
  [int]$Keep = 7,
  [switch]$Register
)

$ErrorActionPreference = "Stop"
$RemoteDir = "/home/administrator/db-backups"

if ($Register) {
  $taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Server `"$Server`" -User `"$User`" -Dest `"$Dest`" -Keep $Keep"
  if ($KeyPath) { $taskArgs += " -KeyPath `"$KeyPath`"" }
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs
  $trigger = New-ScheduledTaskTrigger -Daily -At 3:30am
  # Runs when the PC was off at 03:30 as soon as it is next on.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName "Civilier DB backup download" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Scheduled: every day at 03:30 (or when the PC is next on). Task name: 'Civilier DB backup download'."
  exit 0
}

$sshOpts = @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new")
if ($KeyPath) { $sshOpts += @("-i", $KeyPath) }
$target = "$User@$Server"

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$log = Join-Path $Dest "pull-log.txt"
function Log($m) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"; Write-Host $line; Add-Content -Path $log -Value $line }

try {
  # Newest backup on the box, with its size in bytes.
  # No double quotes in the remote command: Windows PowerShell mangles them when calling ssh. File names have no spaces.
  $info = & ssh @sshOpts $target "f=`$(ls -1t $RemoteDir/*.bak 2>/dev/null | head -1); [ -z `$f ] || stat -c '%n %s' `$f"
  if ($LASTEXITCODE -ne 0 -or -not $info) { throw "No backup found in $RemoteDir on $Server (or SSH failed)." }
  $parts = "$info".Trim() -split " "
  $remoteFile = $parts[0]
  $remoteSize = [int64]$parts[-1]
  $name = Split-Path $remoteFile -Leaf
  $localFile = Join-Path $Dest $name

  if ((Test-Path $localFile) -and ((Get-Item $localFile).Length -eq $remoteSize)) {
    Log "Already have $name — nothing to do."
  } else {
    Log "Downloading $name ($([math]::Round($remoteSize / 1MB, 1)) MB)..."
    & scp @sshOpts "${target}:$remoteFile" "$localFile.part"
    if ($LASTEXITCODE -ne 0) { throw "scp failed." }
    if ((Get-Item "$localFile.part").Length -ne $remoteSize) { Remove-Item "$localFile.part"; throw "Size mismatch — download discarded." }
    Move-Item -Force "$localFile.part" $localFile
    Log "Saved $localFile"
  }

  # Keep the newest $Keep backups here.
  Get-ChildItem -Path $Dest -Filter *.bak | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep |
    ForEach-Object { Remove-Item $_.FullName; Log "Removed old $($_.Name)" }
} catch {
  Log "FAILED: $($_.Exception.Message)"
  exit 1
}
