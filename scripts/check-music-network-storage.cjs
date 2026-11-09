'use strict';
// Actual Electron session verification, using only a loopback synthetic audio
// response and an isolated profile. No account, official song or window.
const fs=require('node:fs'),path=require('node:path');
const workspace=path.resolve(__dirname,'..'),arg=name=>{const at=process.argv.indexOf('--'+name);return at>=0?process.argv[at+1]:null;};
const root=path.resolve(arg('root')||workspace),output=path.resolve(arg('output')||path.join(workspace,'artifacts/v0.3.18-network-storage'));
async function runner(){
 fs.mkdirSync(output,{recursive:true});const {spawn}=require('node:child_process'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[__filename,'--network-storage-child','--root',root,'--output',output],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',data=>{if(errors.length<2000)errors+=data;});const timer=setTimeout(()=>{child.kill();reject(new Error('Network storage check timed out'));},25000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error(errors||'Network storage check failed'));else resolve();});});
 const report=JSON.parse(fs.readFileSync(path.join(output,'network-storage-report.json'),'utf8'));console.log(JSON.stringify(report));
}
async function child(){
 const {app,session,BrowserWindow}=require('electron'),http=require('node:http');fs.mkdirSync(output,{recursive:true});const profile=fs.mkdtempSync(path.join(output,'profile-'));app.setPath('userData',profile);
 const report={checkedAt:new Date().toISOString(),root,syntheticOnly:true,checks:{}},check=(key,value)=>{report.checks[key]=!!value;if(!value)throw new Error('Storage check failed: '+key);};let server,bridge;
 try{
  await app.whenReady();let count=0;server=http.createServer((_request,response)=>{count++;response.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'public, max-age=86400','Content-Length':'4'});response.end(Buffer.from('RIFF'));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const handlers=new Map();let options;bridge=require(path.join(root,'src/music-bridge.cjs')).installMusicBridge({electron:{session,ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},protocol:{handle(){},unhandle(){}},safeStorage:{}},dataDir:path.join(profile,'music'),isDashboard:()=>true,factories:{createService(value){options=value;return {async request(){return{};},getState(){return{};},async dispose(){}};}}});
  await handlers.get('pulse:music')({},'bootstrap');const url='http://127.0.0.1:'+server.address().port+'/synthetic.wav';
  for(let n=0;n<2;n++){const response=await options.fetchImpl(url,{method:'GET'});check('syntheticResponse'+n,response.status===200&&(await response.arrayBuffer()).byteLength===4);}
  const network=session.fromPartition('pulse-music-auth');check('memoryOnlySession',network.getStoragePath()===null);check('everyReadHitsNetwork',count===2);check('httpCacheRemainsEmpty',await network.getCacheSize()===0);check('noPersistentPartitionCreated',!fs.existsSync(path.join(profile,'Partitions')));check('noVisibleWindow',BrowserWindow.getAllWindows().length===0);
 }catch(error){report.error=String(error.message);process.exitCode=1;}
 finally{await bridge?.dispose();await new Promise(resolve=>server?server.close(resolve):resolve());fs.writeFileSync(path.join(output,'network-storage-report.json'),JSON.stringify(report,null,2)+'\n');app.exit(process.exitCode||0);}
}
if(process.argv.includes('--network-storage-child'))child();else runner().catch(error=>{console.error(error.message);process.exitCode=1;});
