'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create:createPlayer}=require('../ui/music/player.js'),{create:createTransport}=require('../ui/music/immersive-transport.js'),{create:createLibrary}=require('../ui/music/library.js');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
const songs=[{id:'1',title:'歌曲一',artist:'歌手',duration:180},{id:'2',title:'歌曲二',artist:'歌手',duration:200}];
function base({onAddPlaylist=()=>{},override}={}){
  const dom=new JSDOM('<main class="app-shell"><section id="music"><div id="account"><button>账号</button></div><div id="player"></div></section></main>',{url:'https://local.test',pretendToBeVisual:true}),view=dom.window,root=view.document.getElementById('music'),calls=[];
  view.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  Object.defineProperty(view.HTMLMediaElement.prototype,'paused',{get(){return this.__paused!==false;}});
  view.HTMLMediaElement.prototype.pause=function(){this.__paused=true;this.dispatchEvent(new view.Event('pause'));};view.HTMLMediaElement.prototype.load=function(){};
  view.HTMLMediaElement.prototype.play=function(){this.__paused=false;this.dispatchEvent(new view.Event('playing'));return Promise.resolve();};
  const api=async(action,payload)=>{calls.push({action,payload});if(override){const value=await override(action,payload);if(value!==undefined)return value;}if(action==='play')return {audioURL:'pulse-music-audio://song/'+payload.id};if(action==='like')return {liked:payload.liked};if(action==='userPlaylists')return {playlists:[{id:'10',title:'歌单',owned:true}]};if(action==='playlistAdd')return {added:true};return {};};
  const player=createPlayer({root:root.querySelector('#player'),api,onAddPlaylist});player.activate();
  return {dom,view,root,calls,api,player,close(){player.dispose();dom.window.close();}};
}
test('MineRadio transport reuses one audio, keeps delegated controls functional and restores exact node locations',async()=>{
  const f=base(),selectors=['.music-now-playing','.music-like','[data-player-action="add-playlist"]','.music-transport','.music-seek','.music-volume-label'];
  const locations=selectors.map(selector=>{const node=f.root.querySelector(selector);return {node,parent:node.parentNode,before:node.previousSibling,after:node.nextSibling};});
  const events=[],transport=createTransport({player:f.player,onLyrics:()=>events.push('lyrics'),onReset:()=>events.push('reset'),onFullscreen:()=>events.push('fullscreen')});
  try{f.player.restorePlayback({song:songs[0],queue:songs,position:16,volume:.4});transport.activate();transport.activate();assert.equal(transport.getState().portals,10);assert.equal(f.root.querySelectorAll('audio').length,1);assert.equal(f.root.querySelector('.music-stage-clock').textContent,'0:16 / 3:00');
    const mode=f.root.querySelector('[data-player-action="mode"]');assert.equal(f.root.querySelectorAll('.music-playback-mode').length,1);assert.equal(f.root.querySelectorAll('.music-stage-playback button').length,1);assert.equal(f.root.querySelector('.music-stage-playback button').dataset.playerAction,'toggle');assert.deepEqual([...f.root.querySelectorAll('.music-stage-primary button')].map(node=>node.dataset.playerAction),['like','add-playlist','mode','previous']);assert.deepEqual([...f.root.querySelectorAll('.music-stage-secondary button')].map(node=>node.dataset.playerAction),['next','queue']);mode.click();mode.click();assert.equal(f.player.getQueue().mode,'shuffle');assert.equal(mode.dataset.mode,'shuffle');assert.equal(f.root.querySelector('[aria-label="视觉设置"]'),null);
    f.root.querySelector('[data-player-action="like"]').click();await settle();assert.equal(f.player.getSong().liked,true);
    f.root.querySelector('[data-player-action="mute"]').click();assert.equal(f.player.getAudio().muted,true);
    f.root.querySelector('[data-player-action="next"]').click();await settle();assert.equal(f.player.getSong().id,'2');
    for(const label of ['显示或隐藏歌词','重置舞台镜头','切换全屏'])f.root.querySelector(`[aria-label="${label}"]`).click();assert.deepEqual(events,['lyrics','reset','fullscreen']);
    transport.deactivate();assert.equal(transport.getState().portals,0);assert.equal(f.root.querySelector('.music-stage-transport'),null);
    for(const {node,parent,before,after}of locations){assert.equal(node.parentNode,parent);assert.equal(node.previousSibling,before);assert.equal(node.nextSibling,after);}
    transport.activate();assert.equal(f.root.querySelectorAll('.music-stage-transport').length,1);assert.equal(f.root.querySelectorAll('audio').length,1);transport.dispose();assert(!f.player.getRoot().classList.contains('uses-stage-transport'));
  }finally{transport.dispose();f.close();}
});

