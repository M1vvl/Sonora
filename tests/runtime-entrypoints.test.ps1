$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\runtime-entrypoints.ps1')
$fixture = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\artifacts'))) ('entrypoint-fixture-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$old = Join-Path $fixture 'Agent Pulse.exe'
$new = Join-Path $fixture 'Sonara.exe'
[IO.File]::WriteAllBytes($old,[byte[]]@(0))
[IO.File]::WriteAllBytes($new,[byte[]]@(0))
$shellObject = New-Object -ComObject WScript.Shell
$registryPath = 'Software\SonaraEntryTest-' + [guid]::NewGuid().ToString('N')
$checks = 0
function Assert-Entry([bool]$Passed,[string]$Message) { if (-not $Passed) { throw $Message }; $script:checks++ }
function New-TestLink([string]$File,[string]$Target) {
  $link = $shellObject.CreateShortcut($File)
  try { $link.TargetPath=$Target;$link.Arguments='--island-only';$link.WorkingDirectory=$fixture;$link.Save() }
  finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null }
}
function Get-TestTarget([string]$File) {
  $link = $shellObject.CreateShortcut($File)
  try { return $link.TargetPath } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null }
}
try {
  $oldLink = Join-Path $fixture 'Agent Pulse.lnk'
  $newLink = Join-Path $fixture 'Sonara.lnk'
  $custom = Join-Path $fixture 'Custom.lnk'
  $other = Join-Path $fixture 'Other.lnk'
  New-TestLink $oldLink $old;New-TestLink $custom $old;New-TestLink $other "$env:WINDIR\notepad.exe"
  $otherHash = (Get-FileHash -LiteralPath $other).Hash
  $collision = Join-Path $fixture 'collision';New-Item -ItemType Directory -Path $collision | Out-Null
  $collisionOld = Join-Path $collision 'Agent Pulse.lnk'
  $collisionNew = Join-Path $collision 'Sonara.lnk'
  New-TestLink $collisionOld $old;New-TestLink $collisionNew "$env:WINDIR\notepad.exe"
  $collisionHash = (Get-FileHash -LiteralPath $collisionNew).Hash
  $migration = Update-SonaraShortcuts -OldExecutable $old -NewExecutable $new -BackupDirectory (Join-Path $fixture 'backup') -Candidates @($oldLink,$custom,$other,$collisionOld)
  Assert-Entry ((Test-Path -LiteralPath $newLink) -and -not (Test-Path -LiteralPath $oldLink)) 'Owned desktop shortcut was not renamed.'
  Assert-Entry ((Get-TestTarget $newLink) -eq $new) 'Renamed shortcut target mismatch.'
  Assert-Entry ((Get-TestTarget $custom) -eq $new) 'Custom owned shortcut was not updated.'
  Assert-Entry ((Get-TestTarget $collisionOld) -eq $new) 'Name collision must update the old label in place.'
  Assert-Entry ((Get-FileHash -LiteralPath $collisionNew).Hash -eq $collisionHash) 'Unrelated Sonara.lnk was overwritten.'
  Assert-Entry ((Get-FileHash -LiteralPath $other).Hash -eq $otherHash) 'Unrelated shortcut changed.'
  Restore-SonaraShortcuts -Changes $migration.Changes
  Assert-Entry ((Test-Path -LiteralPath $oldLink) -and -not (Test-Path -LiteralPath $newLink)) 'Shortcut rollback failed.'
  Assert-Entry ((Get-TestTarget $custom) -eq $old) 'Custom shortcut rollback failed.'
  Assert-Entry ((Get-TestTarget $collisionOld) -eq $old) 'Collision shortcut rollback failed.'

  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registryPath)
  try { $key.SetValue('Agent Pulse','"' + $old + '" --island-only');$key.SetValue('Unrelated','"C:\unrelated.exe" --keep') } finally { $key.Dispose() }
  $changes = @(Update-SonaraLoginItems -OldExecutable $old -NewExecutable $new -RegistryPath $registryPath)
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registryPath)
  try {
    Assert-Entry ($key.GetValue('Agent Pulse') -eq ('"' + $new + '" --island-only')) 'Startup executable or arguments not migrated under the original identity.'
    Assert-Entry ($null -eq $key.GetValue('Sonara')) 'Startup value name must remain stable for StartupApproved.'
    Assert-Entry ($key.GetValue('Unrelated') -eq '"C:\unrelated.exe" --keep') 'Unrelated startup entry changed.'
  } finally { $key.Dispose() }
  Restore-SonaraLoginItems -Changes $changes
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registryPath,$true)
  try { Assert-Entry ($key.GetValue('Agent Pulse') -eq ('"' + $old + '" --island-only')) 'Startup rollback failed.';$key.SetValue('Sonara','"C:\unrelated.exe"') } finally { $key.Dispose() }
  $changes = @(Update-SonaraLoginItems -OldExecutable $old -NewExecutable $new -RegistryPath $registryPath)
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registryPath)
  try {
    Assert-Entry ($key.GetValue('Sonara') -eq '"C:\unrelated.exe"') 'Existing Sonara startup entry was overwritten.'
    Assert-Entry ($key.GetValue('Agent Pulse') -eq ('"' + $new + '" --island-only')) 'Conflicting startup name should retain the owned old label.'
  } finally { $key.Dispose() }
  Restore-SonaraLoginItems -Changes $changes
  $emptyPath = $registryPath + '-missing'
  $emptyChanges = @(Update-SonaraLoginItems -OldExecutable $old -NewExecutable $new -RegistryPath $emptyPath)
  Assert-Entry ($emptyChanges.Count -eq 0 -and $null -eq [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($emptyPath)) 'A disabled startup must not be created.'
  [ordered]@{checks=$checks;passed=$true;fixture=$fixture;formalShortcutsChanged=$false;formalStartupChanged=$false}|ConvertTo-Json -Compress
} finally {
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shellObject) | Out-Null
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($registryPath,$false)
}
