'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const model=require('../ui/anime-player/player-settings.js');
const {create}=require('../ui/anime-player/player.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const nativeState={playbackId:'playing-1',engine:'native',phase:'ready',subject:{title:'中文番剧 <script>bad</script>'},episode:{name:'第1集'},ruleName:'测试来源',episodeIndex:0,episodes:[{index:0,name:'第1集'},{index:1,name:'第2集'}],settings:{...model.DEFAULTS},video:{position:10,duration:120,paused:false,volume:100,mute:false,speed:1,videoWidth:1920,videoHeight:1080},capabilities:{superResolution:true,pictureAdjustments:true}};
function fixture(state=nativeState,configureView){
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../ui/anime-player/player.html'),'utf8'),{url:'https://local.test/player.html',pretendToBeVisual:true});
  const {document}=dom.window,calls=[];let stateListener,frameListener,pointerListener,unsubscribed=0,loads=0,plays=0,pauses=0;
  const video=document.getElementById('video');
  Object.defineProperties(video,{currentTime:{value:0,writable:true,configurable:true},duration:{value:120,writable:true,configurable:true},paused:{value:true,writable:true,configurable:true},videoWidth:{value:1920,configurable:true},videoHeight:{value:1080,configurable:true}});
  video.play=()=>{plays++;video.paused=false;return Promise.resolve();};video.pause=()=>{pauses++;video.paused=true;};video.load=()=>{loads++;};
  document.getElementById('video-stage').getBoundingClientRect=()=>({x:0,y:56,width:document.getElementById('player-panel').hidden?1000:720,height:544});
  const bridge={get:async()=>state,action:async(name,value)=>{calls.push({name,value});return {ok:true};},onState:listener=>{stateListener=listener;return()=>{stateListener=null;unsubscribed++;};},onFrame:listener=>{frameListener=listener;return()=>{frameListener=null;unsubscribed++;};},onPointer:listener=>{pointerListener=listener;return()=>{pointerListener=null;unsubscribed++;};}};
  configureView?.(dom.window);
  const controller=create({document,bridge});
  return {dom,document,video,calls,controller,state:value=>stateListener(value),frame:value=>frameListener(value),pointer:value=>pointerListener(value),stats:()=>({loads,plays,pauses,unsubscribed}),close(){controller.dispose();dom.window.close();}};
}
test('player settings preserve real modes, sanitize numeric ranges, and default best enhancement and 4K target',()=>{
  assert.equal(model.DEFAULTS.superResolution,'quality');assert.equal(model.DEFAULTS.outputResolution,'2160p');assert.equal(model.DEFAULTS.aspect,'contain');
  const value=model.normalize({superResolution:'fake',aspect:'arbitrary-css',speed:20,volume:-3,brightness:1000,gamma:NaN,mute:'yes'});
  assert.deepEqual(value,{...model.DEFAULTS,speed:3,volume:0,brightness:100});
  assert.deepEqual(model.SPEEDS,[.25,.5,.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3]);assert.equal(model.normalize({speed:.1}).speed,.25);assert.equal(model.normalize({aspect:'fill'}).aspect,'fill');
  assert.equal(model.time(65.9),'01:05');assert.equal(model.time(3601),'1:00:01');assert.equal(model.time(Infinity),'00:00');
});
test('native frame updates never recreate video or reload media and titles are text only',async()=>{
  const f=fixture();try{await tick();const loads=f.stats().loads,video=f.video;for(let i=0;i<20;i++)f.frame({position:10+i,duration:120,paused:i%2===0,videoWidth:1920,videoHeight:1080});assert.equal(f.document.getElementById('video'),video);assert.equal(f.stats().loads,loads);assert.equal(f.stats().plays,0);assert.equal(f.document.getElementById('current-time').textContent,'00:29');assert.equal(f.document.getElementById('video-resolution'),null);assert.equal(f.document.getElementById('screenshot'),null);assert.equal(f.document.querySelector('.playback-status'),null);assert.match(f.document.getElementById('play-title').textContent,/<script>bad/);assert.equal(f.document.querySelector('#play-title script'),null);assert.equal(f.calls.some(call=>call.name==='progress'),false);assert.equal(f.calls.some(call=>call.name==='control'),false);}finally{f.close();}
});
test('super resolution and picture controls reach the native boundary and panels shrink the viewport',async()=>{
  const f=fixture();try{await tick();f.document.getElementById('sr-toggle').click();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(f.document.getElementById('player-panel').hidden,false);assert(f.calls.some(call=>call.name==='viewport'&&call.value.width===720&&call.value.y===56));f.document.querySelector('[data-sr="quality"]').click();await tick();assert(f.calls.some(call=>call.name==='control'&&call.value.type==='superResolution'&&call.value.value==='quality'));assert.equal(f.controller.getState().settings.superResolution,'quality');const brightness=f.document.querySelector('[data-picture="brightness"]');brightness.value='20';brightness.dispatchEvent(new f.dom.window.Event('change'));await tick();assert(f.calls.some(call=>call.name==='control'&&call.value.type==='brightness'&&call.value.value===20));f.document.getElementById('panel-close').click();assert.equal(f.document.getElementById('player-panel').hidden,true);assert.equal(f.document.querySelector('[id*="pip"]'),null);}finally{f.close();}
});
test('seek drag stays stable across live frames, and next episode/back send explicit actions',async()=>{
  const f=fixture();try{await tick();const seek=f.document.getElementById('seek');seek.value='80';seek.dispatchEvent(new f.dom.window.Event('input'));f.frame({position:12,duration:120});assert.equal(seek.value,'80');assert.equal(f.document.getElementById('current-time').textContent,'01:20');seek.dispatchEvent(new f.dom.window.Event('change'));await tick();assert(f.calls.some(call=>call.name==='control'&&call.value.type==='seek'&&call.value.value===80));f.document.getElementById('next-episode').click();f.document.getElementById('close').click();await tick();assert(f.calls.some(call=>call.name==='control'&&call.value.type==='episode'&&call.value.value===1));assert(f.calls.some(call=>call.name==='close'));}finally{f.close();}
});
test('HTML5 fallback retains playback controls without claiming native super resolution',async()=>{
  const f=fixture({...nativeState,engine:'html5',media:{url:'https://media.test/a.mp4',format:'video'},video:null});try{await tick();assert.equal(f.stats().plays,1);assert.equal(f.document.querySelector('[data-sr="quality"]').disabled,true);await f.controller.control('superResolution','quality');assert.equal(f.calls.some(call=>call.name==='control'&&call.value.type==='superResolution'),false);await f.controller.control('speed',3);assert.equal(f.video.playbackRate,3);await f.controller.control('aspect','fill');assert.equal(f.video.style.objectFit,'fill');await f.controller.control('volume',40);assert.equal(f.video.volume,.4);f.video.currentTime=20;f.video.dispatchEvent(new f.dom.window.Event('timeupdate'));await tick();assert(f.calls.some(call=>call.name==='progress'&&call.value.position===20));f.controller.dispose();assert.equal(f.stats().unsubscribed,3);const count=f.calls.length;f.document.getElementById('close').click();assert.equal(f.calls.length,count);}finally{f.close();}
});
test('a stalled renderer frame still reports the native viewport at 50ms and disposal cancels both pending paths',async()=>{
  const timers=new Map(),animationFrames=new Map();let now=0,timerId=0,frameId=1000;
  const advance=milliseconds=>{now+=milliseconds;for(const [id,item]of [...timers])if(item.due<=now){timers.delete(id);item.callback();}};
  const f=fixture(nativeState,view=>{
    // Hidden embedded Chromium views can report visible while never invoking
    // RAF. Keep those callbacks pending and independently advance timeout time.
    view.requestAnimationFrame=callback=>{const id=++frameId;animationFrames.set(id,callback);return id;};
    view.cancelAnimationFrame=id=>animationFrames.delete(id);
    view.setTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,due:now+delay});return id;};
    view.clearTimeout=id=>timers.delete(id);
  });
  try{
    await tick();assert.equal(f.document.hidden,false);assert.equal(animationFrames.size,1);assert.equal(timers.size,2);
    advance(49);assert.equal(f.calls.filter(call=>call.name==='viewport').length,0);
    advance(1);
    const reports=f.calls.filter(call=>call.name==='viewport');assert.equal(reports.length,1);
    assert.deepEqual(reports[0].value,{x:0,y:56,width:1000,height:544,scale:1,visible:true});
    assert.equal(animationFrames.size,0);assert.equal(timers.size,1);
    f.document.getElementById('sr-toggle').click();
    assert.equal(animationFrames.size,1);assert.equal(timers.size,1);
    const lateFallback=[...timers.values()][0].callback;
    f.controller.dispose();assert.equal(animationFrames.size,0);assert.equal(timers.size,0);
    const count=f.calls.length;advance(100);lateFallback();assert.equal(f.calls.length,count);
  }finally{f.close();}
});