// Keep UI integration isolated from GPU/native media and production credentials.
// The real renderer is tested by the root task's Electron check; these spies
// make controller ordering and late Promise results deterministic.
function controllerFactory(){
  const paths=['visual-renderer'].map(name=>require.resolve('../ui/music/'+name+'.js'));
  for(const path of paths)require(path);const original=paths.map(path=>require.cache[path].exports),visuals=[];
  require.cache[paths[0]].exports={create(){const state={active:false,yaw:0,pitch:0,disposed:false};visuals.push(state);return {activate(){state.active=true;},deactivate(){state.active=false;},update(){},setCover(){state.coverCalls=(state.coverCalls||0)+1;},setPointer(){},setOrbit(yaw,pitch){state.yaw=yaw;state.pitch=pitch;},resetOrbit(){state.yaw=state.pitch=0;},getState:()=>state,dispose(){state.active=false;state.disposed=true;}};}};
  const path=require.resolve('../ui/music/immersive.js');delete require.cache[path];const result=require(path);
  paths.forEach((path,index)=>{require.cache[path].exports=original[index];});delete require.cache[path];return {...result,visuals};
}
const controllerModule=controllerFactory();
function immersiveFixture({settingsRequest}={}){
  const f=base(),motions=[];f.view.HTMLElement.prototype.animate=function(){let resolve,reject;const finished=new Promise((yes,no)=>{resolve=yes;reject=no;});const value={finished,finish:resolve,cancel(){value.canceled=true;reject(new Error('canceled'));},canceled:false};motions.push(value);return value;};
  let lateFullscreen;f.view.pulse={windowAction:action=>{f.calls.push({action:'window:'+action});return action==='fullscreen'?new Promise(resolve=>lateFullscreen=resolve):Promise.resolve({fullscreen:false});}};
  let lyricsActive=false,obscured=false;const lyrics={createView:()=>({activate(){lyricsActive=true;},deactivate(){lyricsActive=false;},updateSettings(){},getState:()=>({active:lyricsActive}),dispose(){lyricsActive=false;}}),subscribe:()=>()=>{},setObscured(value){obscured=value;},getState:()=>({}),getLines:()=>[]};
  const library=createLibrary({root:f.root,api:f.api}),account=f.root.querySelector('#account'),playerRoot=f.player.getRoot(),libraryRoot=library.getRoot();library.activate();
  const immersive=controllerModule.create({root:f.root,player:f.player,lyrics,api:async(action,payload)=>action==='visualSettings'?(settingsRequest?settingsRequest(payload):{settings:{}}):f.api(action,payload),accountRoot:account,library});immersive.activate();
  return {...f,immersive,library,account,playerRoot,libraryRoot,motions,finishFullscreen:value=>lateFullscreen(value),obscured:()=>obscured,lyricsActive:()=>lyricsActive,close(){immersive.dispose();library.dispose();f.close();}};
}
function pointer(f,type,x,y,target){const event=new f.view.Event(type,{bubbles:true,cancelable:true});for(const[key,value]of Object.entries({button:0,pointerId:1,clientX:x,clientY:y}))Object.defineProperty(event,key,{value});(target||f.view.document.querySelector('.music-visual-canvas')).dispatchEvent(event);}

