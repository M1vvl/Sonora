'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createQishuiAdapter}=require('../src/music/providers/qishui.cjs');
const {createQishuiStore}=require('../src/music/providers/qishui-store.cjs');
function fixture({encrypted=false,profileFailure=false,vip=false,holdTrack}={}){
  let saved={cookie:'sessionid=owned-fixture'},disposedAuth=false,polls=0,cleared=0;const calls=[];
  const requestText=async(value,_options)=>{const url=new URL(value);calls.push(url.pathname);
    if(url.pathname==='/luna/pc/me')return JSON.stringify(profileFailure?{status_code:1000016,status_info:{status_msg:'expired'}}:{data:{my_info:{id:'fixture-user',nickname:'Fixture User'},is_vip:vip,vip_end_time:vip?Math.floor(Date.now()/1000)+3600:0,is_svip:false}});
    if(url.pathname==='/luna/pc/user/playlist')return JSON.stringify({data:{playlists:[{id:'123',name:'Fixture List',track_count:2,type:'playlist'}]}});
    if(url.pathname==='/luna/pc/playlist/detail')return JSON.stringify({data:{playlist:{id:'123',name:'Fixture List',track_count:1},tracks:[{id:'456',name:'Fixture Song',duration_ms:180000}],has_more:false}});
    if(url.pathname==='/luna/pc/search/track')return JSON.stringify({data:{tracks:[{id:'456',name:'Fixture Song',duration_ms:180000}],has_more:false}});
    if(url.pathname==='/luna/pc/track_v2'){const body=JSON.stringify({data:{track:{id:'456',name:'Fixture Song',duration_ms:180000,audio_info:{play_info_list:[{main_url:'https://media.test.invalid/low.m4a',quality:'standard',format:'m4a',bitrate:128000,duration:180,play_auth:encrypted?'00112233445566778899aabbccddeeff':''},{main_url:'https://media.test.invalid/high.m4a',quality:'exhigh',format:'m4a',bitrate:320000,duration:180},{main_url:'https://media.test.invalid/blocked.flac',quality:'lossless',format:'flac',bitrate:999000,duration:180}]}}}});return holdTrack?holdTrack(body):body;};
    return JSON.stringify({status_code:0,data:{}});
  };
  const adapter=createQishuiAdapter({requestText,network:{cookies:{get:async()=>[]},clearStorageData:async()=>{cleared++;}},factories:{createStore:()=>({read:()=>({...saved}),save:value=>{saved={...saved,...value};},clear:()=>{saved={};}}),createPassport:()=>({createQr:async()=>({token:'private-upstream-token',qrImage:'data:image/png;base64,fixture',expiresAt:Date.now()+180000,generation:1}),checkQr:async()=>{polls++;return {status:'confirmed'};},cancel(){},dispose:async()=>{disposedAuth=true;},setBounds(){}})}});
  return {adapter,calls,saved:()=>saved,polls:()=>polls,authDisposed:()=>disposedAuth,cleared:()=>cleared};
}
test('Qishui own session validates identity, libraries, paged songs and search through the PC closure',async()=>{
  const f=fixture();try{assert(await f.adapter.hasSession());const profile=await f.adapter.request({action:'profile'});assert(profile.apiConnected);assert.equal(profile.profile.nickname,'Fixture User');assert.equal(f.adapter.getProfile().userId,'fixture-user');const lists=await f.adapter.request({action:'playlists'});assert(lists.playlists.some(value=>value.id==='qishui:123'));const songs=await f.adapter.request({action:'playlist',id:'qishui:123'});assert.equal(songs.songs[0].id,'qishui:456');const search=await f.adapter.request({action:'search',query:'Fixture'});assert.equal(search.songs[0].title,'Fixture Song');assert(f.calls.every(value=>!value.includes('oauth')));}finally{await f.adapter.dispose();}
});
test('real authorized quality options select different returned streams and hide premium-only choices',async()=>{
  const f=fixture({encrypted:true,vip:true});try{
    const options=await f.adapter.request({action:'playbackOptions',id:'qishui:456'});assert.deepEqual(options.qualityOptions.map(value=>value.id),['lossless','exhigh','standard']);assert(!JSON.stringify(options).includes('main_url'));assert(!JSON.stringify(options).includes('play_auth'));
    const standard=await f.adapter.request({action:'play',id:'qishui:456',quality:'standard'});assert.match(standard.url,/low\.m4a$/);assert.equal(standard.encrypted,true);assert.equal(standard.authorization,'00112233445566778899aabbccddeeff');assert(!standard.url.includes('#'));assert.equal(standard.quality,'standard');assert.deepEqual(standard.qualityOptions.map(value=>value.id),['lossless','exhigh','standard']);assert(!JSON.stringify(standard.qualityOptions).includes('play_auth'));
    const high=await f.adapter.request({action:'play',id:'qishui:456',quality:'exhigh'});assert.match(high.url,/high\.m4a$/);assert.equal(high.quality,'exhigh');
    await assert.rejects(f.adapter.request({action:'play',id:'qishui:456',quality:'hi_res'}),/所选|音源/);
  }finally{await f.adapter.dispose();}
  const free=fixture();try{const result=await free.adapter.request({action:'play',id:'qishui:456',quality:'auto'});assert.deepEqual(result.qualityOptions.map(value=>value.id),['standard']);await assert.rejects(free.adapter.request({action:'play',id:'qishui:456',quality:'lossless'}),/所选|音源/);}finally{await free.adapter.dispose();}
});
test('Qishui retries incomplete successful POST metadata through its existing GET route',async()=>{
  const calls=[];
  const adapter=createQishuiAdapter({requestText:async(value,options={})=>{
    const url=new URL(value);calls.push({path:url.pathname,method:options.method||'GET'});
    if(url.pathname==='/luna/pc/me')return JSON.stringify({data:{my_info:{id:'fixture-user'},is_vip:false}});
    if(url.pathname==='/luna/pc/track_v2'&&options.method==='POST')return JSON.stringify({status_code:0,data:{}});
    if(url.pathname==='/luna/pc/track_v2')return JSON.stringify({data:{track:{id:'456',audio_info:{play_info_list:[{main_url:'https://media.test.invalid/song.m4a',quality:'standard',bitrate:128000,format:'m4a'}]}}}});
    throw new Error('Unexpected fixture request');
  },network:{cookies:{get:async()=>[]}},factories:{createStore:()=>({read:()=>({cookie:'sessionid=owned-fixture'}),save(){},clear(){}})}});
  try{
    const result=await adapter.request({action:'play',id:'qishui:456',quality:'standard'});
    assert.match(result.url,/song\.m4a$/);
    assert.deepEqual(calls.filter(value=>value.path==='/luna/pc/track_v2').map(value=>value.method),['POST','GET']);
  }finally{await adapter.dispose();}
});