test('native pointer bridge controls chrome while paused, and the deleted screenshot feature cannot be dispatched',async()=>{
  const timers=new Map();let now=0,id=0;
  const f=fixture({...nativeState,video:{...nativeState.video,paused:true}},view=>{
    view.setTimeout=(callback,delay)=>{const key=++id;timers.set(key,{callback,due:now+delay});return key;};view.clearTimeout=key=>timers.delete(key);
    view.requestAnimationFrame=()=>0;view.cancelAnimationFrame=()=>{};
  });
  const advance=ms=>{const target=now+ms;while(true){const next=[...timers].filter(([,item])=>item.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].callback();}now=target;};
  try{
    await tick();advance(2500);assert.equal(f.document.body.dataset.chromeHidden,'true');
    f.frame({position:12,duration:120,paused:true});assert.equal(f.document.body.dataset.chromeHidden,'true');
    f.pointer({insideApp:true,insideVideo:true,x:10,y:10,changed:true});assert.equal(f.document.body.dataset.chromeHidden,'false');
    f.pointer({insideApp:false,insideVideo:false,changed:true});advance(150);assert.equal(f.document.body.dataset.chromeHidden,'true');
    f.document.getElementById('picture-toggle').click();advance(5000);assert.equal(f.document.body.dataset.chromeHidden,'false');
    await f.controller.control('screenshot');assert.equal(f.calls.some(call=>call.name==='control'&&call.value.type==='screenshot'),false);
    f.controller.dispose();assert.equal(timers.size,0);assert.equal(f.stats().unsubscribed,3);
  }finally{f.close();}
});