test('visual changes only preview until Save; closing and disposal never commit an unsaved draft',async()=>{
  const writes=[],f=immersiveFixture({settingsRequest:payload=>{
    if(payload?.settings)writes.push(payload.settings);
    return {settings:payload?.settings||{preset:'cover'}};
  }});
  try{
    await f.immersive.open();await settle();
    const host=f.view.document.querySelector('.music-immersive'),status=host.querySelector('.music-visual-save-status');
    assert.equal(status.textContent,'');
    host.querySelector('.music-immersive-diy').click();host.querySelector('.music-visual-trigger').click();
    host.querySelector('[data-visual-preset="topography"]').click();
    assert.equal(f.immersive.getState().settings.preset,'topography');assert.equal(status.textContent,'待保存');
    await new Promise(resolve=>setTimeout(resolve,260));
    assert.equal(writes.length,0,'preview must not schedule an automatic write');
    await f.immersive.close({immediate:true});await settle();
    assert.equal(writes.length,0);assert.equal(status.textContent,'');
    await f.immersive.open();await settle();
    assert.equal(f.immersive.getState().settings.preset,'cover','unsaved presentation is discarded on page exit');
    host.querySelector('.music-visual-trigger').click();host.querySelector('[data-visual-preset="topography"]').click();
    f.immersive.dispose();await settle();assert.equal(writes.length,0);
  }finally{f.close();}
});

test('Saved feedback follows a real explicit write, expires, and preserves edits made while saving',async()=>{
  const writes=[];let finish;
  const f=immersiveFixture({settingsRequest:payload=>{
    if(!payload?.settings)return {settings:{}};
    writes.push(payload.settings);return new Promise(resolve=>finish=()=>resolve({settings:payload.settings}));
  }});
  try{
    await f.immersive.open();await settle();
    const timers=new Map();let id=0;
    f.view.setTimeout=(fn,delay)=>{timers.set(++id,{fn,delay});return id;};f.view.clearTimeout=id=>timers.delete(id);
    const host=f.view.document.querySelector('.music-immersive'),status=host.querySelector('.music-visual-save-status'),save=host.querySelector('[data-visual-action="save"]');
    host.querySelector('.music-immersive-diy').click();host.querySelector('.music-visual-trigger').click();
    host.querySelector('[data-visual-preset="topography"]').click();save.click();await settle();
    assert.equal(writes.length,1);assert.equal(status.textContent,'保存中…');assert(save.disabled);
    host.querySelector('[data-visual-preset="cover"]').click();finish();await settle();
    assert.equal(status.textContent,'待保存');assert(f.immersive.getState().dirty);
    save.click();await settle();finish();await settle();
    assert.equal(writes.length,2);assert.equal(status.textContent,'已保存');assert(!save.disabled);
    const feedback=[...timers.values()].find(timer=>timer.delay===2200);assert(feedback);feedback.fn();
    assert.equal(status.textContent,'');assert.equal(f.immersive.getState().dirty,false);
  }finally{f.close();}
});

test('failed explicit save remains retryable and memory preferences also wait for Save',async()=>{
  let attempts=0;
  const f=immersiveFixture({settingsRequest:payload=>{
    if(!payload?.settings)return {settings:{}};
    return ++attempts===1?{error:'write failed'}:{settings:payload.settings};
  }});
  try{
    await f.immersive.open();await settle();const host=f.view.document.querySelector('.music-immersive');
    host.querySelector('.music-immersive-diy').click();host.querySelector('.music-visual-trigger').click();
    host.querySelector('[data-visual-preset="topography"]').click();host.querySelector('[data-visual-action="save"]').click();await settle();
    assert.equal(host.querySelector('.music-visual-save-status').textContent,'保存失败');assert(f.immersive.getState().dirty);
    host.querySelector('[data-visual-action="save"]').click();await settle();
    assert.equal(host.querySelector('.music-visual-save-status').textContent,'已保存');
    host.querySelector('[data-visual-tab="system"]').click();await settle();
    const check=host.querySelector('[data-memory-key="autoTrim"]');check.checked=true;check.dispatchEvent(new f.view.Event('input',{bubbles:true}));await settle();
    assert.equal(f.calls.filter(value=>value.action==='memoryPreferences').length,0);
    host.querySelector('[data-visual-action="save"]').click();await settle();
    assert.equal(f.calls.filter(value=>value.action==='memoryPreferences').length,1);
    assert.equal(f.calls.find(value=>value.action==='memoryPreferences').payload.preferences.autoTrim,true);
  }finally{f.close();}
});

