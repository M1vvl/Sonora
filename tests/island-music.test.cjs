'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {create}=require('../ui/island-music.js');

function fixture({controller=false}={}) {
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../ui/island.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,document=w.document,calls=[],frames=new Map();let stamp=0,serial=0,listener,settingsListener;
  Object.defineProperty(document,'hidden',{get:()=>false});w.performance.now=()=>stamp;
  w.matchMedia=()=>({matches:false});
  w.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};w.cancelAnimationFrame=id=>frames.delete(id);
  w.PulseActivityFeed={setMotion(){},setExpanded(){}};
  w.pulse={getSettings:async()=>({}),getSnapshot:async()=>null,onSnapshot(){},onSettings(fn){settingsListener=fn;},
    onMediaUpdate(fn){listener=fn;return()=>{listener=null;};},
    islandMusicCommand:async(action,position)=>{calls.push({action,position});return {ok:true};},
    islandInteraction:async value=>{calls.push({interaction:value});return {};},
    setIslandExpanded:async value=>{calls.push({expanded:value});return {};},
    moveIsland:async value=>{calls.push({move:value});return {};}};
  let music;
  if(controller){w.PulseIslandMusic={create(options){music=create(options);return music;}};w.eval(fs.readFileSync(path.join(__dirname,'../ui/island.js'),'utf8'));}
  else music=create({island:document.getElementById('island')});
  return {w,document,music,calls,frames,receive:value=>listener(value),settings:value=>settingsListener(value),advance(ms){stamp+=ms;const work=[...frames.values()];frames.clear();for(const fn of work)fn(stamp);},async close(){music.dispose();await new Promise(resolve=>setImmediate(resolve));w.close();}};
}
const song={available:true,canControl:true,playing:true,trackKey:'track-a',title:'Track A',artist:'Artist',position:4,duration:120,cover:'data:image/png;base64,YQ==',lines:[{time:0,text:'One'},{time:5,text:'Two'},{time:8,text:'Three'}]};
test('island lyric clock merges same-track partial updates, extrapolates only 1.5 seconds and owns no audio',async()=>{
  const f=fixture();try{
    f.music.setPage('monitor');
    f.receive(song);assert.equal(f.music.getState().pendingFrame,false);
    f.music.setPage('music');f.advance(1000);assert.equal(f.music.getState().position,5);assert.equal(f.document.querySelector('.island-music-line span').textContent,'Two');
    f.receive({trackKey:'track-a',lines:[{time:0,text:'Updated'},{time:5,text:'Current'}]});
    assert.equal(f.music.getState().position,5,'late lyric metadata cannot reset the playback anchor');
    f.advance(10000);assert.equal(f.music.getState().position,5.5);assert.equal(f.document.querySelectorAll('audio').length,0);
    assert.equal(f.document.querySelector('.island-music-art img').getAttribute('src'),song.cover);
    f.receive({trackKey:'track-a',playing:false,position:7});assert.equal(f.music.getState().pendingFrame,false);
    f.advance(5000);assert.equal(f.music.getState().position,7);
    f.receive({trackKey:'track-b',available:true,position:0,duration:30,playing:false});assert.equal(f.music.getState().lines,0);assert.equal(f.document.querySelector('.island-music-line span').textContent,'');
  }finally{await f.close();}
  assert.equal(f.frames.size,0);
});
test('music transport forwards one command and seek holds autohide until external pointerup',async()=>{
  const f=fixture();try{
    f.receive(song);f.music.setPage('music');
    f.document.querySelector('[data-music-command="toggle"]').click();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(f.calls[0],{action:'toggle',position:undefined});
    const seek=f.document.querySelector('.island-music-seek');seek.dispatchEvent(new f.w.Event('pointerdown',{bubbles:true}));assert.equal(f.music.getState().scrubbing,true);
    seek.value='80';seek.dispatchEvent(new f.w.Event('input',{bubbles:true}));assert.equal(f.document.querySelector('.island-music-clock time').textContent,'1:20');
    f.document.dispatchEvent(new f.w.Event('pointerup',{bubbles:true}));seek.dispatchEvent(new f.w.Event('change',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));
    assert(f.calls.some(row=>row.action==='seek'&&row.position===80));assert.equal(f.music.getState().scrubbing,false);
    seek.dispatchEvent(new f.w.Event('pointerdown',{bubbles:true}));f.document.dispatchEvent(new f.w.Event('pointercancel',{bubbles:true}));
    assert.equal(f.music.getState().scrubbing,false);assert.equal(f.calls.at(-1).interaction.value,false);
    f.music.setExpanded(true);assert.equal(f.document.getElementById('island-details').hidden,true);assert.equal(f.document.querySelector('.island-music-details').hidden,false);
  }finally{await f.close();}
});
test('horizontal swipe switches the two existing-size island pages, while music buttons do not begin a drag',async()=>{
  const f=fixture({controller:true});
  function pointer(type,x,y,target=f.document.getElementById('island')) {
    const event=new f.w.Event(type,{bubbles:true,cancelable:true});
    for(const [key,value]of Object.entries({pointerId:1,button:0,screenX:x,screenY:y}))Object.defineProperty(event,key,{value});
    target.dispatchEvent(event);
  }
  try{
    f.music.setPage('monitor');
    f.receive(song);pointer('pointerdown',300,20);pointer('pointermove',200,22);pointer('pointerup',200,22);
    assert.equal(f.music.getState().page,'music');assert.equal(f.document.querySelectorAll('[data-page-dot]').length,0);assert.equal(f.calls.filter(row=>row.move).length,0);
    const before=f.calls.filter(row=>row.interaction).length;
    const button=f.document.querySelector('[data-music-command="toggle"]');pointer('pointerdown',410,20,button);pointer('pointermove',320,20,button);pointer('pointerup',320,20,button);
    assert.equal(f.calls.filter(row=>row.interaction).length,before);assert.equal(f.music.getState().page,'music');
    pointer('pointerdown',240,20);pointer('pointerup',240,20);f.document.getElementById('island').dispatchEvent(new f.w.MouseEvent('dblclick',{bubbles:true,detail:2}));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.music.getState().expanded,true);assert.equal(f.document.querySelector('.island-music-details').hidden,false);
    pointer('pointerdown',200,20);pointer('pointermove',300,20);pointer('pointerup',300,20);assert.equal(f.music.getState().page,'monitor');assert.equal(f.document.getElementById('island-details').hidden,false);
    const layout=require('../src/window-layout.cjs');assert.deepEqual(layout.ISLAND_COMPACT,{width:480,height:44});assert.deepEqual(layout.ISLAND_EXPANDED,{width:520,height:260});
  }finally{await f.close();}
});
test('island native word timing and line timing progressively fill the current lyric',()=>{
  const {progressAt}=require('../ui/island-music.js');
  const line={time:0,text:'One two',words:[{time:0,duration:2,c0:0,c1:3},{time:2,duration:2,c0:4,c1:7}]};
  assert.equal(progressAt(line,null,1,10),1.5/7);assert.equal(progressAt(line,null,3,10),5.5/7);assert.equal(progressAt(line,null,5,10),1);
  assert.equal(progressAt({time:5,text:'Line'}, {time:9},7,12),.5);
});

