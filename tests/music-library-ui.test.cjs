'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create:createQueue}=require('../ui/music/queue.js'),{create:createLibrary}=require('../ui/music/library.js'),{create:createPlayer}=require('../ui/music/player.js');
const settle=async()=>{for(let index=0;index<5;index++)await new Promise(setImmediate);};
const songs=Array.from({length:6},(_,index)=>({id:String(index+1),title:'歌曲'+(index+1),artist:'歌手',duration:180}));
test('sequential and single-repeat distinguish natural ending from manual skip and queue deduplicates',()=>{
  const q=createQueue();q.set([...songs,songs[0]]);assert.equal(q.getItems().length,6);assert.equal(q.choose('6').id,'1');assert.equal(q.choose('6',1,{ended:true}),null);q.setMode('repeat-all');assert.equal(q.choose('6',1,{ended:true}).id,'1');q.setMode('repeat-one');assert.equal(q.choose('2',1,{ended:true}).id,'2');assert.equal(q.choose('2').id,'3');assert.equal(q.choose('2',-1).id,'1');assert.equal(q.setMode('invalid'),false);q.remove('2');assert.equal(q.getItems().length,5);q.clear();assert.equal(q.choose('1'),null);
});
test('shuffle visits remaining songs once before refill and previous uses real played history',()=>{
  const q=createQueue({random:()=>.5});q.set(songs);q.setMode('shuffle');let current='1';const visited=[];for(let i=0;i<5;i++){current=q.choose(current).id;visited.push(current);}assert.equal(new Set(visited).size,5);assert(!visited.includes('1'));const previous=q.choose(current,-1);assert.equal(previous.id,visited[3]);q.remove('4');for(let i=0;i<20;i++)assert.notEqual(q.choose('2').id,'4');
});
function fixture(overrides={}){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test',pretendToBeVisual:true}),view=dom.window,root=view.document.getElementById('root'),calls=[],timers=new Map();let next=0,queue={songs:[...songs],songId:'1'};
  view.setTimeout=(fn,delay)=>{timers.set(++next,{fn,delay});return next;};view.clearTimeout=id=>timers.delete(id);
  const api=async(action,payload)=>{calls.push({action,payload});if(overrides[action])return overrides[action](payload);if(action==='userPlaylists')return {playlists:[{id:'10',title:'我的歌单',trackCount:6,creator:'本人',owned:true},{id:'11',title:'收藏别人的歌单',trackCount:3,creator:'别人',owned:false}],hasMore:false,nextOffset:2};if(action==='playlist')return {playlist:{id:'10',title:'我的歌单'},songs:payload.offset?songs.slice(3):songs.slice(0,3),total:6,nextOffset:payload.offset?6:3,hasMore:!payload.offset};if(action==='playlistAdd')return {added:true,...payload};return {};};
  const library=createLibrary({root,api,getQueue:()=>queue,onPlay:(song,value)=>{queue={songs:value.queue,songId:song.id};},onRemove:id=>{queue.songs=queue.songs.filter(song=>song.id!==id);},onClear:()=>{queue={songs:[],songId:null};}});
  return {dom,view,root,calls,timers,library,queue:()=>queue,flush(){for(const[id,value]of [...timers]){timers.delete(id);value.fn();}},close(){library.dispose();dom.window.close();}};
}
test('edge hover reads only on demand, expands paginated songs and returns without replacing the queue',async()=>{
  const f=fixture();try{assert.equal(f.calls.length,0);f.library.activate();f.root.querySelector('.music-library-edge').dispatchEvent(new f.view.Event('pointerenter'));await settle();assert(f.library.getState().open);assert.equal(f.calls[0].action,'userPlaylists');assert.equal(f.root.querySelectorAll('[data-library-playlist]').length,2);f.root.querySelector('[data-library-playlist="10"]').click();await settle();assert.equal(f.root.querySelectorAll('[data-library-song]').length,3);assert.equal(f.queue().songId,'1');assert(f.library.getState().hasMoreSongs);f.root.querySelector('[data-library-action="more-songs"]').click();await settle();assert.equal(f.calls.at(-1).payload.offset,3);assert.equal(f.root.querySelectorAll('[data-library-song]').length,6);f.root.querySelector('[data-library-action="play"]').click();assert.equal(f.queue().songs.length,6);f.root.querySelector('[data-library-action="back"]').click();assert.equal(f.root.querySelectorAll('[data-library-playlist]').length,2);f.root.querySelector('.music-library').dispatchEvent(new f.view.Event('pointerleave'));assert.equal(f.timers.size,1);f.flush();assert(!f.library.getState().open);}finally{f.close();}
});
test('queue jump/remove/clear work and add-to-playlist lists only owned targets before a clicked mutation',async()=>{
  const f=fixture();try{f.library.activate();f.library.open('queue');f.root.querySelector('[data-library-song="3"]').click();assert.equal(f.queue().songId,'3');f.root.querySelector('[data-library-remove="2"]').click();assert.equal(f.queue().songs.length,5);f.root.querySelector('[data-library-action="clear"]').click();assert.equal(f.queue().songs.length,0);f.library.openAdd(songs[0]);await settle();assert.equal(f.root.querySelectorAll('[data-library-playlist]').length,1);assert.equal(f.calls.filter(value=>value.action==='playlistAdd').length,0);f.root.querySelector('[data-library-playlist="10"]').click();await settle();assert.deepEqual(f.calls.at(-1),{action:'playlistAdd',payload:{playlistId:'10',id:'1',source:'netease'}});assert(!f.library.getState().open);}finally{f.close();}
});
test('closing, login overlay and disposal suppress late private results and release close timers',async()=>{
  let finish;const f=fixture({userPlaylists:()=>new Promise(resolve=>finish=resolve)});try{f.library.activate();f.library.open();f.library.close();finish({playlists:[{id:'10',title:'迟到歌单',owned:true}]});await settle();assert.equal(f.library.getState().playlists,0);f.library.setBlocked(true);f.library.open();assert(!f.library.getState().open);f.library.setBlocked(false);f.library.open('queue');f.root.querySelector('.music-library').dispatchEvent(new f.view.Event('pointerleave'));f.library.deactivate();assert.equal(f.timers.size,0);assert(!f.library.getState().open);f.library.dispose();assert.equal(f.root.querySelector('.music-library'),null);}finally{f.close();}
});
test('player mode buttons stay ordered, repeat on ending, remove playing item safely and clear media',async()=>{
  const dom=new JSDOM('<div id="player"></div>',{url:'https://local.test',pretendToBeVisual:true}),view=dom.window,root=view.document.getElementById('player'),calls=[];
  Object.defineProperty(view.HTMLMediaElement.prototype,'paused',{get(){return this.__paused!==false;}});view.HTMLMediaElement.prototype.pause=function(){this.__paused=true;this.dispatchEvent(new view.Event('pause'));};view.HTMLMediaElement.prototype.load=function(){};view.HTMLMediaElement.prototype.play=function(){this.__paused=false;this.dispatchEvent(new view.Event('playing'));return Promise.resolve();};
  const player=createPlayer({root,api:async(action,payload)=>{calls.push({action,payload});return action==='play'?{audioURL:'pulse-music-audio://song/'+payload.id}:{};}});
  try{player.activate();assert.equal(player.getAudio().crossOrigin,'anonymous');assert.deepEqual([...root.querySelectorAll('.music-transport > button')].map(button=>button.dataset.playerAction),['mode','previous','toggle','next','queue']);await player.play(songs[0],{queue:songs});const mode=root.querySelector('[data-player-action="mode"]'),icons=new Set([mode.innerHTML]);for(const [name,label] of [['repeat-one','单曲循环'],['shuffle','随机播放'],['repeat-all','列表循环'],['sequence','顺序播放']]){mode.click();assert.equal(player.getQueue().mode,name);assert.equal(mode.dataset.mode,name);assert.equal(mode.getAttribute('aria-label'),'播放模式：'+label);assert.equal(mode.title,label);icons.add(mode.innerHTML);}assert.equal(icons.size,4);assert(!mode.hasAttribute('aria-haspopup'));assert.equal(root.querySelector('.music-mode-popover'),null);player.setMode('repeat-one');player.getAudio().dispatchEvent(new view.Event('ended'));await settle();assert.equal(player.getSong().id,'1');player.next();await settle();assert.equal(player.getSong().id,'2');player.removeQueue('2');await settle();assert.equal(player.getSong().id,'3');assert.equal(player.getQueue().songs.length,5);player.clearQueue();await settle();assert.equal(player.getSong(),null);assert.equal(player.getQueue().songs.length,0);assert.equal(player.getAudio().getAttribute('src'),null);assert(calls.some(value=>value.action==='stopAudio'));}finally{player.dispose();dom.window.close();}
});