test('official H5 fallback keeps its authorized duration separate from the catalog and fails closed when unknown',async()=>{
  for(const scenario of [
    {streamDuration:30,fullDuration:172000,trial:true,duration:30},
    {streamDuration:172,fullDuration:172000,trial:false,duration:172},
    {auditionDuration:30000,fullDuration:172000,trial:true,duration:30},
    {streamDuration:172,auditionDuration:30000,fullDuration:172000,trial:true,duration:30},
    {streamDuration:30,trial:true,duration:30},
    {fullDuration:172000,rejected:true}
  ]){
    const calls=[];
    const adapter=createQishuiAdapter({requestText:async(value,options={})=>{
      const url=new URL(value);calls.push({path:url.pathname,method:options.method||'GET'});
      if(url.pathname==='/luna/pc/me')return JSON.stringify({data:{my_info:{id:'fixture-user'},is_vip:false}});
      if(url.pathname==='/luna/pc/track_v2')return '';
      if(url.pathname==='/luna/h5/seo_track')return JSON.stringify({seo_track:{track:{id:'456',name:'Fixture Song',duration:scenario.fullDuration,bit_rates:[{main_url:'https://media.test.invalid/h5.m4a',quality:'standard',bitrate:128000,format:'m4a',duration:scenario.streamDuration}]}},track_player:scenario.auditionDuration?{audition_info:{duration_ms:scenario.auditionDuration}}:{}});
      throw new Error('Unexpected fixture request');
    },network:{cookies:{get:async()=>[]}},factories:{createStore:()=>({read:()=>({cookie:'sessionid=owned-fixture'}),save(){},clear(){}})}});
    try{
      const request=adapter.request({action:'play',id:'qishui:456',quality:'lossless',song:{title:'Fixture Song',duration:172}});
      if(scenario.rejected)await assert.rejects(request,/授权时长/);
      else{const result=await request;assert.equal(result.trial,scenario.trial);assert.equal(result.duration,scenario.duration);assert.equal(result.quality,'standard');}
      assert.deepEqual(calls.filter(value=>value.path==='/luna/pc/track_v2').map(value=>value.method),['POST','GET']);
      assert.equal(calls.filter(value=>value.path==='/luna/h5/seo_track').length,1);
    }finally{await adapter.dispose();}
  }
});