test('unknown external timeline and metadata fragments show only the actual title', async()=>{
  const f=fixture();try{
    f.receive({...song,source:'cloudmusic',timelineKnown:false,duration:0,position:0,lines:[{time:0,text:'{"c":[]}'},{time:1,text:'{c}'},{time:2,text:'valid but not synchronized'}]});
    f.music.setPage('music');f.advance(1200);
    assert.equal(f.music.getState().position,0);
    assert.equal(f.music.getState().pendingFrame,false);
    assert.equal(f.document.querySelector('.island-music-line span').textContent,'Track A');
    assert.equal(f.document.querySelector('.island-music-line').classList.contains('is-title'),true);
    f.music.setExpanded(true);assert.equal(f.document.querySelector('.island-music-lyrics').children.length,0);
    assert.equal(f.document.querySelector('.island-music-seek').disabled,true);
    f.receive({trackKey:'track-a',timelineKnown:true,duration:100,position:4,lines:[{time:0,text:'{c}'},{time:3,text:'real verse'}]});
    assert.equal(f.music.getState().lines,1);assert.equal(f.document.querySelector('.island-music-line span').textContent,'real verse');
    f.receive({trackKey:'track-a',lines:[]});assert.equal(f.document.querySelector('.island-music-line span').textContent,'Track A');
  }finally{await f.close();}
});