test('3D shelf keeps card nodes and busy pagination cannot replay songs from a previous playlist',async()=>{
  let finish;const f=fixture({userPlaylists:payload=>payload.offset?new Promise(resolve=>{finish=resolve;}):{playlists:[{id:'10',title:'已播放歌单'},{id:'11',title:'另一个歌单'}],hasMore:true,nextOffset:2}});
  try{
    f.library.activate();f.library.configure({mode:'stage',autoHide:false});f.library.open();await settle();
    f.root.querySelector('[data-stage-action="play"]').click();await settle();
    f.library.open('queue');f.root.querySelector('[data-library-song="3"]').click();
    f.library.open('playlists');const first=f.root.querySelector('[data-stage-index="0"]');
    f.root.querySelector('.music-playlist-stage').dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    assert.equal(typeof finish,'function');assert.equal(f.root.querySelector('[data-stage-index="0"]'),first);
    // Page two is pending, old songs are still present, and another card is
    // selected. Its play action must not reuse the previous playlist's songs.
    const playlistCalls=f.calls.filter(call=>call.action==='playlist').length;
    f.root.querySelector('[data-stage-action="play"]').click();await settle();
    assert.equal(f.queue().songId,'3');assert.equal(playlistCalls,2);assert.equal(f.calls.filter(call=>call.action==='playlist').length,playlistCalls);
    finish({playlists:[],hasMore:false,nextOffset:2});await settle();
  }finally{f.close();}
});
test('3D shelf does not start playback when the selected playlist request fails',async()=>{
  const f=fixture({playlist:async()=>{throw new Error('来源失效');}});
  try{f.library.activate();f.library.configure({mode:'stage',autoHide:false});f.library.open();await settle();
    f.root.querySelector('[data-stage-action="play"]').click();await settle();
    assert.equal(f.queue().songId,'1');assert.match(f.root.textContent,/来源失效/);
    assert.equal(f.root.querySelector('[data-library-action="play"]'),null);
  }finally{f.close();}
});


