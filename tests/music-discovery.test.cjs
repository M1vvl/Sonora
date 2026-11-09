'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCatalog}=require('../src/music/catalog.cjs');
const {createNeteaseClient}=require('../src/music/netease.cjs');
const {MODES,createDiscovery}=require('../src/music/discovery.cjs');
const raw=id=>({id,name:'Song '+id,ar:[{name:'Artist'}],al:{name:'Album'},dt:100000});
const result=body=>Promise.resolve({body:{code:200,...body}});
function fixture({signedIn=true,...overrides}={}){
 const auth={state:signedIn?'signedIn':'signedOut',profile:signedIn?{userId:77}:null,cookie:signedIn?{MUSIC_U:'fixture'}:{}},calls=[];
 const client={dailySongs:()=>result({data:{dailySongs:[raw(1),raw(2),raw(3),raw(4),raw(5),raw(6)]}}),dailyPlaylists:()=>result({recommend:[{id:51,name:'私人雷达'}]}),publicPlaylists:()=>result({result:[{id:52,name:'Public'}]}),publicSongs:()=>result({result:[raw(1)]}),
  playlist:(id,options)=>{calls.push({kind:'playlist',id,options});return result({playlist:{id,name:'List',tracks:[raw(11),raw(12)]}});},
  personalFM:options=>{calls.push({kind:'fm',options});return result({data:[raw(20),raw(21)]});},
  userPlaylists:(uid,options)=>{calls.push({kind:'library',uid,options});return result({playlist:[{id:99,specialType:5,name:'我喜欢的音乐',creator:{userId:77}}]});},
  intelligence:(seed,pid,options)=>{calls.push({kind:'heart',seed,pid,options});return result({data:[{songInfo:raw(30)},{songInfo:raw(31)}]});},
  similarSongs:(seed,options)=>{calls.push({kind:'similar',seed,options});return result({songs:[raw(seed),raw(40),raw(41)]});},...overrides};
 return {catalog:createCatalog({client,getAuth:()=>auth,random:()=>0}),auth,calls};
}
test('discovery provider dispatcher exposes exactly five modes and rejects unsupported providers',async()=>{
 assert.deepEqual(MODES.map(mode=>mode.id),['daily','radar','fm','heart','similar']);
 const discover=createDiscovery({providers:{netease:{daily:async()=>({songs:[]})}}});
 await assert.rejects(discover({mode:'unknown'}),{code:'INVALID_DISCOVERY'});
 await assert.rejects(discover({mode:'daily',source:'unsupported'}),{code:'SOURCE_UNAVAILABLE'});
 await assert.rejects(discover({mode:'daily',source:'__proto__'}),{code:'SOURCE_UNAVAILABLE'});
 assert.equal((await discover({mode:'daily'})).source,'netease');
});
test('full daily deck uses distinct ordered metadata while anonymous daily remains honestly public',async()=>{
 const f=fixture({signedIn:false});try{
  const home=await f.catalog.home();assert.equal(home.cards.length,6);assert.equal(new Set(home.cards.map(value=>value.id)).size,6);
  const value=await f.catalog.discovery({mode:'daily'});assert.equal(value.label,'公开每日推荐');assert.equal(value.songs.length,6);assert.equal(value.mode,'daily');
  for(const mode of ['radar','fm','heart'])await assert.rejects(f.catalog.discovery({mode}),{code:'LOGIN_REQUIRED'});
  assert.equal(f.calls.length,0);
 }finally{await f.catalog.dispose();}
});
test('radar uses the named upstream playlist and never substitutes an ordinary recommendation',async()=>{
 const f=fixture();try{const value=await f.catalog.discovery({mode:'radar'});assert.equal(value.label,'私人雷达');assert.equal(value.playlist.id,'51');assert.equal(value.songs[0].id,'11');assert.equal(value.message,undefined);}finally{await f.catalog.dispose();}
 const fallback=fixture({dailyPlaylists:()=>result({recommend:[{id:63,name:'Other'}]})});try{await assert.rejects(fallback.catalog.discovery({mode:'radar'}),{code:'RADAR_UNAVAILABLE'});}finally{await fallback.catalog.dispose();}
});
test('FM and heart use official provider operations; heart reads the favourite playlist without mutating it',async()=>{
 const f=fixture();try{
  const fm=await f.catalog.discovery({mode:'fm'});assert.deepEqual(fm.songs.map(value=>value.id),['20','21']);
  const heart=await f.catalog.discovery({mode:'heart',seedId:'55'});assert.deepEqual(heart.songs.map(value=>value.id),['30','31']);
  const request=f.calls.find(value=>value.kind==='heart');assert.equal(request.seed,'55');assert.equal(request.pid,'99');assert.equal(request.options.cookie.MUSIC_U,'fixture');assert.equal(f.calls.find(value=>value.kind==='library').uid,77);
 }finally{await f.catalog.dispose();}
 const empty=fixture({userPlaylists:()=>result({playlist:[]})});try{await assert.rejects(empty.catalog.discovery({mode:'heart'}),{code:'CONTENT_UNAVAILABLE'});assert(!empty.calls.some(value=>value.kind==='heart'));}finally{await empty.catalog.dispose();}
});
test('similar songs require a validated seed, exclude that seed and never request a private operation',async()=>{
 const f=fixture({signedIn:false});try{
  await assert.rejects(f.catalog.discovery({mode:'similar',seedId:'http://invalid'}),{code:'SEED_REQUIRED'});
  assert.equal(f.calls.length,0);const value=await f.catalog.discovery({mode:'similar',seedId:'3'});assert.deepEqual(value.songs.map(value=>value.id),['40','41']);assert.equal(f.calls[0].seed,'3');assert.deepEqual(f.calls[0].options.cookie,{});
 }finally{await f.catalog.dispose();}
});
test('changing modes cancels a superseded response and deactivation cancels in-flight discovery',async()=>{
 let finish,signal;const f=fixture({personalFM:options=>{signal=options.signal;return new Promise(resolve=>finish=resolve);}});try{
  const previous=f.catalog.discovery({mode:'fm'});await Promise.resolve();const newer=await f.catalog.discovery({mode:'similar',seedId:'1'});assert.equal(newer.mode,'similar');assert(signal.aborted);finish({body:{code:200,data:[raw(99)]}});await assert.rejects(previous,{code:'CANCELLED'});
  const inactive=f.catalog.discovery({mode:'fm'});await Promise.resolve();f.catalog.inactive();assert(signal.aborted);finish({body:{code:200,data:[raw(99)]}});await assert.rejects(inactive,{code:'CANCELLED'});
 }finally{await f.catalog.dispose();}
});
test('provider responses are bounded to thirty normalized songs',async()=>{
 const f=fixture({personalFM:()=>result({data:Array.from({length:80},(_,i)=>raw(i+1))})});try{assert.equal((await f.catalog.discovery({mode:'fm'})).songs.length,30);}finally{await f.catalog.dispose();}
});
test('transport uses the original official discovery endpoint paths',async()=>{
 const urls=[],client=createNeteaseClient({fetchImpl:async(url,options)=>{urls.push({url,options});return new Response(JSON.stringify({code:200}));}});
 await client.personalFM({});await client.similarSongs('1',{});await client.intelligence('1','2',{});await client.userPlaylists(77,{});
 assert.deepEqual(urls.map(value=>new URL(value.url).pathname),['/weapi/v1/radio/get','/weapi/v1/discovery/simiSong','/eapi/playmode/intelligence/list','/weapi/user/playlist']);
 assert(urls.every(value=>value.options.method==='POST'));
});