test('an expired PC session cannot fall back to the public H5 source',async()=>{
  const calls=[];
  const adapter=createQishuiAdapter({requestText:async(value)=>{
    const url=new URL(value);calls.push(url.pathname);
    return JSON.stringify({status_code:1000016,status_info:{status_msg:'expired'}});
  },network:{cookies:{get:async()=>[]}},factories:{createStore:()=>({read:()=>({cookie:'sessionid=owned-fixture'}),save(){},clear(){}})}});
  try{await assert.rejects(adapter.request({action:'play',id:'qishui:456'}),error=>error.code==='SESSION_EXPIRED');assert(!calls.includes('/luna/h5/seo_track'));}finally{await adapter.dispose();}
});

test('separate PC audition metadata cannot downgrade an authorized full stream',async()=>{
  const adapter=createQishuiAdapter({requestText:async(value)=>{
    if(new URL(value).pathname==='/luna/pc/me')return JSON.stringify({data:{my_info:{id:'fixture-user'},is_vip:false}});
    return JSON.stringify({data:{track:{id:'456',duration:172000,audio_info:{play_info_list:[{main_url:'https://media.test.invalid/full.m4a',quality:'standard',bitrate:128000,format:'m4a',duration:172}]}},track_player:{audition_info:{duration_ms:30000}}}});
  },network:{cookies:{get:async()=>[]}},factories:{createStore:()=>({read:()=>({cookie:'sessionid=owned-fixture'}),save(){},clear(){}})}});
  try{const result=await adapter.request({action:'play',id:'qishui:456'});assert.equal(result.duration,172);assert.equal(result.trial,false);}finally{await adapter.dispose();}
});
test('a genuinely expired Qishui server session clears its verified profile and broadcasts reauthentication',async()=>{
  let expired=false;const statuses=[];
  const adapter=createQishuiAdapter({requestText:async()=>JSON.stringify(expired?{status_code:1000016,status_info:{status_msg:'expired'}}:{data:{my_info:{id:'fixture-user',nickname:'Fixture'},is_vip:false}}),network:{cookies:{get:async()=>[]}},onStatus:value=>statuses.push(value),factories:{createStore:()=>({read:()=>({cookie:'sessionid=owned-fixture'}),save(){},clear(){}})}});
  try{await adapter.request({action:'profile'});assert(adapter.getProfile());expired=true;await assert.rejects(adapter.request({action:'profile'}),error=>error.code==='SESSION_EXPIRED');assert.equal(adapter.getProfile(),null);assert.equal(statuses.at(-1).profile,null);assert.equal(statuses.at(-1).apiConnected,false);assert.equal(statuses.at(-1).reauthRequired,true);}finally{await adapter.dispose();}
});
test('QR identifiers remain opaque and confirmation is reused only after server profile verification',async()=>{
  const f=fixture();const qr=await f.adapter.qrCreate();assert(qr.requestId);assert(!JSON.stringify(qr).includes('private-upstream-token'));assert.equal((await f.adapter.qrCheck({requestId:'stale'})).status,'expired');const done=await f.adapter.qrCheck({requestId:qr.requestId});assert.equal(done.status,'confirmed');assert(done.profile);await f.adapter.qrCheck({requestId:qr.requestId});assert.equal(f.polls(),1);await f.adapter.dispose();assert(f.authDisposed());assert(f.saved().cookie,'normal exit preserves the encrypted session');
  const bad=fixture({profileFailure:true});try{const code=await bad.adapter.qrCreate();await assert.rejects(bad.adapter.qrCheck({requestId:code.requestId}),/过期|验证/);assert.equal(bad.adapter.getProfile(),null);}finally{await bad.adapter.dispose();}
});
test('explicit logout clears the owned persisted session and provider session storage',async()=>{
  const f=fixture();try{await f.adapter.qrCreate();await f.adapter.logout();assert.equal(await f.adapter.hasSession(),false);assert.equal(f.cleared(),1);assert(f.authDisposed());}finally{await f.adapter.dispose();}
});
test('Qishui identity and session record uses atomic OS-encrypted persistence',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-qishui-store-'));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
  try{const store=createQishuiStore({dataDir:directory,safeStorage});store.save({cookie:'sessionid=private-test',deviceId:'1234567890123456'});const body=fs.readFileSync(path.join(directory,'music-qishui-auth.json'),'utf8');assert(!body.includes('private-test'));assert.equal(createQishuiStore({dataDir:directory,safeStorage}).read().cookie,'sessionid=private-test');store.clear();assert.deepEqual(fs.readdirSync(directory),[]);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('closing a QR destroys its SDK before a replacement creates hooks on the same owned session',async()=>{
  let instances=0,finishDisposal;const hooks=[];
  const adapter=createQishuiAdapter({requestText:async()=>JSON.stringify({data:{}}),network:{cookies:{get:async()=>[]}},factories:{createStore:()=>({read:()=>({}),save(){},clear(){}}),createPassport:()=>{const serial=++instances;hooks.push('create-'+serial);return {createQr:async()=>({token:'token-'+serial,qrImage:'data:image/png;base64,x',expiresAt:Date.now()+60000,generation:serial}),cancel(){},dispose:()=>{hooks.push('dispose-'+serial);return serial===1?new Promise(resolve=>{finishDisposal=resolve;}):Promise.resolve();}};}}});
  try{await adapter.qrCreate();const closing=adapter.closeQr();await new Promise(setImmediate);const replacement=adapter.qrCreate();await new Promise(setImmediate);assert.equal(instances,1);finishDisposal();await closing;await replacement;assert.deepEqual(hooks.slice(0,3),['create-1','dispose-1','create-2']);}finally{finishDisposal?.();await adapter.dispose();}
});


test('closing confirmed Passport resources preserves a pending authorized song request and its account',async()=>{
  let release;
  const f=fixture({holdTrack:body=>new Promise(resolve=>{release=()=>resolve(body);})});
  try{
    const qr=await f.adapter.qrCreate();await f.adapter.qrCheck({requestId:qr.requestId});
    const pending=f.adapter.request({action:'play',id:'qishui:456',quality:'standard'});
    await new Promise(setImmediate);assert.equal(typeof release,'function');
    await f.adapter.closeQr();assert(f.authDisposed());assert(f.adapter.getProfile());
    release();const result=await pending;assert.equal(result.quality,'standard');assert.match(result.url,/low\.m4a$/);
    assert.equal((await f.adapter.qrCheck({requestId:qr.requestId})).status,'expired');
    assert.equal((await f.adapter.request({action:'search',query:'Fixture'})).songs[0].id,'qishui:456');
  }finally{release?.();await f.adapter.dispose();}
});

test('explicit account cancellation and logout still invalidate pending authorized song requests',async()=>{
  for(const action of ['cancel','logout']){
    let release;const f=fixture({holdTrack:body=>new Promise(resolve=>{release=()=>resolve(body);})});
    try{
      await f.adapter.request({action:'profile'});
      const pending=f.adapter.request({action:'play',id:'qishui:456',quality:'standard'});
      await new Promise(setImmediate);assert.equal(typeof release,'function');
      await f.adapter[action]();release();await assert.rejects(pending,/已取消/);
      if(action==='logout'){assert.equal(await f.adapter.hasSession(),false);assert.equal(f.adapter.getProfile(),null);}
    }finally{release?.();await f.adapter.dispose();}
  }
});
