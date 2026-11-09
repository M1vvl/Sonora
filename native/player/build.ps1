$ErrorActionPreference='Stop'
$playerProjectRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
& node (Join-Path $playerProjectRoot 'scripts\build-player-output.cjs')
if($LASTEXITCODE -ne 0){throw 'GPU output shader generation failed'}
$playerOutput=Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $playerOutput -Force | Out-Null
$playerCompiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $playerCompiler /nologo /optimize+ /platform:x64 /target:exe "/out:$playerOutput\AgentPulse.Player.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'PlayerHost.cs')
if($LASTEXITCODE -ne 0){throw 'Native player compilation failed'}
