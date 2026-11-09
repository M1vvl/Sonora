$ErrorActionPreference='Stop'
$mediaOutput=Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $mediaOutput -Force | Out-Null
$mediaFramework=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$mediaMetadata=Join-Path $env:WINDIR 'System32\WinMetadata'
$mediaFacades=Join-Path $env:WINDIR 'Microsoft.NET\assembly\GAC_MSIL'
$mediaWpf=Join-Path $mediaFramework 'WPF'
& (Join-Path $mediaFramework 'csc.exe') /nologo /optimize+ /platform:x64 /target:exe "/out:$mediaOutput\AgentPulse.MediaProbe.exe" /r:System.Drawing.dll "/r:$mediaWpf\WindowsBase.dll" "/r:$mediaWpf\UIAutomationClient.dll" "/r:$mediaWpf\UIAutomationTypes.dll" "/r:$mediaMetadata\Windows.Media.winmd" "/r:$mediaMetadata\Windows.Foundation.winmd" "/r:$mediaMetadata\Windows.Storage.winmd" "/r:$mediaFramework\System.Runtime.WindowsRuntime.dll" "/r:$mediaFramework\System.Runtime.InteropServices.WindowsRuntime.dll" "/r:$mediaFacades\System.Runtime\v4.0_4.0.0.0__b03f5f7f11d50a3a\System.Runtime.dll" "/r:$mediaFacades\System.Threading.Tasks\v4.0_4.0.0.0__b03f5f7f11d50a3a\System.Threading.Tasks.dll" (Join-Path $PSScriptRoot 'MediaProbe.cs') (Join-Path $PSScriptRoot 'CloudMusicTimeline.cs') (Join-Path $PSScriptRoot 'PlayerSources.cs')
if($LASTEXITCODE -ne 0){throw 'Media helper compilation failed'}
