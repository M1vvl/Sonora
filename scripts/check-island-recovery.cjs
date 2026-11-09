'use strict';
// Force a transparent renderer exit in an isolated profile, never the user's
// visible application. This is a focused lifecycle check, with no mouse input.
const fs=require('node:fs'),path=require('node:path');
const workspace=path.resolve(__dirname,'..'),arg=name=>{const at=process.argv.indexOf('--'+name);return at<0?null:process.argv[at+1];};
const root=path.resolve(arg('root')||workspace),out=path.resolve(arg('output')||path.join(workspace,'artifacts/hotfix-island-recovery'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runner(){
 fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'profile-'));fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({islandEnabled:true,alwaysOnTop:true,musicReactive:false,musicCover:false,islandEdge:'off',interfaceTheme:'electric-purple'}));
 const env={...process.env,PULSE_RECOVERY_PROFILE:profile,CODEX_HOME:path.join(profile,'codex'),CLAUDE_CONFIG_DIR:path.join(profile,'claude')};delete env.ELECTRON_RUN_AS_NODE;
 await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--recovery-child','--smoke-test','--root',root,'--output',out,'--island-only'],{env,cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stdout.on('data',()=>{});child.stderr.on('data',x=>{if(errors.length<5000)errors+=x;});const timer=setTimeout(()=>{child.kill();reject(new Error('Island recovery timed out'));},35000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code?reject(new Error(errors)):resolve();});});
 const report=JSON.parse(fs.readFileSync(path.join(out,'recovery-report.json'),'utf8'));console.log(JSON.stringify(report));if(report.error||Object.values(report.checks).some(x=>x!==true))process.exitCode=1;
}
async function child(){
 const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PULSE_RECOVERY_PROFILE);for(const name of ['show','showInactive','focus'])BrowserWindow.prototype[name]=function(){};
 const report={root,checks:{},syntheticProfile:true};const save=()=>fs.writeFileSync(path.join(out,'recovery-report.json'),JSON.stringify(report,null,2));
 const check=(name,value)=>{report.checks[name]=!!value;if(!value)throw new Error('Island check failed: '+name);};
 require(path.join(root,'src/main.cjs'));
 try{
  await app.whenReady();let win;for(let n=0;n<180;n++){win=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().endsWith('/ui/island.html')&&!w.webContents.isLoading());if(win)break;await sleep(50);}if(!win)throw new Error('No island window');
  const mounted=()=>win.webContents.executeJavaScript("Boolean(document.getElementById('island-toggle') && document.getElementById('island').getBoundingClientRect().height>0)");
  check('initialIslandMounted',await mounted());const before=win.webContents.getOSProcessId();
  const reloaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No renderer reload after exit')),12000);win.webContents.once('did-finish-load',()=>{clearTimeout(timer);resolve();});});
  win.webContents.forcefullyCrashRenderer();await reloaded;await sleep(100);
  check('lostRendererReloads',win.webContents.getOSProcessId()>0&&win.webContents.getOSProcessId()!==before);check('islandContentRestored',await mounted());check('sameNativeWindow',BrowserWindow.getAllWindows().filter(w=>w===win).length===1);check('noVisibleTestWindow',BrowserWindow.getAllWindows().every(w=>!w.isVisible()));
  save();app.quit();
 }catch(error){report.error=error.stack;save();console.error(error.stack);app.exit(1);}
}
if(process.argv.includes('--recovery-child'))child();else runner().catch(error=>{console.error(error.stack);process.exitCode=1;});
