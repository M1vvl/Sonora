'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const stageModule=require('../ui/music/playlist-stage.js'),{create:createLibrary}=require('../ui/music/library.js');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
const items=Array.from({length:18},(_,i)=>({id:String(i+1),title:'歌单 '+(i+1),artist:'歌手',trackCount:12,coverURL:'https://example.test/'+i+'.jpg'}));
function fixture(reduced=false){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test',pretendToBeVisual:true}),view=dom.window,root=view.document.getElementById('root'),frames=new Map(),timers=new Map();let id=0,time=0;
  view.matchMedia=()=>({matches:reduced});
  view.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};view.cancelAnimationFrame=value=>frames.delete(value);
  view.setTimeout=(fn,delay)=>{timers.set(++id,{fn,delay});return id;};view.clearTimeout=value=>timers.delete(value);
  return {dom,view,root,frames,timers,step(count=1){for(let i=0;i<count;i++){time+=1000/60;const batch=[...frames];frames.clear();for(const[,fn]of batch)fn(time);}},flush(){for(const[key,value]of [...timers]){timers.delete(key);value.fn();}},close(){dom.window.close();}};
}
test('continuous shelf wheel reverses mid-spring, preserves visible nodes, then releases its frame',()=>{
  const f=fixture(),stage=stageModule.create({root:f.root,initialId:'5'});
  try{stage.update(items);f.step(70);assert(stage.getState().introDone);assert.equal(f.frames.size,0);const retained=f.root.querySelector('[data-stage-index="4"]');
    f.root.dispatchEvent(new f.view.WheelEvent('wheel',{deltaY:240,cancelable:true}));f.step(5);
    assert(stage.getState().position>4&&stage.getState().position<6);assert(stage.getState().pendingFrame);
    f.root.dispatchEvent(new f.view.WheelEvent('wheel',{deltaY:-240,cancelable:true}));assert.equal(stage.getState().target,4);f.flush();f.step(90);
    assert.equal(stage.getState().position,4);assert.equal(f.root.querySelector('[data-stage-index="4"]'),retained);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert(f.root.querySelectorAll('.music-stage-card').length<=7);
  }finally{stage.dispose();f.close();}
});
test('shelf metadata and appearance update retained cards; reduced motion never leaves cards transparent',()=>{
  const f=fixture(true),stage=stageModule.createDetails({root:f.root,settings:{shelfDetailScale:1}});
  try{stage.update(items);const card=f.root.querySelector('[data-stage-index="0"]');assert.equal(card.style.opacity,'1');assert.equal(f.frames.size,0);
    stage.update([{...items[0],title:'更新标题',coverURL:'https://example.test/new.jpg'},...items.slice(1)]);
    assert.equal(f.root.querySelector('[data-stage-index="0"]'),card);assert.match(card.textContent,/更新标题/);assert.match(card.querySelector('img').src,/new.jpg/);
    const transform=card.style.transform;stage.updateSettings({shelfSize:1.2,shelfDetailScale:1.1,shelfDetailAngleY:22,shelfDetailOffsetX:1,shelfOpacity:.5,shelfBgOpacity:.3});
    assert.notEqual(card.style.transform,transform);assert.match(card.style.transform,/rotateY\(22deg\)/);assert.equal(card.style.opacity,'.5'.replace(/^\./,'0.'));assert.equal(card.style.getPropertyValue('--stage-bg-opacity'),'0.3');assert.equal(f.frames.size,0);
  }finally{stage.dispose();f.close();}
});
test('hidden and disposed stage cancels animation and snap timers without losing the selection',()=>{
  const f=fixture(),stage=stageModule.create({root:f.root});
  try{stage.update(items);f.step(70);f.root.dispatchEvent(new f.view.WheelEvent('wheel',{deltaY:300,cancelable:true}));f.step(3);assert(f.frames.size&&f.timers.size);
    Object.defineProperty(f.view.document,'hidden',{value:true,configurable:true});f.view.document.dispatchEvent(new f.view.Event('visibilitychange'));assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(stage.getState().velocity,0);
    const position=stage.getState().position;stage.dispose();f.root.dispatchEvent(new f.view.WheelEvent('wheel',{deltaY:200,cancelable:true}));assert.equal(stage.getState().position,position);assert.equal(f.root.children.length,0);
  }finally{stage.dispose();f.close();}
});
test('shelf close keeps a paused exit frame, re-open interrupts cleanup, deactivation releases immediately',async()=>{
  const f=fixture();let resolveLate=null;const library=createLibrary({root:f.root,api:async action=>{if(action==='userPlaylists')return {playlists:items};if(action==='playlist')return new Promise(resolve=>resolveLate=resolve);return {};}});
  try{library.activate();library.configure({mode:'stage',autoHide:false,edgeEnabled:false,appearance:{shelfSummonCloseDuration:.46,shelfCameraExitSpeed:.24}});library.open();await settle();f.step(70);
    const card=f.root.querySelector('[data-stage-index="0"]');library.close();assert(library.getState().pendingExit);assert.equal(library.getState().stage.pendingFrame,false);assert.equal(f.root.querySelector('[data-stage-index="0"]'),card);
    library.open();await settle();assert.equal(f.root.querySelector('[data-stage-index="0"]'),card);assert(!library.getState().pendingExit);f.flush();assert(f.root.querySelector('.music-stage-card'));
    f.root.querySelector('[data-stage-action="detail"]').click();assert.equal(typeof resolveLate,'function');library.close({immediate:true});resolveLate({songs:[{id:'999',title:'迟到歌曲'}],total:1});await settle();assert.equal(f.root.querySelector('.music-stage-card'),null);assert.equal(library.getState().songs,0);
    library.open();await settle();f.step(70);library.close();library.deactivate();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(library.getState().pendingExit,false);assert.equal(library.getState().stage,undefined);
    f.root.querySelector('.music-library-edge').dispatchEvent(new f.view.Event('pointerenter'));assert(!library.getState().open);
  }finally{library.dispose();f.close();}
});