test('original Sonic applies immediately and persists only through the Save control',async()=>{
  const writes=[],f=immersiveFixture({settingsRequest:payload=>{
    if(payload?.settings)writes.push(payload.settings);
    return {settings:payload?.settings||{preset:'topography'}};
  }});
  try{
    await f.immersive.open();await settle();
    const host=f.view.document.querySelector('.music-immersive');
    assert.equal(f.immersive.getState().settings.preset,'topography');
    host.querySelector('.music-immersive-diy').click();host.querySelector('.music-visual-trigger').click();
    assert.equal(host.querySelector('[data-visual-preset="topography"]').getAttribute('aria-pressed'),'true');
    host.querySelector('[data-visual-preset="cover"]').click();
    assert.equal(f.immersive.getState().settings.preset,'cover');
    host.querySelector('[data-visual-preset="topography"]').click();
    assert.equal(f.immersive.getState().settings.preset,'topography');
    assert.equal(f.immersive.getState().settings.lyricMode,'immersive');
    host.querySelector('[data-visual-action="save"]').click();await settle();
    assert.equal(writes.at(-1).preset,'topography');
  }finally{f.close();}
});
test('visual preset heading switch saves its state without changing lyric settings',async()=>{
  const writes=[],f=immersiveFixture({settingsRequest:payload=>{
    if(payload?.settings)writes.push(payload.settings);
    return {settings:payload?.settings||{}};
  }});
  try{
    await f.immersive.open();await settle();
    const host=f.view.document.querySelector('.music-immersive');
    host.querySelector('.music-immersive-diy').click();
    host.querySelector('.music-visual-trigger').click();
    const toggle=host.querySelector('[data-visual-key="visualEnabled"]');
    assert.equal(toggle.checked,true);
    toggle.checked=false;
    toggle.dispatchEvent(new f.view.Event('input',{bubbles:true}));
    host.querySelector('[data-visual-action="save"]').click();await settle();
    assert.equal(f.immersive.getState().settings.visualEnabled,false);
    assert.equal(f.immersive.getState().settings.lyricMode,'immersive');
    assert.equal(writes.at(-1).visualEnabled,false);
    assert.equal(f.lyricsActive(),true);
  }finally{f.close();}
});
test('lyric pickers opt into their native custom channel and persist the real twenty-point settings',async()=>{
  const writes=[],f=immersiveFixture({settingsRequest:payload=>{if(payload?.settings)writes.push(payload.settings);return {settings:payload?.settings||{fontSize:27,sourceSchemaVersion:1}};}});
  try{await f.immersive.open();await settle();const host=f.view.document.querySelector('.music-immersive');host.querySelector('.music-immersive-diy').click();host.querySelector('.music-visual-trigger').click();host.querySelector('[data-visual-tab="lyrics"]').click();
    for(const[key,value]of [['lyricColor','#ea2020'],['lyricHighlightColor','#2070ea'],['lyricGlowColor','#16db82']]){const picker=host.querySelector(`[data-visual-key="${key}"]`);picker.value=value;picker.dispatchEvent(new f.view.Event('input',{bubbles:true}));}
    const settings=f.immersive.getState().settings;assert.equal(settings.fontSize,20);assert.equal(settings.lyricColorMode,'custom');assert.equal(settings.lyricHighlightMode,'custom');assert.equal(settings.lyricGlowLinked,false);assert.equal(host.querySelector('[data-visual-key="lyricColorMode"]').value,'custom');assert.equal(host.querySelector('[data-visual-key="lyricHighlightMode"]').value,'custom');assert.equal(host.querySelector('[data-visual-key="lyricGlowLinked"]').checked,false);
    const lines=host.querySelector('.music-immersive-lyrics');assert.equal(lines.style.getPropertyValue('--lyric-user-base'),'#ea2020');assert.equal(lines.style.getPropertyValue('--lyric-user-highlight'),'#2070ea');
    host.querySelector('[data-visual-action="save"]').click();await settle();assert.equal(writes.at(-1).lyricColor,'#ea2020');assert.equal(writes.at(-1).sourceSchemaVersion,2);
  }finally{f.close();}
});
test('immersive immediate navigation interrupts an in-flight close and returns portals/edge without waiting for animation',async()=>{
  const f=immersiveFixture();try{await f.immersive.open();await settle();const host=f.view.document.querySelector('.music-immersive');assert(host.contains(f.account));assert(host.contains(f.playerRoot));assert(f.obscured());assert.equal(f.library.getState().edgeEnabled,false);
    host.dispatchEvent(new f.view.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await settle();assert(f.library.getState().open);host.dispatchEvent(new f.view.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));assert(!f.library.getState().open);
    const closing=f.immersive.close();assert(!f.immersive.getState().open);assert(!host.hidden);f.immersive.deactivate();await closing;
    assert(host.hidden);assert.equal(f.account.parentNode,f.root);assert.equal(f.playerRoot.parentNode,f.root);assert.equal(f.libraryRoot.parentNode,f.root);assert.equal(f.root.inert,false);assert(!f.root.closest('.app-shell').hasAttribute('inert'));assert.equal(f.library.getState().edgeEnabled,true);assert(!f.obscured());assert(f.motions.at(-1).canceled);assert.equal(f.root.querySelector('.music-stage-transport'),null);
  }finally{f.close();}
});
test('auth blocks stage/orbit, closing restores interactions, and a late fullscreen reply cannot leak past exit',async()=>{
  const f=immersiveFixture();try{await f.immersive.open();await settle();const host=f.view.document.querySelector('.music-immersive');
    pointer(f,'pointerdown',0,0);pointer(f,'pointermove',2000,0);pointer(f,'pointerup',2000,0);assert(Math.abs(f.immersive.getState().orbit.yaw)>Math.PI*2);
    const yaw=f.immersive.getState().orbit.yaw;pointer(f,'pointerdown',0,0,host.querySelector('[data-player-action="next"]'));pointer(f,'pointermove',1000,0);pointer(f,'pointerup',1000,0);assert.equal(f.immersive.getState().orbit.yaw,yaw);
    f.immersive.setAccountOpen(true);assert.equal(f.immersive.getState().visual.active,false);assert.equal(f.lyricsActive(),false);assert.notEqual(f.account.inert,true);pointer(f,'pointerdown',0,0);pointer(f,'pointermove',1000,0);assert.equal(f.immersive.getState().orbit.yaw,yaw);host.dispatchEvent(new f.view.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));assert(!f.library.getState().open);
    f.immersive.setAccountOpen(false);assert(f.immersive.getState().visual.active);assert(f.lyricsActive());assert.equal(f.libraryRoot.inert,false);
    host.querySelector('.music-immersive-diy').click();host.querySelector('.music-visual-trigger').click();assert.equal(host.querySelector('.music-immersive-diy').getAttribute('aria-pressed'),'true');assert(f.immersive.getState().settingsPanel);
    host.querySelector('[aria-label="切换全屏"]').click();await f.immersive.close({immediate:true});f.finishFullscreen({fullscreen:true});await settle();assert(f.calls.some(call=>call.action==='window:exit-fullscreen'));assert.equal(f.immersive.getState().open,false);
  }finally{f.close();}
});

