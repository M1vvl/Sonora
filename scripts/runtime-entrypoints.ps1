# Shared shortcut migration for the incremental updater and explicit releases.
# Only a shortcut already targeting this installation's exact old executable
# is eligible. Unrelated shortcuts, including an occupied Sonara.lnk, are kept.
function Get-SonaraShortcutCandidates {
  $candidates = @('D:\Table\Agent Pulse.lnk')
  foreach ($directory in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('CommonDesktopDirectory'))) {
    if ($directory -and (Test-Path -LiteralPath $directory)) {
      $candidates += Get-ChildItem -LiteralPath $directory -File -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object FullName
    }
  }
  foreach ($directory in @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'))) {
    if ($directory -and (Test-Path -LiteralPath $directory)) {
      $candidates += Get-ChildItem -LiteralPath $directory -File -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object FullName
    }
  }
  $pinned = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
  if (Test-Path -LiteralPath $pinned) {
    $candidates += Get-ChildItem -LiteralPath $pinned -File -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object FullName
  }
  return @($candidates | Sort-Object -Unique)
}

function Restore-SonaraShortcuts([object[]]$Changes) {
  foreach ($change in $Changes) {
    if ($change.Backup -and (Test-Path -LiteralPath $change.Backup)) {
      Copy-Item -LiteralPath $change.Backup -Destination $change.Path -Force
    } elseif (-not $change.Existed -and (Test-Path -LiteralPath $change.Path)) {
      Remove-Item -LiteralPath $change.Path -Force
    }
  }
}

function Update-SonaraShortcuts([string]$OldExecutable, [string]$NewExecutable, [string]$BackupDirectory, [string[]]$Candidates) {
  $oldPath = [IO.Path]::GetFullPath($OldExecutable)
  $newPath = [IO.Path]::GetFullPath($NewExecutable)
  if (-not (Test-Path -LiteralPath $newPath -PathType Leaf)) { throw 'Sonara executable must be verified before migrating shortcuts.' }
  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
  $changes = [Collections.Generic.List[object]]::new()
  $updates = [Collections.Generic.List[object]]::new()
  $shellObject = New-Object -ComObject WScript.Shell
  try {
    foreach ($candidate in @($Candidates | Sort-Object -Unique)) {
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf) -or [IO.Path]::GetExtension($candidate) -ne '.lnk') { continue }
      $link = $shellObject.CreateShortcut($candidate)
      try {
        if (-not $link.TargetPath -or -not [IO.Path]::GetFullPath($link.TargetPath).Equals($oldPath,[StringComparison]::OrdinalIgnoreCase)) { continue }
        $destination = $candidate
        $renamed = $false
        if ([IO.Path]::GetFileName($candidate) -eq 'Agent Pulse.lnk') {
          $named = Join-Path (Split-Path -Parent $candidate) 'Sonara.lnk'
          if (-not (Test-Path -LiteralPath $named)) { $destination = $named; $renamed = $true }
        }
        foreach ($file in @($candidate,$destination) | Sort-Object -Unique) {
          $exists = Test-Path -LiteralPath $file
          $saved = if ($exists) { Join-Path $BackupDirectory ("shortcut-$($changes.Count).lnk") } else { $null }
          if ($exists) { Copy-Item -LiteralPath $file -Destination $saved -Force }
          $changes.Add([pscustomobject]@{Path=$file;Backup=$saved;Existed=$exists})
        }
        $updated = $shellObject.CreateShortcut($destination)
        try {
          $updated.TargetPath = $newPath
          $updated.Arguments = $link.Arguments
          $updated.WorkingDirectory = $link.WorkingDirectory
          $updated.Hotkey = $link.Hotkey
          $updated.WindowStyle = $link.WindowStyle
          $updated.IconLocation = "$newPath,0"
          $updated.Description = 'Sonara'
          $updated.Save()
        } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($updated) | Out-Null }
        $verified = $shellObject.CreateShortcut($destination)
        try {
          if (-not [IO.Path]::GetFullPath($verified.TargetPath).Equals($newPath,[StringComparison]::OrdinalIgnoreCase)) { throw 'Migrated shortcut target verification failed.' }
        } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($verified) | Out-Null }
        if ($renamed) { Remove-Item -LiteralPath $candidate -Force }
        $updates.Add([pscustomobject]@{Path=$destination;Renamed=$renamed;PreviousPath=$candidate})
      } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null }
    }
  } catch {
    Restore-SonaraShortcuts -Changes $changes.ToArray()
    throw
  } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shellObject) | Out-Null }
  return [pscustomobject]@{Changes=$changes.ToArray();Updates=$updates.ToArray()}
}

function Restore-SonaraLoginItems([object[]]$Changes) {
  foreach ($change in $Changes) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($change.RegistryPath,$true)
    if (-not $key) { throw 'Saved startup registry key is unavailable.' }
    try {
      $key.SetValue($change.Name,$change.Value,$change.Kind)
    } finally { $key.Dispose() }
  }
}

function Update-SonaraLoginItems([string]$OldExecutable, [string]$NewExecutable, [string]$RegistryPath = 'Software\Microsoft\Windows\CurrentVersion\Run') {
  $oldPath = [IO.Path]::GetFullPath($OldExecutable)
  $newPath = [IO.Path]::GetFullPath($NewExecutable)
  $changes = [Collections.Generic.List[object]]::new()
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($RegistryPath,$true)
  if (-not $key) { return @() }
  try {
    foreach ($name in $key.GetValueNames()) {
      $value = $key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($value -isnot [string]) { continue }
      $command = [regex]::Match($value,'^\s*(?:"(?<exe>[^"]+)"|(?<exe>\S+))(?<args>.*)$')
      if (-not $command.Success -or -not $command.Groups['exe'].Value.Equals($oldPath,[StringComparison]::OrdinalIgnoreCase)) { continue }
      $kind = $key.GetValueKind($name)
      # Windows StartupApproved stores enabled/disabled state by value name.
      # Keep that identity and change only the executable in the existing Run
      # command, preserving its arguments and the user's startup decision.
      $changes.Add([pscustomobject]@{RegistryPath=$RegistryPath;Name=$name;Value=$value;Kind=$kind})
      $next = '"' + $newPath + '"' + $command.Groups['args'].Value
      $key.SetValue($name,$next,$kind)
      if ($key.GetValue($name) -ne $next) { throw 'Startup command verification failed.' }
    }
  } catch {
    $key.Dispose();$key=$null
    Restore-SonaraLoginItems -Changes $changes.ToArray()
    throw
  } finally { if ($key) { $key.Dispose() } }
  return $changes.ToArray()
}
