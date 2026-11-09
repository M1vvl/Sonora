'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const loader=require('../ui/music/playlist-loader.js');
const queue=require('../ui/music/queue.js');
const {collectSpotify}=require('../src/music/spotify-collection.cjs');
const {JSDOM}=require('jsdom');
const workspace=require('../ui/music/music-workspace.js');
const library=require('../ui/music/library.js');
const track=i=>({id:String(i+1),title:'Song '+(i+1),artist:'Artist',duration:120});

test('complete playlist loader reads every page in source order beyond 30 and 1000 without fetching audio',async()=>{
  for(const size of [51,1201]){
    const all=Array.from({length:size},(_,i)=>track(i)),calls=[];
    const result=await loader.read({id:'list',request:async(action,{offset,limit})=>{calls.push({action,offset,limit});const songs=all.slice(offset,offset+30);return {songs,total:size,nextOffset:offset+songs.length,hasMore:offset+songs.length<size};}});
    assert.deepEqual(result.songs,all);assert.equal(result.hasMore,false);assert.equal(calls.length,Math.ceil(size/30));assert(calls.every(value=>value.action==='playlist'&&value.limit===50));
    const model=queue.create();model.set(result.songs);assert.equal(model.getItems().length,size);assert.equal(model.choose(all[size-2]).id,all[size-1].id);
  }
});
test('complete playlist loader cancels between pages and refuses repeated cursors or a silent queue overflow',async()=>{
  let active=true,calls=0;
  await assert.rejects(loader.read({id:'x',current:()=>active,request:async()=>{calls++;active=false;return {songs:[track(0)],hasMore:true,nextOffset:1};}}),{code:'CANCELLED'});assert.equal(calls,1);
  await assert.rejects(loader.read({id:'x',request:async()=>({songs:[track(0)],hasMore:true,nextOffset:0})}),/中断/);
  await assert.rejects(loader.read({id:'x',request:async()=>({songs:[track(0)],total:10001,hasMore:true,nextOffset:1})}),/10000/);
});
test('the recommended playlist button directly plays the complete 61-track queue while creating only bounded song rows',async()=>{
  const dom=new JSDOM('<div id="root"></div><form id="search"></form>',{url:'https://local.test',pretendToBeVisual:true}),root=dom.window.document.querySelector('#root');
  const all=Array.from({length:61},(_,i)=>track(i));let played=null,calls=0;
  const ui=workspace.create({root,searchRoot:dom.window.document.querySelector('#search'),onPlay:(song,options)=>{played={song,...options};},api:async(action,payload)=>{
    if(action==='home')return {songs:[],playlists:[{id:'8',title:'Whole playlist'}],discoveryModes:[]};
    if(action==='playlist'){calls++;const songs=all.slice(payload.offset,payload.offset+30);return {playlist:{title:'Whole playlist'},songs,total:61,nextOffset:payload.offset+songs.length,hasMore:payload.offset+songs.length<61};}return {};
  }});
  try{await ui.activate();root.querySelector('[data-music-playlist="8"]').click();for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);assert.equal(played.queue.length,61);assert.equal(played.song.id,'1');assert.equal(ui.getState().songs,61);}finally{ui.dispose();dom.window.close();}
});
test('playing a sidebar or 3D shelf playlist also pages the whole list instead of its displayed first page',async()=>{
  for(const mode of ['sidebar','stage']){
    const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test',pretendToBeVisual:true}),root=dom.window.document.querySelector('#root');
    const all=Array.from({length:61},(_,i)=>track(i));let played;
    const ui=library.create({root,onPlay:(song,options)=>{played={song,...options};},api:async(action,payload)=>{
      if(action==='userPlaylists')return {playlists:[{id:'8',title:'Whole'}]};
      if(action==='playlist'){const songs=all.slice(payload.offset,payload.offset+30);return {songs,total:61,nextOffset:payload.offset+songs.length,hasMore:payload.offset+songs.length<61};}return {};
    }});
    const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
    try{ui.activate();ui.configure({mode,autoHide:false});ui.open();await settle();
      if(mode==='stage')root.querySelector('[data-stage-action="play"]').click();
      else{root.querySelector('[data-library-playlist="8"]').click();await settle();root.querySelector('[data-library-action="play"]').click();}
      await settle();assert.equal(played.queue.length,61);assert.equal(played.queue.at(-1).id,'61');
    }finally{ui.dispose();dom.window.close();}
  }
});
test('Spotify full playlist collection passes the old 16-scroll and 500-track limits and verifies the real bottom',async()=>{
  let at=600;const all=Array.from({length:620},(_,i)=>({id:'spotify:'+i}));
  const page=()=>({songs:all.slice(at,at+20),playlists:[]});
  const value=await collectSpotify({navigate:async()=>page(),read:async()=>page(),reset:async()=>{at=0;},wait:async()=>{},scroll:async()=>{at=Math.min(600,at+20);return {atBottom:at===600};}},'/playlist/test',{complete:true});
  assert.equal(value.songs.length,620);assert.equal(value.collectionComplete,true);assert.equal(value.songs.at(-1).id,'spotify:619');
});
test('Spotify cannot report a virtualized list as complete when the page stalls before its bottom',async()=>{
  let checks=0;
  await assert.rejects(collectSpotify({navigate:async()=>({songs:[track(0)]}),read:async()=>({songs:[track(0)]}),wait:async()=>{},scroll:async()=>({atBottom:false}),check:()=>{if(++checks>12)throw new Error('cancelled');}},'/playlist/test',{complete:true}),/cancelled/);
});
