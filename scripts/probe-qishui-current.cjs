'use strict';
// Explicitly requested read-only diagnosis of Sonara's own current session.
// The encrypted record stays encrypted in a fresh isolated Electron profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');

async function run() {
  const {app, session, safeStorage} = require('electron');
  const original = path.join(app.getPath('appData'), 'Agent Pulse');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sonara-qishui-current-'));
  for (const relative of ['Local State', 'music/music-qishui-auth.json']) {
    const target = path.join(profile, relative);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.copyFileSync(path.join(original, relative), target);
  }
  app.setPath('userData', profile);
  app.disableHardwareAcceleration();
  await app.whenReady();
  const {createQishuiStore} = require('../src/music/providers/qishui-store.cjs');
  const owned = createQishuiStore({dataDir:path.join(profile, 'music'),safeStorage}).read();
  const chromium = session.fromPartition('sonara-qishui-diagnostic',{cache:false});
  const http = require('../src/music/providers/http.cjs').createProviderHTTP({domains:['qishui.com','volcengine.com','douyin.com']});
  const core = require('../src/music/providers/qishui-core.cjs').createQishuiCore({requestText:async(url,options,body)=>{
    let value = await http.requestText(url,options,body);
    let json;try{json=JSON.parse(value);}catch{}
    console.log(JSON.stringify({endpoint:new URL(url).pathname,method:options.method||'GET',bytes:Buffer.byteLength(value),status:json?.status_code,keys:json&&typeof json==='object'?Object.keys(json).slice(0,12):[],dataKeys:json?.data&&typeof json.data==='object'?Object.keys(json.data).slice(0,12):[]}));
    if(!value.trim()&&new URL(url).pathname==='/luna/pc/track_v2'){
      try{
        const headers={...options.headers};delete headers['Content-Length'];
        const response=await chromium.fetch(url,{method:options.method||'GET',headers,body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(6000)});
        const candidate=await response.text();
        console.log(JSON.stringify({variant:'chromium-network',method:options.method||'GET',status:response.status,type:response.headers.get('content-type'),bytes:Buffer.byteLength(candidate)}));
        if(candidate.trim())return candidate;
      }catch(error){console.log(JSON.stringify({variant:'chromium-network',error:error.code||String(error.message).slice(0,100)}));}
      const variants=[
        ['stable-device',target=>{target.searchParams.set('device_id',owned.deviceId);target.searchParams.set('iid',owned.installId);target.searchParams.set('fp',owned.deviceId);}],
        ['stored-token',target=>{target.searchParams.set('msToken',owned.msToken||'');target.searchParams.set('device_id',owned.deviceId);target.searchParams.set('iid',owned.installId);}],
        ['api5-host',target=>{target.hostname='api5-lq.qishui.com';}],
      ];
      for(const[name,patch]of variants){
        const target=new URL(url);patch(target);
        try{const candidate=await http.requestText(target.href,options,body);console.log(JSON.stringify({variant:name,method:options.method||'GET',bytes:Buffer.byteLength(candidate)}));if(candidate.trim()){value=candidate;break;}}catch(error){console.log(JSON.stringify({variant:name,error:error.code||'request-failed'}));}
      }
      if(!value.trim()&&options.method!=='POST'){
        const target='https://beta-luna.douyin.com/luna/h5/seo_track?track_id='+new URL(url).searchParams.get('track_id')+'&device_platform=web';
        try{
          const candidate=await http.requestText(target,{timeoutMs:6000,headers:{'User-Agent':options.headers['User-Agent'],Accept:'application/json',Referer:'https://www.douyin.com/'}});
          const parsed=JSON.parse(candidate),track=parsed.track||parsed.data?.track||parsed.seo_track||{};
          console.log(JSON.stringify({variant:'official-seo',bytes:Buffer.byteLength(candidate),keys:Object.keys(parsed),trackKeys:Object.keys(track),duration:track.duration,bitrateShapes:(track.bit_rates||[]).map(item=>({keys:Object.keys(item),duration:item.duration,quality:item.quality}))}));
          if(candidate.trim())value=JSON.stringify({...parsed,track});
        }catch(error){console.log(JSON.stringify({variant:'official-seo',error:error.code||'request-failed'}));}
      }
    }
    return value;
  }});
  try {
    console.log(JSON.stringify({currentRecord:true,hasCookie:!!owned.cookie,hasDeviceId:!!owned.deviceId}));
    const account = await core.handleQishuiStatus(owned.cookie);
    console.log(JSON.stringify({accountValidated:account.sessionValidated===true,loggedIn:account.loggedIn,membershipKnown:account.membershipKnown}));
    let songs=[];
    try{songs=(await core.handleQishuiPcSearch('Back on Tour Connor Price',10,owned.cookie,0)).songs||[];}catch(error){console.log(JSON.stringify({searchError:error.code||error.message}));}
    const library = await core.handleQishuiUserPlaylists(owned.cookie);
    for(const item of library.playlists||[]){
      const list=await core.handleQishuiPlaylistTracks(item.id,{offset:0,limit:30},owned.cookie);
      songs.push(...(list.tracks||[]));
      if(songs.some(value=>/back on tour/i.test(value.name||value.title)))break;
    }
    const song = songs.find(value=>/back on tour/i.test(value.name||value.title)&&/connor price/i.test(value.artist||''))||songs[0];
    console.log(JSON.stringify({candidateCount:songs.length,matchedTitle:song?.name||song?.title,songId:song?.id,songKeys:song?Object.keys(song):[]}));
    if(song){
      const result=await core.handleQishuiSongUrl({id:song.id||song.providerSongId,quality:'auto'},owned.cookie);
      console.log(JSON.stringify({playable:result.playable,hasURL:!!result.url,quality:result.quality,qualityOptions:result.qualityOptions,message:result.message,encrypted:result.encrypted,duration:result.duration,trial:result.trial}));
    }
  } finally {http.dispose();await chromium.closeAllConnections();app.quit();}
}
if(process.versions.electron)run().catch(error=>{console.error(String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,180));require('electron').app.exit(1);});
else {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require('electron'),[__filename],{cwd:root,env,windowsHide:true,stdio:'inherit'});
  const timer=setTimeout(()=>child.kill(),90000);
  child.on('exit',code=>{clearTimeout(timer);process.exitCode=code??1;});
}