test('late saved settings after page exit do not restart cover/background work',async()=>{
  let finish;const f=immersiveFixture({settingsRequest:()=>new Promise(resolve=>finish=resolve)});
  try{f.player.restorePlayback({song:{...songs[0],coverURL:'https://example.test/cover.jpg'},queue:songs});await f.immersive.open();
    const before=f.immersive.getState().visual.coverCalls;await f.immersive.close({immediate:true});finish({settings:{coverResolution:128,backgroundMode:'cover'}});await settle();
    assert.equal(f.immersive.getState().open,false);assert.equal(f.immersive.getState().visual.active,false);assert.equal(f.immersive.getState().visual.coverCalls,before);
  }finally{f.close();}
});


test('immersive portaled heart and collect use the single player account actions and clickable write panel',async()=>{
 let library;const f=base({onAddPlaylist:song=>library.openAdd(song)}),style=f.view.document.createElement('style');style.textContent=['library.css','playlist-stage.css'].map(name=>require('node:fs').readFileSync(require('node:path').join(__dirname,'../ui/music',name),'utf8')).join('\n');f.view.document.head.append(style);const host=f.view.document.createElement('section');host.className='music-immersive';f.view.document.body.append(host);library=createLibrary({root:f.root,api:f.api});library.activate();library.configure({mode:'stage',edgeEnabled:false});const transport=createTransport({player:f.player});
 try{f.player.restorePlayback({song:{...songs[0],liked:false},queue:songs.map(song=>({...song,liked:false})),position:17,mode:'repeat-all'});host.append(f.player.getRoot(),library.getRoot());f.root.inert=true;transport.activate();const heart=host.querySelector('[data-player-action="like"]');assert(!heart.closest('[inert]'));heart.click();await settle();assert.equal(f.player.getSong().liked,true);assert.equal(heart.getAttribute('aria-pressed'),'true');assert.deepEqual(f.calls.find(call=>call.action==='like'),{action:'like',payload:{id:'1',source:'netease',liked:true}});host.querySelector('[data-player-action="add-playlist"]').click();await settle();assert.equal(library.getState().presentation,'panel');assert.equal(library.getState().adding,true);assert.equal(host.querySelector('.music-library-panel').inert,false);assert.equal(f.view.getComputedStyle(host.querySelector('.music-library-panel')).pointerEvents,'auto');assert.equal(f.view.getComputedStyle(host.querySelector('.music-library-content')).pointerEvents,'auto');assert.notEqual(f.view.getComputedStyle(host.querySelector('.music-library-header')).display,'none');host.querySelector('[data-library-playlist="10"]').click();await settle();assert.deepEqual(f.calls.find(call=>call.action==='playlistAdd'),{action:'playlistAdd',payload:{playlistId:'10',id:'1',source:'netease'}});assert.equal(library.getState().open,false);assert.equal(f.player.getState().position,17);assert.equal(f.player.getState().mode,'repeat-all');assert.equal(f.view.document.querySelectorAll('audio').length,1);assert(!f.calls.some(call=>call.action==='play'));}finally{transport.dispose();library.dispose();f.close();}
});


