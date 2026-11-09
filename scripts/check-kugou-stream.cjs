'use strict';

// Uses a copy of Sonara's own encrypted login snapshot. Audio bytes are bounded
// and discarded. No credential, signed URL, audio file or account name is saved.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const workspace=path.resolve(__dirname,'..');
const BYTE_LIMIT=64*1024;

async function child(){
  const electron=require('electron');
  const {app,session,BrowserWindow,protocol}=electron;
  app.setPath('userData',process.env.SONARA_STREAM_PROFILE);
  protocol.registerSchemesAsPrivileged([{scheme:'pulse-music-audio',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
  app.on('window-all-closed',()=>{});
  await app.whenReady();
  const platform=require('../src/music/platform-login.cjs').createPlatformLogin({electron,dataDir:path.join(app.getPath('userData'),'music')});
  const network=session.fromPartition('sonara-kugou-stream-check',{cache:false});
  let win,stream,registered=false;
  const results=[];
  function failure(error){return String(error?.message||'failed').replace(/https?:\/\/\S+/g,'[URL]').replace(/(?:cookie|token|authst|vkey)\s*[:=]\s*\S+/gi,'[credential]').slice(0,180);}
  try{
    const profile=await platform.request({provider:'kugou',action:'profile'});
    const search=await platform.request({provider:'kugou',action:'search',query:'Set for Life Trent Dabbs',limit:10});
    const song=search.songs?.find(value=>/^set for life$/i.test(value.title)&&/trent dabbs/i.test(value.artist));
    if(!song)throw new Error('Matching Kugou song was not returned');
    for(const quality of ['standard','lossless']){
      const result={requested:quality,verified:profile.apiConnected===true};
      try{
        const playback=await platform.request({provider:'kugou',action:'play',id:song.id,song,quality});
        result.returned=playback.quality;
        result.host=new URL(playback.url).hostname;
        result.scheme=new URL(playback.url).protocol;
        result.port=new URL(playback.url).port;
        const addressURL=require('../src/music/media-policy.cjs').audioURL(playback.url);
        result.allowed=!!addressURL;
        if(!addressURL)throw new Error('Official audio address was rejected');
        result.transportScheme=addressURL.protocol;
        const controller=new AbortController();
        const response=await network.fetch(addressURL.href,{headers:{Range:'bytes=0-'+(BYTE_LIMIT-1)},signal:controller.signal,cache:'no-store',credentials:'omit'});
        result.status=response.status;
        result.type=response.headers.get('content-type');
        const reader=response.body.getReader(),parts=[];let bytes=0;
        try{while(bytes<BYTE_LIMIT){const {done,value}=await reader.read();if(done)break;const piece=Buffer.from(value).subarray(0,BYTE_LIMIT-bytes);parts.push(piece);bytes+=piece.length;}}finally{await reader.cancel().catch(()=>{});controller.abort();}
        const prefix=Buffer.concat(parts,bytes);
        result.bytes=bytes;
        result.format=prefix.subarray(0,4).toString('ascii')==='fLaC'?'flac':prefix.subarray(0,3).toString('ascii')==='ID3'||prefix[0]===255?'mp3':'unknown';
        if(result.format==='mp3'){
          for(let offset=0;offset<prefix.length-4;offset++){
            const a=prefix[offset],b=prefix[offset+1],c=prefix[offset+2],version=(b>>3)&3,rate=c>>4;
            if(a!==255||(b&224)!==224||version===1||((b>>1)&3)!==1||rate===0||rate===15||((c>>2)&3)===3)continue;
            result.mp3Kbps=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[rate];
            break;
          }
        }
        stream=require('../src/music-stream.cjs').createMusicStream({fetchImpl:(url,init)=>network.fetch(url,init)});
        const address=stream.prepare(playback.url);
        protocol.handle('pulse-music-audio',request=>stream.handle(request));
        registered=true;
        win=new BrowserWindow({show:false,width:320,height:200,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
        await win.loadURL('data:text/html,<audio preload="metadata"></audio>');
        result.metadata=await win.webContents.executeJavaScript(`new Promise(resolve=>{const audio=document.querySelector('audio');const timer=setTimeout(()=>finish({ok:false,reason:'timeout'}),12000);function finish(value){clearTimeout(timer);audio.pause();audio.removeAttribute('src');audio.load();resolve(value);}audio.addEventListener('loadedmetadata',()=>finish({ok:true,duration:audio.duration}),{once:true});audio.addEventListener('error',()=>finish({ok:false,reason:'media-error-'+audio.error?.code}),{once:true});audio.src=${JSON.stringify(address)};audio.load();})`);
        win.destroy();win=null;protocol.unhandle('pulse-music-audio');registered=false;stream.dispose();stream=null;
      }catch(error){result.error=failure(error);win?.destroy();win=null;if(registered){protocol.unhandle('pulse-music-audio');registered=false;}stream?.dispose();stream=null;}
      results.push(result);
    }
    console.log(JSON.stringify({provider:'kugou',results}));
    if(results.some(value=>!value.metadata?.ok))process.exitCode=1;
  }catch(error){console.error(failure(error));process.exitCode=1;}
  finally{win?.destroy();stream?.dispose();await platform.dispose();await network.closeAllConnections();app.exit(process.exitCode||0);}
}

if(process.versions.electron)child().catch(error=>{console.error(String(error.message).slice(0,160));require('electron').app.exit(1);});
else{
  const supplied=path.resolve(process.env.SONARA_PROBE_PROFILE||'');
  if(!supplied.startsWith(path.join(os.tmpdir(),'sonara-provider-probe-')))throw new Error('A Sonara isolated login snapshot is required');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'sonara-provider-stream-'));
  for(const relative of ['Local State','Partitions/agent-pulse-kugou-official/Network/Cookies']){
    const from=path.join(supplied,relative),to=path.join(profile,relative);
    if(fs.existsSync(from)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
  }
  const env={...process.env,SONARA_STREAM_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  const processChild=require('node:child_process').spawn(require('electron'),[__filename],{cwd:workspace,env,windowsHide:true,stdio:'inherit'});
  const timer=setTimeout(()=>processChild.kill(),120000);
  processChild.once('exit',code=>{clearTimeout(timer);process.exitCode=code||0;fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
}
