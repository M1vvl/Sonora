param([string]$DotnetPath='dotnet',[string]$OutputDirectory=(Join-Path $PSScriptRoot 'bin'))
$ErrorActionPreference='Stop'
& $DotnetPath publish (Join-Path $PSScriptRoot 'LiquidGlass.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -o $OutputDirectory
if($LASTEXITCODE -ne 0){throw 'Liquid Glass build failed'}