test('explicit queue and collection stay interactive when the immersive 3D shelf is off or stage',async()=>{
 const f=fixture();try{f.library.activate();f.library.configure({mode:'off',edgeEnabled:false});f.library.open();assert.equal(f.library.getState().open,false);f.library.open('queue');assert.equal(f.library.getState().presentation,'panel');assert(f.library.getState().open);f.library.close();f.library.configure({mode:'stage',edgeEnabled:false});f.library.openAdd(songs[1]);await settle();assert.equal(f.library.getState().adding,true);assert.equal(f.library.getState().presentation,'panel');assert.equal(f.root.querySelector('.music-library-panel').inert,false);f.root.querySelector('[data-library-playlist="10"]').click();await settle();assert.deepEqual(f.calls.at(-1),{action:'playlistAdd',payload:{playlistId:'10',id:'2',source:'netease'}});assert(!f.library.getState().open);}finally{f.close();}
});

test('opening collection invalidates a pending shelf-detail load before a write target is selected',async()=>{
 let finish;const f=fixture({playlist:()=>new Promise(resolve=>finish=resolve)});try{f.library.activate();f.library.open();await settle();f.root.querySelector('[data-library-playlist="10"]').click();assert.equal(f.library.getState().songs,0);f.library.openAdd(songs[0]);await settle();finish({songs:[songs[4]],hasMore:false});await settle();assert.equal(f.library.getState().adding,true);assert.equal(f.library.getState().songs,0);assert.equal(f.root.querySelectorAll('[data-library-playlist]').length,1);f.root.querySelector('[data-library-playlist="10"]').click();await settle();assert.equal(f.calls.at(-1).action,'playlistAdd');}finally{f.close();}
});
