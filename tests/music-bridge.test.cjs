'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {installMusicBridge}=require('../src/music-bridge.cjs');

function fixture(t,{fetchImpl=async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}}),requestImpl,platform,decoderFactory,pilotFactory}={}){
  const handlers=new Map(),protocols=new Map(),calls=[],events=[],fetches=[];
  let options,created=0,sessionCount=0,connectionsClosed=0,disposed=0;const mediaUpdates=[];
  const apiSession={setPermissionRequestHandler(fn){this.permission=fn;},setPermissionCheckHandler(fn){this.check=fn;},fetch(url,init){fetches.push({url,init});return fetchImpl(url,init);},async closeAllConnections(){connectionsClosed++;}};
  const service={request:async(action,payload)=>{calls.push({action,payload});return requestImpl?requestImpl(action,payload):{state:'signedOut',profile:null};},getState:()=>({state:'signedOut'}),async dispose(){disposed++;}};
  const web={isDestroyed:()=>false,send:(...args)=>events.push(args)};
  const bridge=installMusicBridge({dataDir:'isolated-test-only',isDashboard:event=>event.trusted===true,getHostWindow:()=>({webContents:web}),onMediaState:value=>mediaUpdates.push(value),electron:{
    ipcMain:{handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>handlers.delete(key)},
    protocol:{handle:(key,fn)=>protocols.set(key,fn),unhandle:key=>protocols.delete(key)},
    session:{fromPartition(name,options){assert.equal(name,'pulse-music-auth');assert.deepEqual(options,{cache:false});sessionCount++;return apiSession;}},
    safeStorage:{encryptString:value=>Buffer.from('encrypted:'+value),decryptString:buffer=>buffer.toString().slice(10),isEncryptionAvailable:()=>true}
  },factories:{createService(value){created++;options=value;return service;},...(platform?{createPlatformLogin:()=>platform}:{}),...(decoderFactory?{createQishuiStream:decoderFactory}:{}),...(pilotFactory?{createSpotifyBrowserPilot:pilotFactory}:{})}});
  t.after(()=>bridge.dispose());
  return {bridge,handlers,protocols,calls,events,fetches,apiSession,mediaUpdates,get options(){return options;},get created(){return created;},get sessionCount(){return sessionCount;},get disposed(){return disposed;},get connectionsClosed(){return connectionsClosed;},invoke:(action,payload,event={trusted:true})=>handlers.get('pulse:music')(event,action,payload),image:(url,method='GET')=>protocols.get('pulse-music-image')({method,url:'pulse-music-image://image?url='+encodeURIComponent(url)})};
}

test('music bridge registers locally without loading account service or creating a network session',async t=>{
  const f=fixture(t);assert.equal(f.created,0);assert.equal(f.sessionCount,0);assert.equal(f.bridge.getStatus().loaded,false);
  f.bridge.cancel();await f.invoke('cancelQR',{});assert.equal(f.created,0);
  await assert.rejects(f.invoke('bootstrap',{}, {trusted:false}),/Untrusted/);
  assert.match((await f.invoke('loginCookie',{cookie:'never accepted'})).error,/无效/);assert.equal(f.created,0);
});

test('island playback relay accepts only the local panel reply and cancels pending commands on close',async t=>{
  const f=fixture(t),pending=f.bridge.control('seek',{songId:'track',position:18});
  const message=f.events.find(value=>value[0]==='pulse:music-control')[1];assert.equal(message.songId,'track');assert.equal(message.position,18);assert.equal(f.created,0);
  const reply=f.handlers.get('pulse:music-control-result');assert.throws(()=>reply({trusted:false},message.id,{ok:true}),/Untrusted/);
  reply({trusted:true},message.id,{ok:true});assert.deepEqual(await pending,{ok:true});
  const later=f.bridge.control('next',{songId:'track'});f.bridge.cancel();assert.match((await later).error,/关闭/);
  assert.match((await f.bridge.control('shell',{songId:'track'})).error,/不可用/);
});

