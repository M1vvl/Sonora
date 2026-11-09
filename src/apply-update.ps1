param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference='Stop'
$job=Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
if($job.id -notmatch '^[a-f0-9]{32}$'){throw 'Invalid update ID'}
if((Get-FileHash -LiteralPath $job.download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $job.hash){throw 'Update hash mismatch'}
$process=Get-Process -Id $job.pid -ErrorAction SilentlyContinue
if($process){Wait-Process -Id $job.pid -Timeout 60 -ErrorAction SilentlyContinue}
if(Get-Process -Id $job.pid -ErrorAction SilentlyContinue){throw 'Sonara is still closing'}
$replaced=$false
try {
  Move-Item -LiteralPath $job.target -Destination $job.backup -Force
  $replaced=$true
  Copy-Item -LiteralPath $job.download -Destination $job.target -Force
  if((Get-FileHash -LiteralPath $job.target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $job.hash){throw 'Installed hash mismatch'}
  Start-Process -FilePath $job.target -ArgumentList ('--update-id='+$job.id) -WindowStyle Hidden | Out-Null
  for($attempt=0;$attempt -lt 120;$attempt++){
    if(Test-Path -LiteralPath $job.receipt){break}
    Start-Sleep -Milliseconds 500
  }
  if(!(Test-Path -LiteralPath $job.receipt)){throw 'Updated application did not confirm startup'}
  Remove-Item -LiteralPath $job.backup -Force
  Remove-Item -LiteralPath $job.download -Force
  Remove-Item -LiteralPath $JobFile -Force
} catch {
  $_ | Out-String | Set-Content -LiteralPath ($JobFile+'.error.txt')
  if($replaced -and (Test-Path -LiteralPath $job.backup)){
    Start-Process -FilePath $job.target -ArgumentList '--quit-for-update' -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
    Start-Sleep -Seconds 2
    Move-Item -LiteralPath $job.backup -Destination $job.target -Force
    Start-Process -FilePath $job.target -WindowStyle Hidden | Out-Null
  }
}
