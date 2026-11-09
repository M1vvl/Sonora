param([string]$PreparedStage,[switch]$SkipVideoPlayerIntegration,[switch]$IncludeMediaFeatureChecks,[switch]$MusicCodeOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-entrypoints.ps1')
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [version]$package.version
$name = "Sonara-$version-Windows.exe"
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

function Assert-ReleasePath([string]$value) {
  $absolute = [System.IO.Path]::GetFullPath($value)
  if (Test-Path -LiteralPath $absolute) { $absolute = (Resolve-Path -LiteralPath $absolute).ProviderPath }
  if (-not $absolute.StartsWith($releaseRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe release target: $absolute" }
  return $absolute
}
function Get-ReleaseSHA256([string]$file) {
  $stream = [IO.File]::OpenRead($file)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','') }
  finally { $hasher.Dispose(); $stream.Dispose() }
}
function Stop-InstalledApp([string]$directory) {
  $directory = Assert-ReleasePath $directory
  $entrypoints = @((Join-Path $directory 'Sonara.exe'),(Join-Path $directory 'Agent Pulse.exe'))
  $audio = Join-Path $directory 'resources\native\audio\AgentPulse.AudioProbe.exe'
  $media = Join-Path $directory 'resources\native\media\AgentPulse.MediaProbe.exe'
  $player = Join-Path $directory 'resources\native\player\AgentPulse.Player.exe'
  # Newer installations can flush their current queue/time before replacement.
  # Older builds do not recognize the fixed command, so do not launch it there.
  foreach ($exe in $entrypoints) {
    if (Test-Path -LiteralPath $exe) {
      $canQuit = [version](Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -ge [version]'0.3.21.0'
      $main = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch ' --type=' })
      if ($canQuit -and $main.Count -gt 0) {
        Start-Process -FilePath $exe -ArgumentList '--quit-for-update' -WindowStyle Hidden | Out-Null
        for ($wait = 0; $wait -lt 12; $wait++) {
          if (@(Get-Process -Id @($main.ProcessId) -ErrorAction SilentlyContinue).Count -eq 0) { break }
          Start-Sleep -Milliseconds 250
        }
      }
    }
  }
  # A child or a second shortcut launch can appear after the initial snapshot.
  # Recheck twice, matching only this installation's exact executable paths.
  for ($pass = 0; $pass -lt 3; $pass++) {
    $owned = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -in $entrypoints -or $_.ExecutablePath -eq $audio -or $_.ExecutablePath -eq $media -or $_.ExecutablePath -eq $player })
    if ($owned.Count -eq 0) { return }
    foreach ($process in $owned) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($process in $owned) { Wait-Process -Id $process.ProcessId -Timeout 5 -ErrorAction SilentlyContinue }
  }
  $remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -in $entrypoints -or $_.ExecutablePath -eq $audio -or $_.ExecutablePath -eq $media -or $_.ExecutablePath -eq $player })
  if ($remaining.Count -gt 0) { throw "Owned application processes did not stop: $($remaining.ProcessId -join ', ')" }
}
function Test-SharingViolation([System.Exception]$errorValue) {
  while ($null -ne $errorValue) {
    # ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION. Other errors must fail
    # immediately, rather than being hidden by a generic retry loop.
    if (($errorValue.HResult -band 0xffff) -in @(32, 33)) { return $true }
    $errorValue = $errorValue.InnerException
  }
  return $false
}
function Copy-ReleaseFile([string]$source, [string]$target, [string]$destination) {
  $source = Assert-ReleasePath $source
  $target = Assert-ReleasePath $target
  $destination = Assert-ReleasePath $destination
  $stable = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot 'win-unpacked'))
  $retryStable = $destination.Equals($stable, [System.StringComparison]::OrdinalIgnoreCase)
  $delays = @(250, 500, 1000, 2000, 2000)
  for ($attempt = 0; ; $attempt++) {
    try { Copy-Item -LiteralPath $source -Destination $target -Force; return }
    catch {
      if (-not $retryStable -or $attempt -ge $delays.Count -or -not (Test-SharingViolation $_.Exception)) { throw }
      Write-Verbose "Waiting for an installation file lock: $target (retry $($attempt + 1)/$($delays.Count))"
      Stop-InstalledApp $destination
      Start-Sleep -Milliseconds $delays[$attempt]
    }
  }
}
function Copy-Installation([string]$source, [string]$destination) {
  $source = Assert-ReleasePath $source
  $destination = Assert-ReleasePath $destination
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File -Force) {
    $relative = $file.FullName.Substring($source.Length).TrimStart('\')
    $target = Assert-ReleasePath (Join-Path $destination $relative)
    New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($target)) -Force | Out-Null
    Copy-ReleaseFile $file.FullName $target $destination
  }
}

