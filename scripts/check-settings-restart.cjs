'use strict';
// Explicit, isolated lifecycle diagnostic. Two distinct Electron main processes
// load the real application, save over its real IPC, quit normally and relaunch.
// The user's normal APPDATA profile is never written.
const fs=require('node:fs'),path=require('node:path');
const workspace=path.resolve(__dirname,'..');
const root=process.env.PULSE_RESTART_ROOT||workspace;
const out=path.resolve(process.env.PULSE_RESTART_OUTPUT||path.join(workspace,'artifacts/v0.3.10-settings-restart'));
const profile=path.join(out,'profile');
const phase=process.argv.find(value=>value.startsWith('--restart-phase='))?.split('=')[1];
const expected={islandEnabled:false,alwaysOnTop:false,islandMaterial:'css',islandOpacity:.65,musicReactive:false,audioSourceMode:'music',musicCover:false,musicCoverMotion:'still',activityMotion:'still',interfaceTheme:'electric-purple',islandEdge:'light',pollIntervalMs:5000,launchAtLogin:false,islandPosition:{x:120,y:40}};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function runner(){
  const {spawn}=require('node:child_process'),electron=require('electron');
  fs.mkdirSync(profile,{recursive:true});
  // A dedicated owned profile makes the initial state deterministic. It does
  // not copy or mutate the user's actual preferences or windows.
  fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({interfaceTheme:'carbon-lime',islandEnabled:false,musicReactive:false,musicCover:false,islandEdge:'off',launchAtLogin:false},null,2));
  const run=mode=>new Promise((resolve,reject)=>{
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(electron,[__filename,'--restart-phase='+mode],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const stdout=[],stderr=[];let bytes=0;
    child.stdout.on('data',data=>{if(bytes<64000){stdout.push(data);bytes+=data.length;}});child.stderr.on('data',data=>{if(bytes<64000){stderr.push(data);bytes+=data.length;}});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Restart '+mode+' phase timed out'));},45000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);const observation={pid:child.pid,code,signal,stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()};fs.writeFileSync(path.join(out,mode+'-process.json'),JSON.stringify(observation,null,2));if(code!==0)reject(new Error('Restart '+mode+' phase failed: '+observation.stderr));else resolve(observation);});
  });
  const write=await run('write'),read=await run('read');
  const first=JSON.parse(fs.readFileSync(path.join(out,'write-report.json'),'utf8')),second=JSON.parse(fs.readFileSync(path.join(out,'read-report.json'),'utf8'));
  const checks={distinctMainProcesses:write.pid!==read.pid,normalQuit:first.normalQuit===true&&second.normalQuit===true,savedThroughProductionIPC:first.checks.savedThroughProductionIPC===true,themeChosenThroughRealUI:first.checks.themeChosenThroughRealUI===true,reloadedAllSavedPreferences:second.checks.savedSettingsRestored===true,reloadedThemeInDOM:second.checks.themeRendered===true,reloadedControls:second.checks.controlsRestored===true,realProfileUntouched:first.userData===profile&&second.userData===profile};
  const result={checkedAt:new Date().toISOString(),root,profile,checks,processIds:[write.pid,read.pid],expected,write:first,read:second};fs.writeFileSync(path.join(out,'restart-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({checks,processIds:result.processIds,root,profile}));if(Object.values(checks).some(value=>value!==true))process.exitCode=1;
}
async function child(){
  const {app,BrowserWindow}=require('electron');
  app.setPath('userData',profile);
  for(const name of ['show','showInactive','focus'])BrowserWindow.prototype[name]=function(){};
  const report={phase,pid:process.pid,userData:app.getPath('userData'),normalQuit:false,checks:{}};
  const reportFile=path.join(out,phase+'-report.json');
  const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  app.once('will-quit',()=>{report.normalQuit=true;save();});
  require(path.join(root,'src/main.cjs'));
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async predicate=>{for(let i=0;i<300;i++){const value=await predicate();if(value)return value;await sleep(75);}throw new Error('Application settings check timed out');};
  try{
    await app.whenReady();
    const window=await until(()=>BrowserWindow.getAllWindows().find(win=>!win.isDestroyed()&&win.webContents.getURL().endsWith('/ui/dashboard.html')&&!win.webContents.isLoading()));
    const web=window.webContents;
    await until(()=>web.executeJavaScript(`!!window.pulse&&document.querySelectorAll('#theme-options input').length===7`));
    if(phase==='write'){
      await web.executeJavaScript(`document.getElementById('nav-settings').click();document.querySelector('#theme-options input[value="electric-purple"]').click()`);
      await until(()=>web.executeJavaScript(`(async()=>{const settings=await window.pulse.getSettings();return settings.interfaceTheme==='electric-purple'&&document.documentElement.dataset.interfaceTheme==='electric-purple';})()`));
      report.checks.themeChosenThroughRealUI=true;
      report.saved=await web.executeJavaScript(`window.pulse.saveSettings(${JSON.stringify(expected)})`);
      report.disk=JSON.parse(fs.readFileSync(path.join(profile,'settings.json'),'utf8'));
      report.checks.savedThroughProductionIPC=same(report.saved,expected)&&same(report.disk,expected);
    }else{
      report.loaded=await web.executeJavaScript(`window.pulse.getSettings()`);
      report.disk=JSON.parse(fs.readFileSync(path.join(profile,'settings.json'),'utf8'));
      report.ui=await web.executeJavaScript(`({theme:document.documentElement.dataset.interfaceTheme,selected:document.querySelector('#theme-options input:checked')?.value,interval:document.getElementById('setting-interval').value,opacity:document.getElementById('setting-opacity').value,coverMotion:document.getElementById('setting-cover-motion').value,activityMotion:document.getElementById('setting-activity-motion').value,audioSource:document.getElementById('setting-audio-source').value,island:document.getElementById('setting-island').checked,topmost:document.getElementById('setting-topmost').checked,material:document.getElementById('setting-material').value,edge:document.getElementById('setting-liquid-edge').value,music:document.getElementById('setting-music').checked,cover:document.getElementById('setting-music-cover').checked,autostart:document.getElementById('setting-autostart').checked})`);
      report.checks.savedSettingsRestored=same(report.loaded,expected)&&same(report.disk,expected);
      report.checks.themeRendered=report.ui.theme==='electric-purple'&&report.ui.selected==='electric-purple';
      report.checks.controlsRestored=report.ui.interval==='5000'&&report.ui.opacity==='65'&&report.ui.coverMotion==='still'&&report.ui.activityMotion==='still'&&report.ui.audioSource==='music'&&report.ui.island===false&&report.ui.topmost===false&&report.ui.material==='css'&&report.ui.edge==='light'&&report.ui.music===false&&report.ui.cover===false&&report.ui.autostart===false;
    }
    save();if(Object.values(report.checks).some(value=>value!==true))app.exitCode=1;app.quit();
  }catch(error){report.error=error.stack;save();console.error(error.stack);app.exitCode=1;app.quit();}
}
if(phase)child();else runner().catch(error=>{console.error(error.stack);process.exitCode=1;});