test('collection failures are announced in the active immersive surface instead of its inert primary parent',()=>{
 const f=base(),feedback=require('../ui/music/feedback.js').create({root:f.root}),host=f.view.document.createElement('section');host.className='music-immersive';f.view.document.body.append(host);
 try{f.root.inert=true;feedback.setRoot(host);feedback.show('登录状态已失效，请重新登录');const notice=host.querySelector('.music-feedback');assert(notice);assert.equal(notice.hidden,false);assert.equal(notice.parentNode,host);assert(!f.root.contains(notice));assert.equal(notice.getAttribute('role'),'status');feedback.setRoot(f.root);assert(f.root.contains(notice));feedback.clear();assert(notice.hidden);}finally{feedback.dispose();f.close();}
});


test('fullscreen uses only Escape and the transport toggle without a corner exit button',async()=>{
 const f=immersiveFixture();try{await f.immersive.open();await settle();const host=f.view.document.querySelector('.music-immersive');host.querySelector('[aria-label="切换全屏"]').click();f.finishFullscreen({fullscreen:true});await settle();
 assert.equal(host.querySelector('.music-immersive-exit-fullscreen'),null);assert.equal(host.querySelector('[aria-label="退出全屏（Esc）"]').getAttribute('aria-pressed'),'true');
 const focus=host.querySelector('[data-track-menu="source"]');focus.focus();const key=new f.view.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});focus.dispatchEvent(key);await settle();assert.equal(key.defaultPrevented,true);assert(f.calls.some(row=>row.action==='window:exit-fullscreen'));assert.equal(host.querySelector('.music-immersive-exit-fullscreen'),null);assert.equal(f.immersive.getState().open,true);
 host.querySelector('[aria-label="切换全屏"]').click();f.finishFullscreen({fullscreen:true});await settle();host.querySelector('[aria-label="退出全屏（Esc）"]').click();await settle();assert.equal(host.querySelector('.music-immersive-exit-fullscreen'),null);assert.equal(f.immersive.getState().open,true);
 }finally{f.close();}
});