test('now playing publishes metadata through the trusted bridge without starting the account service',async t=>{
  const f=fixture(t),value={id:'1',title:'Song',playing:true,position:9,duration:100};
  assert.deepEqual(await f.invoke('nowPlaying',value),{accepted:true});assert.equal(f.mediaUpdates.at(-1),value);assert.equal(f.created,0);
  await assert.rejects(f.invoke('nowPlaying',value,{trusted:false}),/Untrusted/);f.bridge.cancel();assert.equal(f.mediaUpdates.at(-1),null);
});

test('embedded provider requests stay local and expose only opaque authorized audio URLs',async t=>{
  const song={id:'qq:001SongMid',source:'qq',title:'Q',artist:'Artist',duration:200};
  const platform={request:async()=>({song,url:'https://ws.stream.qqmusic.qq.com/audio?ticket=upstream-secret',quality:'standard',cookie:'must-not-leak'}),close:()=>({closed:true}),setBounds:()=>({updated:true}),dispose:async()=>{}};
  const f=fixture(t,{platform});
  assert.deepEqual(await f.invoke('platformBounds',{provider:'qq',bounds:{x:1,y:1,width:400,height:300}}),{updated:true});
  const result=await f.invoke('play',{id:song.id,source:'qq'});
  assert.match(result.audioURL,/^pulse-music-audio:\/\/track\//);assert.equal(result.song.id,song.id);assert.equal(result.source,'qq');
  assert(!JSON.stringify(result).includes('upstream-secret'));assert(!JSON.stringify(result).includes('must-not-leak'));
  const response=await f.protocols.get('pulse-music-audio')(new Request(result.audioURL));assert.equal(response.status,200);await response.arrayBuffer();
  assert.equal(f.fetches.at(-1).url,'https://ws.stream.qqmusic.qq.com/audio?ticket=upstream-secret');
  assert.deepEqual(await f.invoke('platformClose',{provider:'qq'}),{closed:true});
  await assert.rejects(f.invoke('platformRequest',{provider:'qq',action:'play'},{trusted:false}),/Untrusted/);
});

test('normal Qishui play routes official H5 preview metadata into an opaque 30-second stream',async t=>{
  const calls=[],song={id:'qishui:456',source:'qishui',title:'Fixture Song',artist:'A',duration:172};
  const platform=require('../src/music/providers/qishui.cjs').createQishuiAdapter({requestText:async(value)=>{
    const url=new URL(value);calls.push(url.pathname);
    if(url.pathname==='/luna/pc/me')return JSON.stringify({data:{my_info:{id:'fixture-user'},is_vip:false}});
    if(url.pathname==='/luna/pc/track_v2')return '';
    if(url.pathname==='/luna/h5/seo_track')return JSON.stringify({seo_track:{track:{id:'456',duration:172000,bit_rates:[{main_url:'https://v3.douyinvod.com/preview?private=fixture',quality:'standard',bitrate:128000,format:'m4a',duration:30}]}}});
    throw new Error('Unexpected fixture request');
  },network:{cookies:{get:async()=>[]}},factories:{createStore:()=>({read:()=>({cookie:'sessionid=owned-fixture'}),save(){},clear(){}})}});
  const f=fixture(t,{platform,fetchImpl:async(_url,init)=>new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Type':'audio/mp4','Content-Range':'bytes 0-2/999'}})});
  const result=await f.invoke('play',{id:song.id,source:'qishui',song});
  assert.equal(result.trial,true);assert.equal(result.song.duration,30);assert.match(result.qualityLabel,/试听/);assert.match(result.audioURL,/^pulse-music-audio:\/\//);
  assert(!JSON.stringify(result).includes('private=fixture'));assert(!JSON.stringify(result).includes('sessionid'));assert.equal(f.fetches.length,0);
  const response=await f.protocols.get('pulse-music-audio')(new Request(result.audioURL,{headers:{Range:'bytes=0-2'}}));
  assert.equal(response.status,206);await response.arrayBuffer();assert.equal(f.fetches.at(-1).init.headers.Range,'bytes=0-2');assert.equal(f.fetches.at(-1).init.cache,'no-store');
  assert.equal(calls.filter(value=>value==='/luna/h5/seo_track').length,1);
});

test('invalid Qishui preview duration and another providers trial cannot replace prepared audio',async t=>{
  let provider='qishui',duration=0;
  const platform={request:async()=>({song:{id:provider+':456',source:provider,title:'Preview'},trial:true,duration,url:'https://v3.douyinvod.com/preview'}),dispose:async()=>{}};
  const f=fixture(t,{platform,requestImpl:async()=>({audioURL:'https://m7.music.126.net/committed'})});
  const current=await f.invoke('play',{id:'1'});
  assert.match((await f.invoke('play',{id:'qishui:456'})).error,/有效时长/);
  provider='qq';duration=30;assert.match((await f.invoke('play',{id:'qq:456'})).error,/试听授权/);
  const response=await f.protocols.get('pulse-music-audio')(new Request(current.audioURL));assert.equal(response.status,200);await response.arrayBuffer();assert.equal(f.fetches.at(-1).url,'https://m7.music.126.net/committed');
});

test('an earlier provider play cannot replace a newer prepared stream',async t=>{
  let finish;
  const platform={request:()=>new Promise(resolve=>{finish=resolve;}),close:()=>{},dispose:async()=>{}};
  const f=fixture(t,{platform,requestImpl:async()=>({audioURL:'https://m7.music.126.net/current',song:{id:'2'}})});
  const old=f.invoke('play',{id:'qq:oldMid',source:'qq'});
  const current=await f.invoke('play',{id:'2'});
  finish({song:{id:'qq:oldMid',title:'Old',artist:'A',source:'qq'},url:'https://ws.stream.qqmusic.qq.com/old'});
  assert.deepEqual(await old,{canceled:true});
  const response=await f.protocols.get('pulse-music-audio')(new Request(current.audioURL));assert.equal(response.status,200);await response.arrayBuffer();assert.equal(f.fetches.at(-1).url,'https://m7.music.126.net/current');
});

test('a real source switch matches metadata before requesting a stream and keeps signed URLs private',async t=>{
  const song={id:'qq:matched',title:'Track',artist:'A / B',source:'qq',duration:201},requests=[];
  const platform={request:async payload=>{requests.push(payload);return payload.action==='search'?{songs:[{...song,id:'qq:wrong',title:'Track live'},song]}:{song,url:'https://ws.stream.qqmusic.qq.com/source?private=1',quality:'lossless'};},close:()=>{},dispose:async()=>{}};
  const f=fixture(t,{platform});
  const result=await f.invoke('switchSource',{provider:'qq',song:{id:'1',title:'Track',artist:'B / A',duration:200}});
  assert.equal(result.song.id,song.id);assert.match(result.audioURL,/^pulse-music-audio:/);assert.equal(requests[1].id,song.id);assert(!JSON.stringify(result).includes('private=1'));
  const failed=await f.invoke('switchSource',{provider:'qq',song:{id:'1',title:'Different',artist:'B / A',duration:200}});
  assert.match(failed.error,/没有匹配/);assert.equal(requests.filter(value=>value.action==='play').length,1);
});

test('playlist IDs route separately from song hashes and logging out of NetEase preserves another platform stream',async t=>{
  const calls=[],song={id:'qq:mid',source:'qq',title:'Q',artist:'A'};
  const platform={request:async payload=>{calls.push(payload);return payload.action==='playlist'?{songs:[song]}:{song,url:'https://ws.stream.qqmusic.qq.com/track'};},close:()=>{},dispose:async()=>{}};
  const f=fixture(t,{platform});assert.equal((await f.invoke('playlist',{id:'kugou:5'})).songs.length,1);assert.equal(calls[0].provider,'kugou');
  const current=await f.invoke('play',{id:song.id,source:'qq'});await f.invoke('logout');
  const response=await f.protocols.get('pulse-music-audio')(new Request(current.audioURL));assert.equal(response.status,200);await response.arrayBuffer();
});

test('music bridge injects OS encryption only into service and emits separate public account IPC',async t=>{
  const f=fixture(t);await f.invoke('bootstrap');assert.equal(f.created,1);assert.equal(f.sessionCount,0);
  assert.equal(f.options.isEncryptionAvailable(),true);const value=f.options.encryptString('unit-test-only');assert(Buffer.isBuffer(value));assert.equal(f.options.decryptString(value),'unit-test-only');
  f.options.onStatus({state:'signedOut',profile:null});assert.deepEqual(f.events,[['pulse:music-update',{state:'signedOut',profile:null}]]);
  await f.options.fetchImpl('https://music.163.com/test',{method:'POST'});assert.equal(f.sessionCount,1);assert.equal(f.apiSession.check(),false);
  let permitted;f.apiSession.permission(null,null,value=>{permitted=value;});assert.equal(permitted,false);
  assert.equal(f.fetches[0].url,'https://music.163.com/test');
  assert.equal(f.fetches[0].init.credentials,'omit');
});

test('a late earlier play request cannot invalidate the newer prepared audio track',async t=>{
  const pending=new Map(),f=fixture(t,{requestImpl:(action,payload)=>action==='play'?new Promise(resolve=>pending.set(payload.id,resolve)):Promise.resolve({ok:true})});
  const first=f.invoke('play',{id:1}),second=f.invoke('play',{id:2});
  pending.get(2)({audioURL:'https://m7.music.126.net/second',song:{id:2}});const current=await second;
  pending.get(1)({audioURL:'https://m7.music.126.net/first',song:{id:1}});assert.deepEqual(await first,{canceled:true});
  const response=await f.protocols.get('pulse-music-audio')(new Request(current.audioURL));assert.equal(response.status,200);await response.arrayBuffer();
  assert.equal(f.fetches.at(-1).url,'https://m7.music.126.net/second');
  await f.invoke('stopAudio');assert.equal((await f.protocols.get('pulse-music-audio')(new Request(current.audioURL))).status,404);
});

test('music avatar protocol refuses non-NetEase hosts and methods without creating network or auth services',async t=>{
  const f=fixture(t);
  for(const url of ['https://example.com/a','https://p1.music.126.net.evil.example/a','https://user:pass@p1.music.126.net/a','https://p1.music.126.net:8443/a','file:///C:/private','https://127.0.0.1/a'])assert.equal((await f.image(url)).status,400,url);
  assert.equal((await f.image('https://p1.music.126.net/a','POST')).status,405);
  assert.equal(f.sessionCount,0);assert.equal(f.created,0);
});

test('official HTTP image CDN addresses are upgraded to HTTPS before fetching',async t=>{
  const f=fixture(t);
  assert.equal((await f.image('http://p1.music.126.net/legacy.jpg')).status,200);
  assert.equal(new URL(f.fetches[0].url).protocol,'https:');
  assert.equal(new URL(f.fetches[0].url).hostname,'p1.music.126.net');
  assert.equal(new URL(f.fetches[0].url).pathname,'/legacy.jpg');
  assert.equal(f.sessionCount,1);
  assert.equal(f.created,0);
});

test('music avatar requests use an isolated session, support actual p1c CDN, and reuse bounded image cache',async t=>{
  const f=fixture(t);for(const host of ['p1.music.126.net','p1c.music.126.net']){
    const result=await f.image('https://'+host+'/avatar.jpg');assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/png');assert.equal((await result.arrayBuffer()).byteLength,3);
  }
  assert.equal(f.created,0);assert.equal(f.sessionCount,1);assert.equal(f.fetches.length,2);assert.equal(f.fetches[0].init.redirect,'error');assert.equal(f.fetches[0].init.credentials,'omit');
  await f.image('https://p1.music.126.net/avatar.jpg');assert.equal(f.fetches.length,2);
  for(let n=0;n<7;n++)await f.image('https://p1.music.126.net/'+n+'.png');assert.equal(f.bridge.getStatus().imageCount,9);
});

test('music avatar cache total bytes stay bounded and rejected images never enter cache',async t=>{
  const f=fixture(t,{fetchImpl:async url=>{
    if(new URL(url).pathname.endsWith('/wrong'))return new Response('html',{headers:{'Content-Type':'text/html'}});
    if(new URL(url).pathname.endsWith('/declared'))return new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png','Content-Length':String(2*1024*1024+1)}});
    if(new URL(url).pathname.endsWith('/oversized'))return new Response(new Uint8Array(2*1024*1024+1),{headers:{'Content-Type':'image/png'}});
    return new Response(new Uint8Array(800000),{headers:{'Content-Type':'image/png'}});
  }});
  for(const suffix of ['wrong','declared','oversized'])assert.equal((await f.image('https://p1.music.126.net/'+suffix)).status,502);
  assert.equal(f.bridge.getStatus().imageCount,0);
  for(let n=0;n<4;n++)assert.equal((await f.image('https://p1.music.126.net/'+n)).status,200);
  assert.equal(f.bridge.getStatus().imageCount,4);
});

test('music bridge caps avatar concurrency and aborts requests and releases handlers on dispose',async t=>{
  const f=fixture(t,{fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))});
  await f.invoke('bootstrap');const pending=Array.from({length:8},(_,n)=>f.image('https://p1.music.126.net/'+n));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.fetches.length,4);assert.equal(f.bridge.getStatus().queued,4);
  await f.bridge.dispose();assert.deepEqual(await Promise.all(pending.map(async task=>(await task).status)),[502,502,502,502,502,502,502,502]);
  assert.equal(f.disposed,1);assert.equal(f.connectionsClosed,1);assert.equal(f.handlers.size,0);assert.equal(f.protocols.size,0);assert.equal(f.bridge.getStatus().imageCount,0);
});

test('cancel accepts synchronous service results and throwing cancellation without an uncaught exception',async t=>{const handlers=new Map(),protocol={handle(){},unhandle(){}},actions=[];const bridge=installMusicBridge({dataDir:'isolated',isDashboard:()=>true,electron:{ipcMain:{handle:(k,v)=>handlers.set(k,v),removeHandler(){}},protocol,session:{},safeStorage:{}},factories:{createService:()=>({request(action){actions.push(action);if(action==='cancelQR')return {canceled:true};if(action==='deactivate')throw new Error('synthetic cancellation');return {};},getState:()=>({}),dispose:async()=>{}})}});t.after(()=>bridge.dispose());await handlers.get('pulse:music')({},'bootstrap');assert.doesNotThrow(()=>bridge.cancel());await new Promise(resolve=>setImmediate(resolve));assert(actions.includes('cancelQR')&&actions.includes('deactivate'));});


test('authorized Qishui decoder is validated before replacing audio and private keys stay in main',async t=>{
  let release,disposed=0,received;
  const song={id:'qishui:owned_track',source:'qishui',title:'Qishui',artist:'A'};
  const decoder={ready:()=>new Promise(resolve=>{release=resolve;}),handle:async()=>new Response('decoded-synthetic-sample'),dispose:()=>{disposed++;}};
  const platform={request:async()=>({song,url:'https://v3.douyinvod.com/owned',encrypted:true,authorization:'synthetic-private-key',quality:'standard',qualityOptions:[{id:'standard',label:'Standard',authorization:'never-public'}]}),dispose:async()=>{}};
  const f=fixture(t,{platform,decoderFactory:value=>{received=value;return decoder;},requestImpl:async()=>({audioURL:'https://m7.music.126.net/existing'})});
  const existing=await f.invoke('play',{id:'1'});
  const candidate=f.invoke('play',{id:song.id,source:'qishui'});await new Promise(setImmediate);
  assert.equal(received.authorization,'synthetic-private-key');
  const oldResponse=await f.protocols.get('pulse-music-audio')(new Request(existing.audioURL));assert.equal(oldResponse.status,200);await oldResponse.arrayBuffer();
  release();const result=await candidate;
  assert(!JSON.stringify(result).includes('private-key'));assert(!JSON.stringify(result).includes('never-public'));assert(!JSON.stringify(result).includes('douyinvod'));
  assert.equal(await (await f.protocols.get('pulse-music-audio')(new Request(result.audioURL))).text(),'decoded-synthetic-sample');
  await f.invoke('stopAudio');assert.equal(disposed,1);
});

test('a newer play cancels obsolete Qishui preparation without stopping the committed stream',async t=>{
  let canceled=0,readyStarted=0;const decoders=[];
  const platform={request:async payload=>({song:{id:payload.id,source:'qishui',title:'Q',artist:'A'},url:'https://v3.douyinvod.com/owned',encrypted:true,authorization:'synthetic-key'}),dispose:async()=>{}};
  const f=fixture(t,{platform,decoderFactory:()=>{let reject;const decoder={ready:()=>{readyStarted++;return new Promise((_resolve,fail)=>{reject=fail;});},dispose:()=>{canceled++;reject?.(new Error('canceled'));}};decoders.push(decoder);return decoder;},requestImpl:async()=>({audioURL:'https://m7.music.126.net/existing'})});
  const committed=await f.invoke('play',{id:'1'});
  const first=f.invoke('play',{id:'qishui:first'});await new Promise(setImmediate);
  const second=f.invoke('play',{id:'qishui:second'});await new Promise(setImmediate);
  const third=f.invoke('play',{id:'qishui:third'});await new Promise(setImmediate);
  assert.equal(readyStarted,3);assert(canceled>=2);
  const current=await f.protocols.get('pulse-music-audio')(new Request(committed.audioURL));assert.equal(current.status,200);await current.arrayBuffer();
  await f.invoke('stopAudio');const results=await Promise.all([first,second,third]);assert(results.every(result=>result.error||result.canceled));
});


test('dashboard lifetime sees pending playback and background cleanup keeps the prepared stream',async t=>{
 let finish;
 const f=fixture(t,{requestImpl:async(action)=>action==='play'?new Promise(resolve=>{finish=resolve;}):{canceled:true}});
 assert.equal(f.bridge.hasPlayback(),false);
 const pending=f.invoke('play',{id:'1'});assert.equal(f.bridge.hasPlayback(),true);
 f.bridge.background();finish({song:{id:'1'},audioURL:'https://m7.music.126.net/background'});
 const result=await pending;assert.equal(f.bridge.hasPlayback(),true);
 f.bridge.background();const response=await f.protocols.get('pulse-music-audio')(new Request(result.audioURL));assert.equal(response.status,200);await response.arrayBuffer();
 await f.invoke('stopAudio');assert.equal(f.bridge.hasPlayback(),false);
});


test('favorites route by the playing song ID, reject mismatched platforms and never fall back to NetEase',async t=>{
 const calls=[],id='spotify:1234567890ABCDEFGHIJKL';
 const platform={request:async payload=>{calls.push(payload);return {id:payload.id,liked:payload.liked};},dispose:async()=>{}};
 const f=fixture(t,{platform,requestImpl:async()=>{throw new Error('must not mutate NetEase');}});
 assert.deepEqual(await f.invoke('like',{id,source:'spotify',liked:true}),{id,liked:true});assert.equal(calls[0].provider,'spotify');assert.equal(calls[0].action,'like');
 assert.match((await f.invoke('like',{id,source:'qq',liked:false})).error,/不匹配/);assert.equal(calls.length,1);
 for(const [provider,key] of [['qq','FixtureMid'],['kugou','abcdef0123456789abcdef0123456789'],['qishui','123456789']]){
   const track=provider+':'+key;assert.deepEqual(await f.invoke('like',{id:track,source:provider,liked:true}),{id:track,liked:true});assert.equal(calls.at(-1).provider,provider);
 }
 assert.equal(calls.length,4);assert.equal(f.calls.length,0);
});

// The adapter is selected through the normal UI IPC; no separate pilot action.
test('selecting a logged-in Spotify account automatically enables the native catalog and shared playback/actions', async t => {
 const calls=[];
 const profile={userId:'owner',nickname:'Listener'};
 const song={id:'spotify:1234567890ABCDEFGHIJKL',title:'Song',artist:'Artist',source:'spotify'};
 let enabled=false,starts=0,disposed=false,preferences={activeProvider:'netease'};
 const platform={async status(){return {provider:'spotify',webAuthenticated:true,webProfile:profile,apiConnected:false};},async request(){throw new Error('The Web API must not be used by the DOM bridge');},async dispose(){}};
 const pilot={get enabled(){return enabled;},async start(value){assert.deepEqual(value,profile);if(!enabled)starts++;enabled=true;},async request(value){calls.push(value);if(value.action==='home')return {playlists:[{id:'spotify:ABCDEFGHIJKLMNOPQRSTUV',title:'Mix'}],songs:[song],discoveryModes:[]};if(value.action==='play')return {remote:true,song,qualityLabel:'Spotify 官方网页'};if(value.action==='playlists')return {playlists:[]};if(value.action==='like')return {id:song.id,liked:value.liked};return {ok:true};},async dispose(){disposed=true;}};
 const f=fixture(t,{platform,pilotFactory:()=>pilot,requestImpl:async(action,payload)=>{if(action==='preferences'){preferences={...preferences,...payload};return {preferences};}return {};}});
 const selected=await f.invoke('selectProvider',{provider:'spotify'});
 assert.equal(selected.browserBridge,true);assert.equal(selected.webPlayer,false);assert.equal(starts,1);
 const home=await f.invoke('home',{});assert.equal(home.provider,'spotify');assert.equal(home.songs[0].id,song.id);assert.notEqual(home.webPlayer,true);
 assert.equal((await f.invoke('play',{id:song.id,source:'spotify'})).remote,true);assert(f.bridge.hasPlayback());
 assert.deepEqual(await f.invoke('like',{id:song.id,source:'spotify',liked:true}),{id:song.id,liked:true});
 await f.invoke('userPlaylists',{source:'spotify',songId:song.id});assert(calls.some(value=>value.action==='playlists'&&value.songId===song.id));
 await f.bridge.dispose();assert(disposed);
});

test('normal Spotify lyric IPC uses the same-recording catalog lookup without changing the playing source',async t=>{
 const song={id:'spotify:1234567890ABCDEFGHIJKL',title:'Matched Song',artist:'Artist',duration:193,source:'spotify'};
 let enabled=false;
 const platform={status:async()=>({provider:'spotify',webAuthenticated:true,webProfile:{userId:'owned',nickname:'Owner'}}),request:async()=>{throw new Error('Wrong provider route');},async dispose(){}};
 const f=fixture(t,{platform,pilotFactory:options=>({get enabled(){return enabled;},async start(){enabled=true;},async request(payload){if(payload.action==='lyrics')return options.lookupLyrics(song);return {songs:[song],playlists:[]};},async dispose(){}}),requestImpl:async(action,payload)=>{
   if(action==='search')return {songs:[{id:'123',title:song.title,artist:song.artist,duration:193}]};
   if(action==='lyrics'){assert.equal(payload.id,'123');return {lines:[{time:1,text:'Timed line'}],timingSource:'lrc-line'};}
   return {};
 }});
 await f.invoke('selectProvider',{provider:'spotify'});
 const result=await f.invoke('lyrics',{id:song.id,song});assert.equal(result.lines[0].time,1);assert.equal(result.lyricSource,'netease');
 assert.equal(f.calls.some(value=>value.action==='play'||value.action==='like'),false);
});