test('full card deck preserves daily then private radar order, deduplicates without truncating the returned playlist',async()=>{
 const f=fixture({playlist:(key)=>result({playlist:{id:key,name:'私人雷达',tracks:[raw(4),raw(50),raw(51)]}})});try{
  assert.deepEqual((await f.catalog.home()).cards.map(value=>value.id),['1','2','3','4','5','6']);
  const deck=await f.catalog.deck();assert.deepEqual(deck.cards.map(value=>value.id),['1','2','3','4','5','6','50','51']);assert.equal(deck.dailyCount,6);assert.equal(deck.radarCount,2);assert.equal(deck.message,undefined);
  assert.deepEqual((await f.catalog.deck()).cards,deck.cards);
 }finally{await f.catalog.dispose();}
 const fallback=fixture({dailyPlaylists:()=>result({recommend:[{id:51,name:'普通歌单'}]})});try{const deck=await fallback.catalog.deck();assert.equal(deck.cards.length,6);assert.equal(deck.radarCount,0);assert.match(deck.message,/未返回/);assert(!fallback.calls.some(value=>value.kind==='playlist'));}finally{await fallback.catalog.dispose();}
});
test('daily and combined queues refresh when Beijing date changes without a persistent poll',async()=>{
 let now=Date.UTC(2026,9,30,15,59,59),count=0;const auth={state:'signedOut',cookie:{}};
 const catalog=createCatalog({getAuth:()=>auth,now:()=>now,client:{dailySongs:()=>{count++;return result({data:{dailySongs:[raw(count)]}});},publicPlaylists:()=>result({result:[]})}});
 try{assert.equal((await catalog.deck()).cards[0].id,'1');now+=2000;assert.equal((await catalog.deck()).cards[0].id,'2');assert.equal(count,2);}finally{await catalog.dispose();}
});

