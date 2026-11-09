'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHotPlaylists}=require('../src/music/hot-playlists.cjs');
const {createCatalog,independentPlaylists}=require('../src/music/catalog.cjs');
const raw=id=>({id,name:'热门歌单 '+id,playCount:1000000+id,coverImgUrl:'https://p1.music.126.net/'+id+'.jpg'});
const response=playlists=>({body:{code:200,playlists}});
test('three bounded hot pages create a 150-item metadata pool and fresh visits avoid the previous eighteen',async()=>{
  const calls=[],hot=createHotPlaylists({random:()=>.37,normalize:independentPlaylists,loadPage:async options=>{calls.push(options.offset);return response(Array.from({length:50},(_,i)=>raw(options.offset+i+1)));}});
  const options={signal:new AbortController().signal},first=await hot.select({options,refresh:true}),same=await hot.select({options}),second=await hot.select({options,refresh:true});
  assert.deepEqual(calls,[0,50,100]);assert.equal(hot.getStatus().pool,150);assert.deepEqual(same,first);assert.equal(first.length,18);assert.equal(new Set(second.map(v=>v.id)).size,18);assert(second.every(v=>!first.some(p=>p.id===v.id)));assert(first.every(v=>v.playCount>0));
});
test('short and failed upstream pages retain honest filtered fallback without manufactured play counts',async()=>{
  const hot=createHotPlaylists({random:()=>0,normalize:independentPlaylists,loadPage:async()=>{throw new Error('offline');}});
  const first=await hot.select({fallback:[raw(1),{id:2,name:'私人雷达',playCount:99999999},{id:3,name:'真实歌单'}],refresh:true});assert.equal(first.length,2);assert(first.every(value=>value.id!=='2'));assert.equal(first.find(value=>value.id==='3').playCount,undefined);
});
test('expired metadata reloads only on demand and clear cancels a late pool write',async()=>{
  let now=0,calls=0,finish;const hot=createHotPlaylists({now:()=>now,random:()=>0,normalize:independentPlaylists,loadPage:async()=>{calls++;return response([raw(calls)]);}});
  await hot.select({refresh:true});now=299999;await hot.select({refresh:true});assert.equal(calls,1);now=300001;await hot.select({refresh:true});assert.equal(calls,2);
  const pending=createHotPlaylists({normalize:independentPlaylists,loadPage:()=>new Promise(resolve=>finish=resolve)}),job=pending.select({refresh:true});await Promise.resolve();pending.clear();finish(response([raw(8)]));await assert.rejects(job,{code:'CANCELLED'});assert.equal(pending.getStatus().pool,0);
});
test('catalog daily/deck calls keep this visit stable; only explicit home visits sample another real hot set',async()=>{
  let requests=0;const catalog=createCatalog({random:()=>.31,getAuth:()=>({state:'signedOut',cookie:{}}),client:{dailySongs:async()=>({body:{code:200,data:{dailySongs:[{id:1,name:'首曲',ar:[{name:'歌手'}]}]}}}),publicPlaylists:async()=>({body:{code:200,result:[]}}),topPlaylists:async options=>{requests++;return response(Array.from({length:50},(_,i)=>raw(options.offset+i+1)));}}});
  try{const first=await catalog.home({refreshPlaylists:true});await catalog.deck();const stable=await catalog.home();assert.deepEqual(stable.playlists,first.playlists);const second=await catalog.home({refreshPlaylists:true});assert.equal(requests,3);assert.notDeepEqual(second.playlists,first.playlists);assert.deepEqual(second.songs,first.songs);assert(second.playlists.every(value=>!first.playlists.some(p=>p.id===value.id)));}finally{await catalog.dispose();}
});
test('workspace requests a new sample only on a home visit and removes the redundant caption node',async()=>{
  const {JSDOM}=require('jsdom'),{create}=require('../ui/music/music-workspace.js'),dom=new JSDOM('<form id="search"></form><section id="workspace"></section>',{url:'https://local.test',pretendToBeVisual:true}),document=dom.window.document,calls=[];let homes=0;
  const ui=create({root:document.getElementById('workspace'),searchRoot:document.getElementById('search'),api:async(action,payload={})=>{calls.push({action,payload});if(action==='home'){homes++;return {songs:[{id:'1',title:'真实歌曲'}],playlists:[{id:String(homes),title:'本次歌单'}]};}if(action==='discovery')return {songs:[{id:'1',title:'真实歌曲'}]};return {};}});
  try{await ui.activate();assert.equal(calls.find(value=>value.action==='home').payload.refreshPlaylists,true);assert.equal(document.querySelector('.music-playlist-caption'),null);assert(!document.getElementById('workspace').textContent.includes('根据你的音乐喜好'));const before=document.querySelector('[data-music-playlist]').dataset.musicPlaylist;ui.updateListening({todaySeconds:10});assert.equal(document.querySelector('[data-music-playlist]').dataset.musicPlaylist,before);await ui.refresh();assert.equal(homes,2);assert.notEqual(document.querySelector('[data-music-playlist]').dataset.musicPlaylist,before);}finally{ui.dispose();dom.window.close();}
});
