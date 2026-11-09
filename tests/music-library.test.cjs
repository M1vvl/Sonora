'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPlayerService}=require('../src/music/player-service.cjs');
const {createNeteaseClient}=require('../src/music/netease.cjs');
const raw=id=>({id,name:'Song '+id,dt:100000,ar:[{name:'Artist'}],al:{picUrl:'https://p1.music.126.net/'+id+'.jpg'}});
const result=body=>Promise.resolve({body:{code:200,...body}});
function fixture(overrides={}){
  const auth={state:'signedIn',profile:{userId:77},cookie:{MUSIC_U:'synthetic'}},calls=[];
  const client={
    userPlaylists:(uid,options)=>{calls.push({kind:'library',uid,options});return result({playlist:[{id:8,name:'Owned',trackCount:51,creator:{userId:77,nickname:'Me'}},{id:9,name:'Followed',trackCount:5,creator:{userId:88,nickname:'Other'}},{id:8,name:'Duplicate',creator:{userId:77}}],more:false});},
    playlist:(id,options)=>{calls.push({kind:'playlist',id,options});return result({playlist:{id,name:'Owned',creator:{userId:77},trackCount:51,tracks:Array.from({length:30},(_,i)=>raw(i+1)),trackIds:Array.from({length:51},(_,i)=>({id:i+1}))}});},
    songs:(ids,options)=>{calls.push({kind:'songs',ids,options});return result({songs:ids.map(raw).reverse()});},
    playlistAdd:(pid,id,options)=>{calls.push({kind:'add',pid,id,options});return result({});},...overrides};
  return {auth,calls,client,service:createPlayerService({client,getAuth:()=>auth})};
}
test('account playlists require login, normalize ownership and expose bounded paging without cookies',async()=>{
  const f=fixture();try{
    f.auth.state='signedOut';await assert.rejects(f.service.userPlaylists(),{code:'LOGIN_REQUIRED'});assert.equal(f.calls.length,0);
    f.auth.state='signedIn';const value=await f.service.userPlaylists();assert.equal(value.playlists.length,2);assert.equal(value.playlists[0].owned,true);assert.equal(value.playlists[1].owned,false);assert.equal(value.playlists[0].creator,'Me');assert.equal(value.playlists[0].trackCount,51);assert.equal(value.hasMore,false);assert.equal(value.nextOffset,3);assert(!JSON.stringify(value).includes('synthetic'));
    await f.service.userPlaylists();assert.equal(f.calls.length,1);await f.service.userPlaylists({refresh:true,offset:30,limit:900});assert.equal(f.calls[1].options.limit,30);assert.equal(f.calls[1].options.offset,30);
    f.service.authChanged();await f.service.userPlaylists();assert.equal(f.calls.length,3);
  }finally{await f.service.dispose();}
});
test('playlist track pages hydrate only the requested IDs, preserve source order and terminate at real total',async()=>{
  const f=fixture();try{
    const first=await f.service.playlist({id:8});assert.equal(first.songs.length,30);assert.equal(first.hasMore,true);assert.equal(first.nextOffset,30);assert.equal(first.total,51);assert.equal(f.calls.filter(c=>c.kind==='songs').length,0);
    const second=await f.service.playlist({id:8,offset:30});assert.equal(second.songs.length,21);assert.deepEqual(second.songs.map(s=>s.id),Array.from({length:21},(_,i)=>String(i+31)));assert.equal(second.hasMore,false);assert.equal(second.nextOffset,51);assert.equal(f.calls.find(c=>c.kind==='songs').ids.length,21);
    assert.equal(f.calls.filter(c=>c.kind==='playlist').length,1,'paging reuses only the bounded metadata index');
  }finally{await f.service.dispose();}
});
test('an old account playlist response cannot refill the index cache after login changes',async()=>{
  let finish,count=0;
  const f=fixture({playlist:async id=>{count++;if(count===1)return new Promise(resolve=>finish=resolve);return {body:{code:200,playlist:{id,name:'New account list',tracks:[raw(2)],trackIds:[{id:2}],trackCount:1}}};}});
  try{const pending=f.service.playlist({id:8});f.service.authChanged();finish({body:{code:200,playlist:{id:8,name:'Old private list',tracks:[raw(1)],trackIds:[{id:1}],trackCount:1}}});await assert.rejects(pending,{code:'CANCELLED'});const value=await f.service.playlist({id:8});assert.equal(count,2);assert.equal(value.songs[0].id,'2');assert.equal(value.playlist.title,'New account list');}finally{await f.service.dispose();}
});
test('playlistAdd verifies current ownership immediately before single explicit mutation and coalesces double-clicks',async()=>{
  const f=fixture();try{
    const a=f.service.playlistAdd({playlistId:8,id:4}),b=f.service.playlistAdd({playlistId:8,id:4});assert.deepEqual(await a,{added:true,playlistId:'8',id:'4'});await b;
    assert.equal(f.calls.filter(c=>c.kind==='playlist').length,1);assert.equal(f.calls.filter(c=>c.kind==='add').length,1);assert.equal(f.calls.find(c=>c.kind==='add').options.cookie.MUSIC_U,'synthetic');
    assert.throws(()=>f.service.playlistAdd({playlistId:'http://bad',id:4}),{code:'INVALID_PLAYLIST'});
  }finally{await f.service.dispose();}
});
test('followed targets and failed server writes never claim addition or retry mutation',async()=>{
  const f=fixture({playlist:()=>result({playlist:{id:9,name:'Followed',creator:{userId:88}}})});try{await assert.rejects(f.service.playlistAdd({playlistId:9,id:1}),{code:'PLAYLIST_NOT_OWNED'});assert.equal(f.calls.length,0);}finally{await f.service.dispose();}
  let adds=0;const g=fixture({playlistAdd:()=>{adds++;return Promise.resolve({body:{code:512}});}});try{await assert.rejects(g.service.playlistAdd({playlistId:8,id:1}),{code:'CONTENT_UNAVAILABLE'});assert.equal(adds,1);}finally{await g.service.dispose();}
});
test('leaving the page during ownership lookup prevents later playlist mutation',async()=>{
  let finish,adds=0;const f=fixture({playlist:()=>new Promise(resolve=>finish=resolve),playlistAdd:()=>{adds++;return result({});}});try{
    const pending=f.service.playlistAdd({playlistId:8,id:1});f.service.inactive();finish({body:{code:200,playlist:{id:8,creator:{userId:77}}}});await assert.rejects(pending,{code:'CANCELLED'});assert.equal(adds,0);
  }finally{await f.service.dispose();}
});
test('upstream library operations use original official paths with POST and preserve auth only in transport',async()=>{
  const calls=[],client=createNeteaseClient({fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({code:200}));}});
  await client.userPlaylists(77,{offset:30,limit:20,cookie:{MUSIC_U:'synthetic'}});await client.playlistAdd('8','4',{cookie:{MUSIC_U:'synthetic'}});
  assert.deepEqual(calls.map(c=>new URL(c.url).pathname),['/weapi/user/playlist','/eapi/playlist/manipulate/tracks']);assert(calls.every(c=>c.options.method==='POST'));assert(calls.every(c=>c.options.headers.cookie.includes('MUSIC_U=synthetic')));assert(calls.every(c=>!new URL(c.url).search));
});
