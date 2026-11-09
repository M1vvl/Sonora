param([Parameter(Mandatory=$true)][string]$PreparedStage)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-entrypoints.ps1')
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$stageRoot = (Resolve-Path -LiteralPath $PreparedStage).ProviderPath
if (-not $stageRoot.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Prepared runtime must be inside release.' }
$stageInstall = Join-Path $stageRoot 'win-unpacked'
$installed = Join-Path $releaseRoot 'win-unpacked'
$stageAsar = Join-Path $stageInstall 'resources\app.asar'
$installedExe = Join-Path $installed 'Sonara.exe'
$legacyExe = Join-Path $installed 'Agent Pulse.exe'
$previousMain = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -in @($installedExe,$legacyExe) -and $_.CommandLine -notmatch ' --type=' })
$previousLaunchExe = if ($previousMain.Count -gt 0) { $previousMain[0].ExecutablePath } elseif (Test-Path -LiteralPath $installedExe) { $installedExe } else { $legacyExe }
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$output = Join-Path $projectRoot "artifacts\v$version-runtime"
New-Item -ItemType Directory -Path $output -Force | Out-Null

& node (Join-Path $projectRoot 'scripts\check-music-code-package.cjs') --root $stageAsar --report (Join-Path $output 'code-check.json')
if ($LASTEXITCODE -ne 0) { throw 'Prepared runtime code checks failed.' }
& node (Join-Path $projectRoot 'scripts\check-music-auth-restart.cjs') --root $stageAsar --output (Join-Path $output 'auth-restart')
if ($LASTEXITCODE -ne 0) { throw 'Prepared account restart checks failed.' }
& node (Join-Path $projectRoot 'scripts\check-dashboard-startup.cjs') --root $stageAsar --output (Join-Path $output 'dashboard-startup')
if ($LASTEXITCODE -ne 0) { throw 'Prepared dashboard startup checks failed.' }
if (-not (Test-Path -LiteralPath (Join-Path $stageInstall 'Sonara.exe'))) { throw 'Prepared Sonara executable is missing.' }

$backup = Join-Path $stageRoot ('transaction-backup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$replaced = @()
$committed = $false
$shortcutMigration = $null
$loginChanges = @()
$legacySaved = Join-Path $backup 'Agent Pulse.exe'
function Stop-CurrentRuntime {
  $entrypoints = @($installedExe,$legacyExe)
  $owned = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -in $entrypoints -and $_.CommandLine -notmatch ' --type=' })
  foreach ($entrypoint in @($owned.ExecutablePath | Sort-Object -Unique)) {
    Start-Process -FilePath $entrypoint -ArgumentList '--quit-for-update' -WindowStyle Hidden | Out-Null
  }
  if ($owned.Count -gt 0) {
    for ($attempt=0; $attempt -lt 16; $attempt++) {
      if (@(Get-Process -Id @($owned.ProcessId) -ErrorAction SilentlyContinue).Count -eq 0) { break }
      Start-Sleep -Milliseconds 250
    }
  }
  $allowedExecutables = @($installedExe,$legacyExe, (Join-Path $installed 'resources\native\audio\AgentPulse.AudioProbe.exe'), (Join-Path $installed 'resources\native\media\AgentPulse.MediaProbe.exe'), (Join-Path $installed 'resources\native\player\AgentPulse.Player.exe'))
  foreach ($owned in Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -in $allowedExecutables }) {
    Stop-Process -Id $owned.ProcessId -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $owned.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
  }
}

try {
  Stop-CurrentRuntime
  if (Test-Path -LiteralPath $legacyExe) { Copy-Item -LiteralPath $legacyExe -Destination $legacySaved -Force }
  foreach ($file in Get-ChildItem -LiteralPath $stageInstall -File -Recurse) {
    $relative = $file.FullName.Substring($stageInstall.Length + 1)
    $target = [IO.Path]::GetFullPath((Join-Path $installed $relative))
    if (-not $target.StartsWith($installed + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime copy escaped its installation.' }
    if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath $file.FullName).Hash) { continue }
    $saved = Join-Path $backup $relative
    if (Test-Path -LiteralPath $target) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $saved) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $saved -Force
    }
    $replaced += $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
  }
  & node (Join-Path $projectRoot 'scripts\check-music-code-package.cjs') --root (Join-Path $installed 'resources\app.asar') --report (Join-Path $output 'installed-code-check.json')
  if ($LASTEXITCODE -ne 0) { throw 'Installed runtime does not match the checked source.' }
  $running = Start-Process -FilePath $installedExe -ArgumentList '--island-only' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $output 'startup.stdout.log') -RedirectStandardError (Join-Path $output 'startup.stderr.log') -PassThru
  if ($running.WaitForExit(5000)) { throw 'Updated runtime exited during startup.' }
  $actualVersion = (Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
  if ([version]$actualVersion -ne [version]"$version.0") { throw 'Installed version mismatch.' }
  $shortcutMigration = Update-SonaraShortcuts -OldExecutable $legacyExe -NewExecutable $installedExe -BackupDirectory (Join-Path $backup 'shortcuts') -Candidates (Get-SonaraShortcutCandidates)
  $loginChanges = @(Update-SonaraLoginItems -OldExecutable $legacyExe -NewExecutable $installedExe)
  # Remove only the old stable executable, after package and startup checks.
  if (Test-Path -LiteralPath $legacyExe) { Remove-Item -LiteralPath $legacyExe -Force }
  [ordered]@{version=$version;productName='Sonara';updatedAt=(Get-Date).ToString('o');processId=$running.Id;replacedFiles=$replaced;shortcuts=@($shortcutMigration.Updates);startupItems=@($loginChanges | ForEach-Object Name);portableCreated=$false;codeScope='music-island-and-settings'} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $releaseRoot 'runtime-update.json') -Encoding utf8
  $committed = $true
  Write-Output "Updated Sonara runtime $version, PID $($running.Id), $($replaced.Count) changed files."
} catch {
  $failure = $_
  if (-not $committed) {
    Stop-CurrentRuntime
    foreach ($relative in $replaced) {
      $saved = Join-Path $backup $relative
      $target = [IO.Path]::GetFullPath((Join-Path $installed $relative))
      if (-not $target.StartsWith($installed + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Rollback copy escaped its installation.' }
      if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination $target -Force }
      elseif (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    }
    if (Test-Path -LiteralPath $legacySaved) { Copy-Item -LiteralPath $legacySaved -Destination $legacyExe -Force }
    if ($shortcutMigration) { Restore-SonaraShortcuts -Changes $shortcutMigration.Changes }
    Restore-SonaraLoginItems -Changes $loginChanges
    if (Test-Path -LiteralPath $previousLaunchExe) { Start-Process -FilePath $previousLaunchExe -ArgumentList '--island-only' -WindowStyle Hidden | Out-Null }
  }
  throw $failure
}