test('all surface gestures leave native placement fixed and acknowledge actual mode changes',async()=>{
  const f=fixture({controller:true});
  const handle=f.document.querySelector('.drag-handle');
  function pointer(type,x,y) {
    const event=new f.w.Event(type,{bubbles:true,cancelable:true});
    for(const [key,value]of Object.entries({pointerId:1,button:0,screenX:x,screenY:y}))Object.defineProperty(event,key,{value});
    handle.dispatchEvent(event);
  }
  try{
    await new Promise(resolve=>setImmediate(resolve));
    f.settings({islandAutoHide:false});
    for(const [dx,dy]of [[60,0],[0,-60],[40,40],[0,60]]) {
      pointer('pointerdown',200,20);pointer('pointermove',200+dx,20+dy);pointer('pointerup',200+dx,20+dy);
    }
    assert.equal(f.calls.filter(row=>row.move).length,0);
    f.settings({islandAutoHide:true});
    const feedback=f.document.getElementById('island-mode-feedback');assert.equal(feedback.hidden,false);assert.match(feedback.textContent,/自动隐藏/);
    f.settings({islandAutoHide:false});assert.match(feedback.textContent,/固定/);
  }finally{await f.close();}
});

test('island progress is a continuous thin track without a thumb and reuses one cover palette',async()=>{
  const css=fs.readFileSync(path.join(__dirname,'../ui/island-music.css'),'utf8');
  assert.match(css,/slider-runnable-track\{height:2px/);
  assert.match(css,/slider-thumb\{appearance:none;width:0;height:0/);
  const f=fixture();try{
    let reads=0;f.w.PulseCoverPalette={read(){reads++;return {light:'rgb(190 210 250)',dark:'rgb(40 65 125)'};}};
    f.receive(song);const image=f.document.querySelector('.island-music-art img');image.dispatchEvent(new f.w.Event('load'));
    const host=f.document.querySelector('.island-music');assert.equal(host.style.getPropertyValue('--island-song-light'),'rgb(190 210 250)');
    f.receive({trackKey:'track-a',position:9});assert.equal(reads,1,'timeline ticks never resample cover pixels');
    f.receive({trackKey:'track-b',cover:null});assert.equal(host.style.getPropertyValue('--island-song-light'),'');
  }finally{await f.close();}
});

test('shared cover palette remains bounded and readable on both glass appearances',()=>{
  const {fromPixels}=require('../ui/cover-palette.js');
  const pixels=new Uint8ClampedArray(16*16*4);for(let n=0;n<pixels.length;n+=4)pixels.set([244,155,55,255],n);
  const palette=fromPixels(pixels);
  const luminance=value=>{const rgb=value.match(/\d+/g).map(Number).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  const darkBackground=luminance('rgb(23 35 44)');
  assert((luminance(palette.light)+.05)/(darkBackground+.05)>=4.5);
  assert(1.05/(luminance(palette.dark)+.05)>=4.5);
  assert.equal(fromPixels(new Uint8ClampedArray(16)),null);
  const extended=new Uint8ClampedArray(pixels.length*2);extended.set(pixels);for(let n=pixels.length;n<extended.length;n+=4)extended.set([0,255,0,255],n);
  assert.deepEqual(fromPixels(extended),palette,'sampling cannot grow past 256 cover pixels');
});

test('the lyric page reuses the monitor record rotation, pause and visibility state', async()=>{
  const f=fixture();
  try{
    const artwork=f.document.querySelector('.island-music-art');
    assert.equal(f.music.getState().page,'music');
    assert.equal(f.document.getElementById('island-toggle').hidden,true);
    f.music.setPage('monitor');
    f.receive({...song,rotationMode:'rotate'});
    assert.equal(artwork.dataset.mediaVisible,'false');
    f.music.setPage('music');
    assert.equal(artwork.dataset.mediaActive,'true');
    assert.equal(artwork.dataset.mediaPlaying,'true');
    assert.equal(artwork.dataset.mediaVisible,'true');
    assert.equal(artwork.dataset.mediaMotion,'rotate');
    f.receive({trackKey:song.trackKey,playing:false});
    assert.equal(artwork.dataset.mediaPlaying,'false');
    f.receive({trackKey:song.trackKey,rotationMode:'still'});
    assert.equal(artwork.dataset.mediaMotion,'still');
    f.document.querySelector('.island-music-art img').dispatchEvent(new f.w.Event('error'));
    assert.equal(artwork.dataset.mediaActive,'false');
    f.music.setPage('monitor');
    assert.equal(artwork.dataset.mediaVisible,'false');
  }finally{await f.close();}
});
