'use strict';
// Isolated synthetic account only; real Windows safeStorage across four fresh
// Electron processes. No installed profile, credentials or network are read.
const fs=require('node:fs'),path=require('node:path');
const workspace=path.resolve(__dirname,'..'),arg=name=>{const at=process.argv.indexOf('--'+name);return at<0?null:process.argv[at+1];};
const root=path.resolve(arg('root')||workspace),out=path.resolve(arg('output')||path.join(workspace,'artifacts/v021-auth-restart')),phase=arg('phase');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
async function runner(){
  fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'profile-')),pids=[];
  for(const name of ['write','offline','rotate','read']){const env={...process.env,PULSE_AUTH_RESTART_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
    const pid=await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--phase',name,'--root',root,'--output',out],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stdout.on('data',()=>{});child.stderr.on('data',bytes=>{if(errors.length<4000)errors+=bytes;});const timer=setTimeout(()=>{child.kill();reject(new Error('Auth restart check timed out'));},30000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code?reject(new Error('Auth restart '+name+' failed: '+errors)):resolve(child.pid);});});pids.push(pid);
  }
  const stages=Object.fromEntries(['write','offline','rotate','read'].map(name=>[name,read(path.join(out,name+'.json'))])),checks={fourDistinctProcesses:new Set(pids).size===4};
  for(const[name,value]of Object.entries(stages))for(const[key,passed]of Object.entries(value.checks))checks[name+'_'+key]=passed;
  const report={syntheticOnly:true,osEncryption:true,root,checks,stages};fs.writeFileSync(path.join(out,'auth-restart-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks,output:out}));if(Object.values(checks).some(value=>value!==true))process.exitCode=1;
}
async function child(){
  const {app,safeStorage}=require('electron'),profile=process.env.PULSE_AUTH_RESTART_PROFILE;
  if(!profile||!profile.startsWith(out+path.sep))throw new Error('Isolated profile required');app.setPath('userData',profile);
  let service;const report={phase,checks:{},networkRequests:0},check=(key,value)=>{report.checks[key]=!!value;if(!value)throw new Error('Auth restart check failed: '+key);};
  try{await app.whenReady();check('safeStorageAvailable',safeStorage.isEncryptionAvailable());
    const {createMusicService}=require(path.join(root,'src/music/index.cjs')),dataDir=path.join(profile,'music'),file=path.join(dataDir,'music-auth.json'),user={userId:707070,nickname:'Synthetic Restart User',vipType:0},token='synthetic-initial-session',rotated='synthetic-rotated-session';
    const {createQishuiStore}=require(path.join(root,'src/music/providers/qishui-store.cjs'));
    const soda=createQishuiStore({dataDir,safeStorage}),sodaFile=path.join(dataDir,'music-qishui-auth.json');
    if(phase==='write')check('qishuiEncryptedSave',soda.save({deviceId:'1234567812345678',installId:'123456712345678',cookie:'sessionid=synthetic-owned-qishui'}));
    else check('qishuiOwnSessionRestored',soda.read().cookie==='sessionid=synthetic-owned-qishui');
    check('qishuiNoPlaintext',fs.existsSync(sodaFile)&&!fs.readFileSync(sodaFile,'utf8').includes('synthetic-owned-qishui'));
    const response=(body,cookie)=>new Response(JSON.stringify(body),{headers:cookie?{'set-cookie':'MUSIC_U='+cookie+'; Domain=.music.163.com'}:{}});
    service=createMusicService({dataDir,isEncryptionAvailable:()=>safeStorage.isEncryptionAvailable(),encryptString:value=>safeStorage.encryptString(value),decryptString:value=>safeStorage.decryptString(value),toDataURL:async()=> 'data:image/png;base64,c3ludGhldGlj',fetchImpl:async(url,init)=>{report.networkRequests++;
      if(phase==='offline')throw new Error('Synthetic outage');
      if(url.endsWith('/unikey'))return response({code:200,unikey:'synthetic-restart-key'});
      if(url.endsWith('/client/login'))return response({code:803},token);
      if(url.endsWith('/account/get')){if(phase==='read')check('readsRotatedToken',init.headers.cookie.includes('MUSIC_U='+rotated));return response({code:200,profile:user},phase==='rotate'?rotated:null);}
      throw new Error('Unexpected synthetic request');}});
    if(phase==='write'){const qr=await service.beginQR(),result=await service.checkQR(qr);check('confirmedEncryptedLogin',result.status==='confirmed'&&result.persistence===true);}
    else {const value=await service.bootstrap();check('restoresAccountWithoutQR',value.state==='signedIn'&&value.profile.nickname===user.nickname&&report.networkRequests===1);check('verificationState',value.verification===(phase==='offline'?'pending':'verified'));if(phase==='offline'){await service.bootstrap();check('noRetryStorm',report.networkRequests===1);}}
    await service.dispose();check('sessionSurvivesServiceDispose',fs.existsSync(file));const text=fs.readFileSync(file,'utf8'),envelope=JSON.parse(text);
    check('ciphertextOnlyOnDisk',envelope.version===1&&typeof envelope.encrypted==='string'&&!text.includes(token)&&!text.includes(rotated)&&!text.includes(user.nickname));
    const decrypted=safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64')),session=JSON.parse(decrypted);check('decryptsExpectedSession',session.cookie.MUSIC_U===(['rotate','read'].includes(phase)?rotated:token));
  }catch(error){report.error=String(error.message).slice(0,250);process.exitCode=1;}
  finally{await service?.dispose();fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify(report,null,2));app.exit(process.exitCode||0);}
}
if(phase)child();else runner().catch(error=>{console.error(error.message);process.exitCode=1;});
