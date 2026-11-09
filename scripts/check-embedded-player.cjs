'use strict';
// Hidden, muted real-media/Anime4K integration check. No user data is changed.
const electron=require('electron'),{app,BrowserWindow}=electron;
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const workspace=path.join(__dirname,'..'),root=process.env.PULSE_PLAYER_ROOT||workspace,out=process.env.PULSE_PLAYER_OUTPUT||path.join(workspace,'artifacts/v'+require('../package.json').version+'-player');
const resources=process.env.PULSE_PLAYER_NATIVE||path.join(workspace,'native/player/resources'),executablePath=process.env.PULSE_PLAYER_EXE||path.join(workspace,'native/player/bin/AgentPulse.Player.exe');
app.setPath('userData',path.join(os.tmpdir(),'agent-pulse-embedded-check'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const owner=new BrowserWindow({show:false,width:1280,height:850,frame:false,webPreferences:{sandbox:true}});
  await owner.loadURL('data:text/html;charset=utf-8,<h1>原番剧详情</h1><p>来源与选集保持不变</p>');
  const plan=JSON.parse(fs.readFileSync(path.join(workspace,'artifacts/kazumi-rea/live-network.json'),'utf8')).play;
  const {checkEmbeddedPlayer}=require(path.join(root,'src/diagnostics/player.cjs'));
  const result=await checkEmbeddedPlayer({electron,root,out,owner,plan,dataDir:path.join(out,'preferences'),nativeOptions:{executablePath,libraryPath:path.join(resources,'libmpv-2.dll'),shaderDirectory:path.join(resources,'shaders')}});
  owner.destroy();console.log(JSON.stringify({checks:result.checks,error:result.error}));app.exit(result.error||Object.values(result.checks).some(value=>value!==true)?1:0);
}).catch(error=>{console.error(error);app.exit(1);});
