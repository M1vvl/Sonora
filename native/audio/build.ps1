$ErrorActionPreference = 'Stop'
$audioOutput = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $audioOutput -Force | Out-Null
$audioCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $audioCompiler /nologo /optimize+ /platform:x64 /target:exe "/out:$audioOutput\AgentPulse.AudioProbe.exe" (Join-Path $PSScriptRoot 'AudioProbe.cs')
if ($LASTEXITCODE -ne 0) { throw 'Audio helper compilation failed' }
& (Join-Path $audioOutput 'AgentPulse.AudioProbe.exe') --self-test
if ($LASTEXITCODE -ne 0) { throw 'Audio FFT self-test failed' }