$lock = $null
$stage = if ($PreparedStage) { Assert-ReleasePath $PreparedStage } else { Assert-ReleasePath (Join-Path $releaseRoot ".staging\$version-$PID") }
$installed = Assert-ReleasePath (Join-Path $releaseRoot 'win-unpacked')
$installedExe = Join-Path $installed 'Sonara.exe'
$legacyExe = Join-Path $installed 'Agent Pulse.exe'
$previousMain = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -in @($installedExe,$legacyExe) -and $_.CommandLine -notmatch ' --type=' })
$previousLaunchExe = if ($previousMain.Count -gt 0) { $previousMain[0].ExecutablePath } elseif (Test-Path -LiteralPath $installedExe) { $installedExe } else { $legacyExe }
$backup = Assert-ReleasePath (Join-Path $stage ('previous-install-' + [guid]::NewGuid().ToString('N')))
$backupReady = $false
$oldStopped = $false
$replacementStarted = $false
$launched = $false
$shortcutMigration = $null
$loginChanges = @()
$previousSmokeOutput = $env:PULSE_SMOKE_OUTPUT
$previousMediaSample = $env:PULSE_MEDIA_SAMPLE
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
$previousCompression = $env:ELECTRON_BUILDER_COMPRESSION_LEVEL
$previousIncludeMedia = $env:PULSE_INCLUDE_MEDIA_CHECKS
try {
  $lock = [System.IO.File]::Open((Join-Path $releaseRoot '.release.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  $existing = @(Get-ChildItem -LiteralPath $releaseRoot -File | Where-Object Name -Match '^(?:Sonara|Agent-Pulse)-(\d+\.\d+\.\d+)-Windows\.exe$')
  if ($existing | Where-Object { [version]([regex]::Match($_.Name, '(?:Sonara|Agent-Pulse)-(.+)-Windows').Groups[1].Value) -gt $version }) { throw 'A newer release already exists; refusing to replace or prune it.' }
  if (-not $PreparedStage) {
    if (Test-Path -LiteralPath $stage) { throw "Staging directory already exists: $stage" }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Push-Location $projectRoot
    try {
      # Build and validate separately while the existing app stays available.
      if (-not $env:ELECTRON_BUILDER_COMPRESSION_LEVEL) { $env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '3' }
      & npm.cmd run dist -- "--config.directories.output=$stage"
      if ($LASTEXITCODE -ne 0) { throw 'Release build failed; installed app was not replaced.' }
    } finally { Pop-Location }
  } elseif (-not (Test-Path -LiteralPath (Join-Path $stage 'win-unpacked')) -and (Test-Path -LiteralPath (Join-Path $stage 'failed-install'))) {
    Move-Item -LiteralPath (Assert-ReleasePath (Join-Path $stage 'failed-install')) -Destination (Assert-ReleasePath (Join-Path $stage 'win-unpacked'))
  }
  $stageInstall = Assert-ReleasePath (Join-Path $stage 'win-unpacked')
  $stageExe = Assert-ReleasePath (Join-Path $stageInstall 'Sonara.exe')
  $portable = Assert-ReleasePath (Join-Path $stage $name)
  if (-not (Test-Path -LiteralPath $portable)) { throw 'Portable release is missing.' }
  if ($MusicCodeOnly) {
    # User explicitly reserves all visual acceptance and non-music verification.
    # Check the staged music code, source equality and encrypted restart only.
    $out = Join-Path $projectRoot "artifacts\v$version-packaged"
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    $reportPath = Join-Path $out 'music-code-release-report.json'
    $probeStarted = Get-Date
    & node (Join-Path $projectRoot 'scripts\check-music-code-package.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --report $reportPath
    if ($LASTEXITCODE -ne 0) { throw 'Packaged music code audit failed; installed app was not replaced.' }
    & node (Join-Path $projectRoot 'scripts\check-music-auth-restart.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'music-auth-restart')
    if ($LASTEXITCODE -ne 0) { throw 'Packaged encrypted login restart checks failed; installed app was not replaced.' }
    $skippedSmokeChecks = @('monitor','island-visual-review','music-visual-review','anime','movies','video-player')
  } else {
  $audioExe = Join-Path $stageInstall 'resources\native\audio\AgentPulse.AudioProbe.exe'
  $mediaExe = Join-Path $stageInstall 'resources\native\media\AgentPulse.MediaProbe.exe'
  & $audioExe --self-test
  if ($LASTEXITCODE -ne 0) { throw 'Packaged audio self-test failed.' }
  $out = Join-Path $projectRoot "artifacts\v$version-packaged"
  New-Item -ItemType Directory -Path $out -Force | Out-Null
  $rawMedia = @(& $mediaExe --probe-duration 2)
  if ($LASTEXITCODE -ne 0) { throw 'Packaged media component failed.' }
  $sample = @($rawMedia | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object available -eq $true | Select-Object -Last 1)
  $env:PULSE_MEDIA_SAMPLE = $null
  if ($sample.Count -gt 0) {
    $env:PULSE_MEDIA_SAMPLE = Join-Path $out 'media-sample.json'
    [System.IO.File]::WriteAllText($env:PULSE_MEDIA_SAMPLE, ($sample[0] | ConvertTo-Json -Depth 5 -Compress), [System.Text.UTF8Encoding]::new($false))
  }
  $env:PULSE_INCLUDE_MEDIA_CHECKS = if ($IncludeMediaFeatureChecks) { '1' } else { $null }
  $env:PULSE_SMOKE_OUTPUT = $out
  $env:ELECTRON_RUN_AS_NODE = $null
  $reportPath = Join-Path $out 'smoke-report.json'
  $skippedSmokeChecks = @()
  if ($SkipVideoPlayerIntegration) {
    # Explicit user opt-out: preserve the real failed report; never change its
    # false value to true. Reuse only proof from this exact, unchanged build.
    if (-not (Test-Path -LiteralPath $reportPath)) { throw 'Manual video opt-out needs an existing smoke report for this build.' }
    $prior = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $priorProcess = Get-Content -LiteralPath (Join-Path $out 'smoke-process.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $stageAsar = Join-Path $stageInstall 'resources\app.asar'
    if ($prior.version -ne "$version" -or [IO.Path]::GetFullPath($prior.player.root) -ne [IO.Path]::GetFullPath($stageAsar) -or (Get-Item -LiteralPath $reportPath).LastWriteTime -lt (Get-Item -LiteralPath $stageAsar).LastWriteTime -or (Get-Item -LiteralPath $reportPath).LastWriteTime -lt (Get-Item -LiteralPath $stageExe).LastWriteTime) { throw 'Existing smoke report does not prove this unchanged staged build.' }
    $skippedSmokeChecks = @($prior.player.checks.PSObject.Properties.Name) + @('playerIntegration','playbackHistoryOnHome')
    $probeStarted = [datetime]$priorProcess.startedAt
    $probeExit = $priorProcess.exitCode
    [ordered]@{userRequested=$true;skipped=(@($skippedSmokeChecks) + $(if (-not $IncludeMediaFeatureChecks) { @('anime','movies','video-player') } else { @() }));originalExitCode=$probeExit;asarSHA256=(Get-ReleaseSHA256 $stageAsar);reportSHA256=(Get-ReleaseSHA256 $reportPath);reason='Video player integration reserved for user manual review; all other gates remain required.'} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $out 'manual-video-review.json') -Encoding utf8
    Write-Output 'Video player integration skipped at user request; reusing unchanged-build smoke proof and running every other release gate.'
  } else {
    $probeStarted = Get-Date
    $probe = Start-Process -FilePath $stageExe -ArgumentList '--smoke-test' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    $probeProcessHandle = $probe.Handle
    if (-not $probe.WaitForExit(240000)) { Stop-InstalledApp $stageInstall; throw 'Packaged checks timed out.' }
    $probe.Refresh()
    $probeExit = $probe.ExitCode
    [ordered]@{processId=$probe.Id;exitCode=$probeExit;startedAt=$probeStarted.ToString('o');reportPresent=(Test-Path -LiteralPath $reportPath)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'smoke-process.json') -Encoding utf8
  }
  if ($null -eq $probeExit -or ($probeExit -ne 0 -and -not $SkipVideoPlayerIntegration) -or -not (Test-Path -LiteralPath $reportPath)) { throw "Packaged checks failed (exit $probeExit); see smoke-process.json." }
  # Exercise normal main/preload/window destruction against the staged archive,
  # with a dedicated profile and synthetic conversation logs.
  $previousRestartRoot = $env:PULSE_RESTART_ROOT
  $previousDashboardRestartOutput = $env:PULSE_DASHBOARD_RESTART_OUTPUT
  try {
    $env:PULSE_RESTART_ROOT = Join-Path $stageInstall 'resources\app.asar'
    $env:PULSE_DASHBOARD_RESTART_OUTPUT = Join-Path $out 'dashboard-restart'
    & node (Join-Path $projectRoot 'scripts\check-dashboard-restart.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Packaged dashboard state restart checks failed; installed app was not replaced.' }
  } finally {
    $env:PULSE_RESTART_ROOT = $previousRestartRoot
    $env:PULSE_DASHBOARD_RESTART_OUTPUT = $previousDashboardRestartOutput
  }
  if ($IncludeMediaFeatureChecks) {
  $previousMoviesRoot = $env:PULSE_MOVIES_ROOT
  $previousMoviesOutput = $env:PULSE_MOVIES_OUTPUT
  $previousSkipVideo = $env:PULSE_SKIP_VIDEO_INTEGRATION
  try {
    $env:PULSE_SKIP_VIDEO_INTEGRATION = if ($SkipVideoPlayerIntegration) { '1' } else { $null }
    $env:PULSE_MOVIES_ROOT = Join-Path $stageInstall 'resources\app.asar'
    $env:PULSE_MOVIES_OUTPUT = Join-Path $out 'movies'
    & node (Join-Path $projectRoot 'scripts\check-movies.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Packaged movies/fresh-profile checks failed; installed app was not replaced.' }
  } finally {
    $env:PULSE_MOVIES_ROOT = $previousMoviesRoot
    $env:PULSE_MOVIES_OUTPUT = $previousMoviesOutput
    $env:PULSE_SKIP_VIDEO_INTEGRATION = $previousSkipVideo
  }
  }
  $previousMusicRoot = $env:PULSE_MUSIC_ROOT
  $previousMusicOutput = $env:PULSE_MUSIC_OUTPUT
  try {
    $env:PULSE_MUSIC_ROOT = Join-Path $stageInstall 'resources\app.asar'
    $env:PULSE_MUSIC_OUTPUT = Join-Path $out 'music'
    & node (Join-Path $projectRoot 'scripts\check-music.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Packaged music login UI checks failed; installed app was not replaced.' }
  } finally {
    $env:PULSE_MUSIC_ROOT = $previousMusicRoot
    $env:PULSE_MUSIC_OUTPUT = $previousMusicOutput
  }
  & node (Join-Path $projectRoot 'scripts\check-music-auth.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'music-auth')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged official QR/encrypted-store checks failed; installed app was not replaced.' }
  & node (Join-Path $projectRoot 'scripts\check-music-auth-restart.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'music-auth-restart')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged encrypted login restart checks failed; installed app was not replaced.' }
  & node (Join-Path $projectRoot 'scripts\check-music-cards.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'music-cards')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged music card GPU checks failed; installed app was not replaced.' }
  & node (Join-Path $projectRoot 'scripts\check-covers.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'covers')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged cover loading checks failed; installed app was not replaced.' }
  & node (Join-Path $projectRoot 'scripts\check-music-network-storage.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'music-network-storage')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged music network-only storage checks failed; installed app was not replaced.' }
  if ($IncludeMediaFeatureChecks) {
  & node (Join-Path $projectRoot 'scripts\check-anime-featured.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'anime-featured')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged anime featured rotation checks failed; installed app was not replaced.' }
  & node (Join-Path $projectRoot 'scripts\check-movie-motion.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'movie-motion')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged movie gesture checks failed; installed app was not replaced.' }
  }
  & node (Join-Path $projectRoot 'scripts\check-island-recovery.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'island-recovery')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged island recovery checks failed; installed app was not replaced.' }
  & node (Join-Path $projectRoot 'scripts\check-scope-runtime.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --output (Join-Path $out 'scope-runtime')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged Electron SQLite/scope checks failed; installed app was not replaced.' }
  & node (Join-Path $projectRoot 'scripts\check-music-code-package.cjs') --root (Join-Path $stageInstall 'resources\app.asar') --report (Join-Path $out 'music-code-check.json')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged music code checks failed; installed app was not replaced.' }

  }

  if ((Get-Item -LiteralPath $reportPath).LastWriteTime -lt $probeStarted.AddSeconds(-1)) { throw 'Packaged report is stale.' }
  $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($report.version -ne "$version" -or (-not $MusicCodeOnly -and @($report.rendererErrors).Count -gt 0) -or ($MusicCodeOnly -and @($report.errors).Count -gt 0) -or @($report.interaction.PSObject.Properties | Where-Object { $_.Name -notin $skippedSmokeChecks -and $_.Value -ne $true }).Count -gt 0) { throw 'Packaged checks reported an error.' }

  # Only touch the stable installation after all staged checks pass.
  Stop-InstalledApp $installed
  $oldStopped = $true
  # Keep the root directory stable: shell extensions can hold a directory handle
  # even after the application exits. Back up and copy files while it is stopped.
  if (Test-Path -LiteralPath $installed) { Copy-Installation $installed $backup; $backupReady = $true }
  $replacementStarted = $true
  Copy-Installation $stageInstall $installed
  $expectedIsland = $true
  $settingsFile = Join-Path $env:APPDATA 'Agent Pulse\settings.json'
  if (Test-Path -LiteralPath $settingsFile) {
    $savedSettings = Get-Content -LiteralPath $settingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($savedSettings.islandEnabled -is [bool]) { $expectedIsland = $savedSettings.islandEnabled }
  }
  $proofPath = Assert-ReleasePath (Join-Path $installed 'resources\runtime-proof.json')
  if (Test-Path -LiteralPath $proofPath) { Remove-Item -LiteralPath $proofPath -Force }
  $startupAt = Get-Date
  $startupArguments = if ($MusicCodeOnly) { @('--island-only') } else { @('--island-only','--runtime-check') }
  $running = Start-Process -FilePath $installedExe -ArgumentList $startupArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out 'startup.stdout.log') -RedirectStandardError (Join-Path $out 'startup.stderr.log') -PassThru
  $startupProcessHandle = $running.Handle
  if ($running.WaitForExit(5000)) {
    $running.Refresh()
    $startupExit = $running.ExitCode
    # A user can launch the shortcut during replacement. An exiting second
    # instance is successful only if a new exact-path main process exists.
    $existingMain = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $installedExe -and $_.CommandLine -notmatch ' --type=' -and $_.CreationDate -ge $startupAt.AddSeconds(-5) })
    [ordered]@{exitCode=$startupExit;otherMainProcesses=@($existingMain.ProcessId)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'startup.json') -Encoding utf8
    if ($startupExit -eq 0 -and $existingMain.Count -eq 1) { $running = Get-Process -Id $existingMain[0].ProcessId }
    else { throw "New installation exited during startup (exit $startupExit); see startup.stderr.log." }
  }
  $running.Refresh()
  $productVersion = (Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
  if ([version]$productVersion -ne [version]"$version.0") { throw "Installed executable version mismatch: $productVersion" }
  # This one-shot check records only DOM presence, alpha counts and geometry;
  # it does not save a screenshot or send mouse input. Disabled islands stay off.
  if ($expectedIsland -and -not $MusicCodeOnly) {
    for ($attempt = 0; $attempt -lt 30 -and -not (Test-Path -LiteralPath $proofPath); $attempt++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Path -LiteralPath $proofPath)) { throw 'Installed island did not produce a startup proof; keeping the previous release available.' }
    $proof = Get-Content -LiteralPath $proofPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($proof.version -ne "$version" -or $proof.pid -ne $running.Id -or -not $proof.islandVisible -or -not $proof.islandMounted -or $proof.paintedPixels -lt 100 -or (Get-Item -LiteralPath $proofPath).LastWriteTime -lt $startupAt.AddSeconds(-1)) { throw 'Installed island startup proof failed; restoring the previous installation.' }
    Copy-Item -LiteralPath $proofPath -Destination (Join-Path $out 'installed-island-proof.json') -Force
  }
  Copy-Item -LiteralPath $portable -Destination (Assert-ReleasePath (Join-Path $releaseRoot $name)) -Force
  $shortcutMigration = Update-SonaraShortcuts -OldExecutable $legacyExe -NewExecutable $installedExe -BackupDirectory (Join-Path $stage 'shortcut-backup') -Candidates (Get-SonaraShortcutCandidates)
  $loginChanges = @(Update-SonaraLoginItems -OldExecutable $legacyExe -NewExecutable $installedExe)
  if (Test-Path -LiteralPath $legacyExe) { Remove-Item -LiteralPath (Assert-ReleasePath $legacyExe) -Force }
  $launched = $true

  # Preserve the current and preceding Sonara portable. Legacy-named archives
  # are outside this rename migration and are left for explicit user cleanup.
  $releases = @(Get-ChildItem -LiteralPath $releaseRoot -File | Where-Object Name -Match '^Sonara-(\d+\.\d+\.\d+)-Windows\.exe$' | Sort-Object { [version]([regex]::Match($_.Name, 'Sonara-(.+)-Windows').Groups[1].Value) } -Descending)
  $retained = @($releases | Select-Object -First 2)
  $removed = @($releases | Select-Object -Skip 2)
  foreach ($file in $removed) { Remove-Item -LiteralPath (Assert-ReleasePath $file.FullName) -Force }
  Remove-Item -LiteralPath (Assert-ReleasePath $stage) -Recurse -Force
  [ordered]@{ version="$version"; releasedAt=(Get-Date).ToString('o'); processId=$running.Id; checks=@($report.interaction.PSObject.Properties | Where-Object { $_.Name -notin $skippedSmokeChecks }).Count; skipped=$skippedSmokeChecks; retained=@($retained.Name); removed=@($removed.Name) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releaseRoot 'release-manifest.json') -Encoding utf8
  Write-Output "Released $version; running PID $($running.Id); retained: $($retained.Name -join ', ')"
} catch {
  $releaseFailure = $_
  try {
    if (-not $launched -and $replacementStarted -and $backupReady -and (Test-Path -LiteralPath $backup)) {
      Stop-InstalledApp $installed
      Copy-Installation $backup $installed
      if (-not (Test-Path -LiteralPath (Join-Path $backup 'Sonara.exe')) -and (Test-Path -LiteralPath $installedExe)) { Remove-Item -LiteralPath (Assert-ReleasePath $installedExe) -Force }
      if ($shortcutMigration) { Restore-SonaraShortcuts -Changes $shortcutMigration.Changes }
      Restore-SonaraLoginItems -Changes $loginChanges
      # Start only after every backup file was successfully restored.
      Start-Process -FilePath $previousLaunchExe -ArgumentList '--island-only' -WorkingDirectory $projectRoot -WindowStyle Hidden
    } elseif (-not $launched -and -not $replacementStarted -and $oldStopped -and (Test-Path -LiteralPath $previousLaunchExe)) {
      Start-Process -FilePath $previousLaunchExe -ArgumentList '--island-only' -WorkingDirectory $projectRoot -WindowStyle Hidden
    }
  } catch {
    throw "Release failed: $($releaseFailure.Exception.Message) Rollback also failed: $($_.Exception.Message). The incomplete installation was not started. Backup remains at $backup"
  }
  throw $releaseFailure
} finally {
  $env:PULSE_SMOKE_OUTPUT = $previousSmokeOutput
  $env:PULSE_MEDIA_SAMPLE = $previousMediaSample
  $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
  $env:ELECTRON_BUILDER_COMPRESSION_LEVEL = $previousCompression
  $env:PULSE_INCLUDE_MEDIA_CHECKS = $previousIncludeMedia
  if ($lock) { $lock.Dispose() }
}