test('radar with more than thirty songs hydrates all track IDs in original order and thirty-item batches',async()=>{
 const batches=[],ids=Array.from({length:95},(_,index)=>index+100),f=fixture({
  playlist:key=>result({playlist:{id:key,name:'私人雷达',trackCount:ids.length,trackIds:ids.map(id=>({id})),tracks:ids.slice(0,30).map(raw)}}),
  songs:requested=>{batches.push([...requested]);return result({songs:[...requested].reverse().map(raw)});}
 });try{
  const deck=await f.catalog.deck();assert.deepEqual(deck.cards.map(value=>value.id),['1','2','3','4','5','6',...ids.map(String)]);assert.equal(deck.radarCount,95);assert.deepEqual(batches.map(value=>value.length),[30,30,5]);assert.equal(deck.radarError,undefined);
 }finally{await f.catalog.dispose();}
});
test('a full tracks array is preserved without detail requests or a first-thirty shortcut',async()=>{
 let requested=false;const tracks=Array.from({length:70},(_,index)=>raw(index+100)),f=fixture({playlist:key=>result({playlist:{id:key,trackCount:70,tracks}}),songs:()=>{requested=true;return result({songs:[]});}});
 try{const deck=await f.catalog.deck();assert.equal(deck.radarCount,70);assert.deepEqual(deck.cards.slice(6).map(value=>value.id),tracks.map(value=>String(value.id)));assert.equal(requested,false);}finally{await f.catalog.dispose();}
});
test('oversized or incomplete radar never silently returns a partial sequence as complete',async()=>{
 for(const [playlist,expected]of [
  [{trackCount:501,trackIds:[{id:99}],tracks:[raw(99)]},'RADAR_TOO_LARGE'],
  [{trackCount:3,trackIds:[{id:99}],tracks:[raw(99)]},'RADAR_INCOMPLETE'],
  [{trackCount:2,trackIds:[{id:99},{id:100}],tracks:[raw(99)]},'RADAR_INCOMPLETE']
 ]){const f=fixture({playlist:key=>result({playlist:{id:key,...playlist}}),songs:()=>result({songs:[]})});try{const deck=await f.catalog.deck();assert.equal(deck.radarError,expected);assert.equal(deck.radarCount,0);assert.equal(deck.cards.length,6);assert.match(deck.message,/完整/);}finally{await f.catalog.dispose();}}
});


test('hot playlist recommendations exclude all mode-specific entries and prefer real high play counts',async()=>{const f=fixture({topPlaylists:()=>result({playlists:[{id:51,name:'私人雷达',playCount:999999},{id:52,name:'每日推荐',playCount:999998},...Array.from({length:25},(_,i)=>({id:100+i,name:'高播放精选'+i,playCount:100000+i}))]})});try{const home=await f.catalog.home();assert.equal(home.playlists.length,18);assert(!home.playlists.some(p=>/私人雷达|每日推荐/.test(p.title)));assert.equal(new Set(home.playlists.map(value=>value.id)).size,18);assert(home.playlists.every(value=>value.playCount>=100000));assert.equal(home.radarPlaylist.id,'51');}finally{await f.catalog.dispose();}});

test('similar songs can use the first daily song before anything is playing',async()=>{const f=fixture({signedIn:false});try{const value=await f.catalog.discovery({mode:'similar'});assert.equal(f.calls.find(x=>x.kind==='similar').seed,'1');assert.equal(value.songs[0].id,'40');}finally{await f.catalog.dispose();}});

test('independent mode cover previews do not supersede another mode request',async()=>{let finishFM,signal;const f=fixture({personalFM:options=>{signal=options.signal;return new Promise(resolve=>finishFM=resolve);}});try{const pending=f.catalog.discovery({mode:'fm',preview:true});await Promise.resolve();const similar=await f.catalog.discovery({mode:'similar',seedId:'1',preview:true});assert.equal(similar.songs[0].id,'40');assert.equal(signal.aborted,false);finishFM({body:{code:200,data:[raw(20)]}});assert.equal((await pending).songs[0].id,'20');}finally{await f.catalog.dispose();}});

test('official high-playlist endpoint keeps the original hot ordering parameters',async()=>{const urls=[],client=createNeteaseClient({fetchImpl:async(url,options)=>{urls.push({url,options});return new Response(JSON.stringify({code:200,playlists:[]}));}});await client.topPlaylists({});assert.equal(new URL(urls[0].url).pathname,'/weapi/playlist/list');assert.equal(urls[0].options.method,'POST');});
