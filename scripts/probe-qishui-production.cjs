'use strict';
// Read-only verification through the unchanged production adapter. A temporary
// profile receives only Sonara's own encrypted account record and OS key state.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
async function run(){
  const {app,session,safeStorage}=require('electron');
  const profile=process.env.SONARA_QISHUI_PROBE_PROFILE;
  if(!profile)throw new Error('Missing isolated probe profile');
  const original=path.join(app.getPath('appData'),'Agent Pulse');
  for(const relative of ['Local State','music/music-qishui-auth.json']){const target=path.join(profile,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(original,relative),target);}
  app.setPath('userData',profile);app.disableHardwareAcceleration();await app.whenReady();
  const network=session.fromPartition('sonara-qishui-production-probe',{cache:false});
  const adapter=require('../src/music/providers/qishui.cjs').createQishuiAdapter({electron:{safeStorage},network,dataDir:path.join(profile,'music')});
  let stream,decoder;
  try{
    try{
      const envelope=JSON.parse(fs.readFileSync(path.join(profile,'music/music-qishui-auth.json'),'utf8'));
      const owned=JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64')));
      console.log(JSON.stringify({ownedRecordDecoded:true,cookiePresent:typeof owned.cookie==='string'&&owned.cookie.length>0}));
    }catch(error){console.log(JSON.stringify({ownedRecordDecoded:false,safeStorageAvailable:safeStorage.isEncryptionAvailable(),decodeErrorName:error.name,decodeErrorCode:error.code||null}));throw Object.assign(new Error('Isolated copy of this account could not be decrypted'),{code:'OWNED_RECORD_DECRYPT_FAILED'});}
    console.log(JSON.stringify({ownedSessionPresent:await adapter.hasSession()}));
    const account=await adapter.request({action:'profile'});
    const result=await adapter.request({action:'play',id:'qishui:7452341092278568977',quality:'auto',song:{title:'Back on Tour',artist:'Connor Price',duration:172}});
    console.log(JSON.stringify({productionAdapter:true,verified:account.apiConnected===true,hasURL:!!result.url,quality:result.quality,duration:result.duration,trial:result.trial===true,encrypted:result.encrypted===true}));
    const fetchImpl=async(value,init={})=>{
      const allowed=require('../src/music/media-policy.cjs').audioURL;let url=allowed(value);
      for(let redirect=0;redirect<=3&&url;redirect++){
        const response=await network.fetch(url.href,{...init,redirect:'manual',credentials:'omit',cache:'no-store'});
        if(![301,302,303,307,308].includes(response.status))return response;
        await response.body?.cancel();url=allowed(new URL(response.headers.get('location')||'',url).href);
      }
      throw new Error('Untrusted audio redirect');
    };
    if(result.encrypted){decoder=require('../src/music/qishui-stream.cjs').createQishuiStream({url:result.url,authorization:result.authorization,fetchImpl});await decoder.ready();}
    stream=require('../src/music-stream.cjs').createMusicStream({fetchImpl});
    const audioURL=stream.prepare(result.url,{decoder});
    const response=await stream.handle(new Request(audioURL,{headers:{Range:'bytes=0-4095'}}));
    const range=/^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
    if(response.status!==206||!range||Number(range[1])>4095){await response.body?.cancel();throw new Error('Audio CDN did not honor bounded Range');}
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try{while(bytes<4096){const next=await reader.read();if(next.done)break;const part=Buffer.from(next.value).subarray(0,4096-bytes);chunks.push(part);bytes+=part.length;}}finally{await reader.cancel().catch(()=>{});}
    const prefix=Buffer.concat(chunks),signature=prefix.toString('ascii',4,8)==='ftyp'?'mp4':prefix.length>1&&prefix[0]===255&&(prefix[1]&246)===240?'aac-adts':'unknown';
    console.log(JSON.stringify({boundedStream:true,status:response.status,rangeHonored:true,bytes,requestedBytes:4096,totalBytes:Number(range[2]),mediaSignature:signature,noStore:/no-store/.test(response.headers.get('cache-control')||''),wholeSongDownloaded:Number(range[2])<=bytes}));
    if(signature==='unknown'||Number(range[2])<=bytes)throw new Error('Bounded media signature verification failed');
  }finally{stream?.dispose();if(!stream)decoder?.dispose();await adapter.dispose();await network.closeAllConnections();app.quit();}
}
if(process.versions.electron)run().catch(error=>{console.error(JSON.stringify({probeError:String(error.code||error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,180)}));require('electron').app.exit(1);});
else{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'sonara-qishui-production-'));
  const env={...process.env,SONARA_QISHUI_PROBE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require('electron'),[__filename],{cwd:root,env,windowsHide:true,stdio:'inherit'});
  const timer=setTimeout(()=>child.kill(),90000);
  child.on('exit',code=>{clearTimeout(timer);const resolved=path.resolve(profile);if(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('sonara-qishui-production-'))fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3});process.exitCode=code??1;});
}
