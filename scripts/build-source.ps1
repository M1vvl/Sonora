$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archive = Join-Path $projectRoot 'artifacts\corresponding-source.zip'
New-Item -ItemType Directory -Path (Split-Path -Parent $archive) -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
$zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
try {
  $files = @('package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md','README.md','AGENTS.md','.gitattributes','启动 Sonara.vbs')
  foreach ($folder in @('src','ui','config','assets','scripts','tests','docs','.github')) {
    $files += Get-ChildItem -LiteralPath (Join-Path $projectRoot $folder) -Recurse -File | ForEach-Object { $_.FullName.Substring($projectRoot.Length + 1) }
  }
  $files += Get-ChildItem -LiteralPath (Join-Path $projectRoot 'native') -Recurse -File | Where-Object { $_.FullName -notmatch '\\(obj|bin)\\' -and ($_.Extension -in @('.cs','.csproj','.ps1','.hlsl','.cso','.sha256','.glsl','.json','.manifest') -or $_.Name -in @('LICENSE','THIRD_PARTY_NOTICES.md','NOTICE.md')) } | ForEach-Object { $_.FullName.Substring($projectRoot.Length + 1) }
  foreach ($relative in $files | Sort-Object -Unique) {
    $sourceRelative = $relative.Replace('\','/')
    if ($sourceRelative -match '^assets/music/(source-presets/assets/skull-decimation-points\.bin|presets/(planet|record|ripple|stars|tranquil|tunnel|void)\.png)$') { continue }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $projectRoot $relative), $relative.Replace('\','/'), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }
Write-Output "Corresponding application source: $archive"