test('chrome exit releases the entire native viewport without RAF or CSS transition events, and reversal cancels the pending release',async()=>{
  const timers=new Map(),frames=new Map();let now=0,id=0;
  const f=fixture(nativeState,view=>{
    view.setTimeout=(callback,delay)=>{const key=++id;timers.set(key,{callback,due:now+delay});return key;};view.clearTimeout=key=>timers.delete(key);
    view.requestAnimationFrame=callback=>{const key=++id;frames.set(key,callback);return key;};view.cancelAnimationFrame=key=>frames.delete(key);
  });
  f.document.getElementById('video-stage').getBoundingClientRect=()=>f.document.body.dataset.chromeCollapsed==='true'?{x:0,y:0,width:1000,height:600}:{x:0,y:50,width:1000,height:478};
  const advance=ms=>{const target=now+ms;while(true){const next=[...timers].filter(([,item])=>item.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].callback();}now=target;};
  try{
    await tick();advance(2500);assert.equal(f.document.body.dataset.chromeHidden,'true');assert.equal(f.document.body.dataset.chromeCollapsed,'false');
    advance(80);f.pointer({insideApp:true,insideVideo:true,x:10,y:10,changed:true});advance(80);
    assert.equal(f.document.body.dataset.chromeHidden,'false');assert.equal(f.document.body.dataset.chromeCollapsed,'false');
    advance(2420);assert.equal(f.document.body.dataset.chromeHidden,'true');advance(159);assert.equal(f.document.body.dataset.chromeCollapsed,'false');advance(1);
    assert.equal(f.document.body.dataset.chromeCollapsed,'true');advance(50);
    const viewport=f.calls.filter(call=>call.name==='viewport').at(-1);assert.deepEqual(viewport.value,{x:0,y:0,width:1000,height:600,scale:1,visible:true});
    f.pointer({insideApp:true,insideVideo:true,x:20,y:20,changed:true});assert.equal(f.document.body.dataset.chromeCollapsed,'false');
    f.pointer({insideApp:false,insideVideo:false,changed:true});advance(150);
    const lateRelease=[...timers.values()].find(item=>item.due===now+160)?.callback;assert.equal(typeof lateRelease,'function');
    f.controller.dispose();assert.equal(timers.size,0);assert.equal(frames.size,0);const count=f.calls.length;lateRelease();
    assert.equal(f.document.body.dataset.chromeCollapsed,'false');assert.equal(f.calls.length,count);
  }finally{f.close();}
});


test('output controls use explicit GPU targets and source pixels remain separately labelled',async()=>{
 const f=fixture();try{await tick();assert.match(f.document.getElementById('source-quality').textContent,/1920 × 1080/);assert.match(f.document.getElementById('sr-current').textContent,/4K 目标/);f.document.querySelector('[data-output="1440p"]').click();await tick();assert(f.calls.some(call=>call.name==='control'&&call.value.type==='outputResolution'&&call.value.value==='1440p'));assert.match(f.document.getElementById('output-help').textContent,/2560 × 1440/);assert.match(f.document.getElementById('source-quality').textContent,/1920 × 1080/);}finally{f.close();}
});

test('Escape exits full screen when a button or slider owns focus and never enters fullscreen from normal mode',async()=>{
 const f=fixture({...nativeState,fullscreen:true});try{await tick();f.document.getElementById('sr-toggle').click();const focus=f.document.querySelector('[data-output="1080p"]');focus.focus();focus.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();assert(f.calls.some(call=>call.name==='control'&&call.value.type==='exitFullscreen'));assert(!f.calls.some(call=>call.name==='control'&&call.value.type==='fullscreen'));f.state({...nativeState,fullscreen:false});f.calls.length=0;f.document.querySelector('[data-picture="brightness"]').dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();assert(!f.calls.some(call=>call.name==='control'&&/Fullscreen|fullscreen/.test(call.value.type)));assert.equal(f.document.getElementById('player-panel').hidden,true);}finally{f.close();}
});
