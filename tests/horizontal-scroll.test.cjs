'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create}=require('../ui/horizontal-scroll.js');
function fixture({initial=5000,reduced=false,maxTravelCards=2}={}){
 const dom=new JSDOM('<div id="viewport"><button class="card"></button><button class="card"></button><button class="card"></button></div>',{pretendToBeVisual:true}),view=dom.window,viewport=view.document.getElementById('viewport'),frames=new Map();let current=initial,frameId=0,time=1000,scrolls=0,captured=false,writes=0,reads=0;
 Object.defineProperties(viewport,{clientWidth:{value:600},scrollWidth:{value:12000},scrollLeft:{get:()=>current,set:value=>{writes++;current=Math.max(0,Math.min(11400,Number(value)||0));}}});
 [...viewport.children].forEach((node,index)=>node.getBoundingClientRect=()=>{reads++;return {left:index*220-current,right:index*220-current+200,width:200,top:0,bottom:200,height:200};});
 view.requestAnimationFrame=callback=>{const id=++frameId;frames.set(id,callback);return id;};view.cancelAnimationFrame=id=>frames.delete(id);view.matchMedia=()=>({matches:reduced});Object.defineProperty(view.performance,'now',{value:()=>time});
 viewport.setPointerCapture=()=>{captured=true;};viewport.hasPointerCapture=()=>captured;viewport.releasePointerCapture=()=>{captured=false;};
 const control=create({viewport,cardSelector:'.card',maxTravelCards,onScroll:()=>scrolls++});
 function pointer(type,x,y=10,at=time){const event=new view.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true});Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:'mouse'},isPrimary:{value:true},timeStamp:{value:at}});viewport.dispatchEvent(event);return event;}
 function paint(delta=16){time+=delta;const batch=[...frames.values()];frames.clear();for(const callback of batch)callback(time);return current;}
 function settle(){let count=0;while(frames.size&&count++<500)paint();assert.equal(frames.size,0,'inertia must settle');return current;}
 return {view,viewport,frames,control,pointer,paint,settle,get time(){return time;},get scrolls(){return scrolls;},get writes(){return writes;},get reads(){return reads;},close(){control.dispose();view.close();}};
}

test('music keeps a two-card budget while movie direct drag and inertia share a ten-card budget in either direction',()=>{
 for(const maxTravelCards of [2,10])for(const direction of [-1,1]){const f=fixture({maxTravelCards});try{
  f.control.activate();const start=f.viewport.scrollLeft;f.pointer('pointerdown',500);f.pointer('pointermove',500-direction*4000,10,f.time+20);f.paint();assert.equal(f.viewport.scrollLeft,start+direction*220*maxTravelCards);f.pointer('pointerup',500-direction*4000,10,f.time+30);f.settle();assert.equal(f.viewport.scrollLeft,start+direction*220*maxTravelCards);
 }finally{f.close();}}
});

test('high-frequency pointer movement produces one scroll write per frame and measures geometry only at pointerdown',()=>{
 const f=fixture({maxTravelCards:10});try{
  f.control.activate();f.pointer('pointerdown',600);const measured=f.reads;
  for(let index=1;index<=80;index++)f.pointer('pointermove',600-index*3,10,f.time+index);
  assert.equal(f.writes,0);assert.equal(f.frames.size,1);assert.equal(f.reads,measured);f.paint();assert.equal(f.writes,1);assert.equal(f.viewport.scrollLeft,5240);assert.equal(f.reads,measured);f.pointer('pointercancel',360);assert.equal(f.frames.size,0);
 }finally{f.close();}
});

test('a fast movie flick can cross more than two cards but eases to rest within ten cards',()=>{
 const f=fixture({maxTravelCards:10});try{
  f.control.activate();const start=f.viewport.scrollLeft;f.pointer('pointerdown',1000);f.pointer('pointermove',400,10,f.time+10);f.paint();f.pointer('pointerup',400,10,f.time+20);const release=f.viewport.scrollLeft;
  const a=f.paint(),b=f.paint(),c=f.paint();assert(a>release&&b>a&&c>b);assert(a-release>b-a&&b-a>c-b,'motion increments must decay');const end=f.settle();assert(end>start+440);assert(end<=start+2200);assert.equal(f.control.getState().inertia,false);assert(f.scrolls>0);
 }finally{f.close();}
});

test('a new pointerdown immediately stops motion and the next gesture gets its own budget',()=>{
 const f=fixture({maxTravelCards:10});try{
  f.control.activate();f.pointer('pointerdown',400);f.pointer('pointermove',340,10,f.time+30);f.pointer('pointerup',340,10,f.time+40);f.paint();const stopped=f.viewport.scrollLeft;assert(f.frames.size>0);
  f.pointer('pointerdown',200);assert.equal(f.frames.size,0);f.paint();assert.equal(f.viewport.scrollLeft,stopped);f.pointer('pointermove',100,10,f.time+50);f.paint();assert.equal(f.viewport.scrollLeft,stopped+100);f.pointer('pointercancel',100,10,f.time+60);assert.equal(f.frames.size,0);
 }finally{f.close();}
});

test('stationary release has no stale-velocity fling and native image drags are suppressed',()=>{
 const f=fixture({maxTravelCards:10});try{f.control.activate();f.pointer('pointerdown',400);f.pointer('pointermove',350,10,f.time+20);f.paint();f.pointer('pointerup',350,10,f.time+2000);assert.equal(f.frames.size,0);const event=new f.view.Event('dragstart',{bubbles:true,cancelable:true});f.viewport.firstChild.dispatchEvent(event);assert(event.defaultPrevented);}finally{f.close();}
});

test('cancel, hidden document, deactivate and disposal stop frames; inactive input cannot change scroll',()=>{
 for(const action of ['hidden','deactivate','dispose']){const f=fixture();try{
  f.control.activate();f.pointer('pointerdown',400);f.pointer('pointermove',350,10,f.time+30);f.pointer('pointerup',350,10,f.time+40);assert(f.frames.size>0);
  if(action==='hidden'){Object.defineProperty(f.view.document,'visibilityState',{value:'hidden',configurable:true});f.view.document.dispatchEvent(new f.view.Event('visibilitychange'));}else f.control[action]();
  const before=f.viewport.scrollLeft;assert.equal(f.frames.size,0);f.paint();assert.equal(f.viewport.scrollLeft,before);
  if(action!=='hidden'){f.pointer('pointerdown',400);f.pointer('pointermove',100,10,f.time+30);f.viewport.dispatchEvent(new f.view.WheelEvent('wheel',{deltaY:100}));f.viewport.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'ArrowRight'}));assert.equal(f.viewport.scrollLeft,before);}
 }finally{f.close();}}
});

test('reduced motion and vertical intent never leave a release animation running',()=>{
 const f=fixture({reduced:true});try{
  f.control.activate();f.pointer('pointerdown',400);f.pointer('pointermove',330,10,f.time+20);f.pointer('pointerup',330,10,f.time+30);assert.equal(f.frames.size,0);const before=f.viewport.scrollLeft;
  f.pointer('pointerdown',400);f.pointer('pointermove',398,40,f.time+20);f.pointer('pointermove',200,42,f.time+40);f.pointer('pointerup',200,42,f.time+50);assert.equal(f.viewport.scrollLeft,before);assert.equal(f.frames.size,0);
 }finally{f.close();}
});
