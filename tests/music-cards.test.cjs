'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create,normalizeItems,safeCover,springStep,MAX_RENDER,MAX_TEXTURE}=require('../ui/music/cards.js');
const cover=n=>`pulse-music-image://image?url=${encodeURIComponent('https://p1.music.126.net/'+n+'.jpg')}`;
const tracks=[{id:'a',title:'A',artist:'Artist A',coverURL:cover('a')},{id:'b',title:'B',artist:'Artist B',coverURL:cover('b')},{id:'c',title:'C',artist:'Artist C',coverURL:cover('c')}];
function fakeGL(){
  const calls=[],live={texture:new Set(),framebuffer:new Set(),program:new Set(),buffer:new Set()};let next=0,program=null;
  const gl={calls,live,VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,TEXTURE_2D:7,TEXTURE_MIN_FILTER:8,TEXTURE_MAG_FILTER:9,LINEAR:10,TEXTURE_WRAP_S:11,TEXTURE_WRAP_T:12,CLAMP_TO_EDGE:13,RGBA:14,UNSIGNED_BYTE:15,FRAMEBUFFER:16,COLOR_ATTACHMENT0:17,FRAMEBUFFER_COMPLETE:18,FLOAT:19,TEXTURE0:20,TEXTURE1:21,TRIANGLES:22,COLOR_BUFFER_BIT:23,UNPACK_FLIP_Y_WEBGL:24,
    createShader:()=>({id:++next}),shaderSource(shader,source){shader.source=source;calls.push(['shader',source]);},compileShader(){},getShaderParameter:()=>true,deleteShader(){},attachShader(){},linkProgram(){},getProgramParameter:()=>true,
    getAttribLocation:()=>0,enableVertexAttribArray(){},vertexAttribPointer(){},bindBuffer(){},bufferData(){},bindTexture(){},texParameteri(){},bindFramebuffer(){},framebufferTexture2D(){},checkFramebufferStatus:()=>18,activeTexture(){},pixelStorei(){},viewport(...args){calls.push(['viewport',...args]);},clearColor(){},clear(){},
    useProgram(value){program=value;},getUniformLocation:(_p,name)=>name,uniform1i(){},uniform2f(name,...values){calls.push(['uniform',name,...values]);},texImage2D(...args){calls.push(['upload',...args]);},drawArrays(){calls.push(['draw',program]);},
    NO_ERROR:0,getError:()=>0,getExtension:()=>({loseContext:()=>calls.push(['lose'])})
  };
  for(const name of ['Texture','Framebuffer','Program','Buffer']){const set=live[name.toLowerCase()];gl['create'+name]=()=>{const item={type:name,id:++next};set.add(item);return item;};gl['delete'+name]=item=>set.delete(item);}
  return gl;
}
function fixture({webgl=false,reduced=false}={}){
  const dom=new JSDOM('<section id="root"></section>',{pretendToBeVisual:true,url:'file:///D:/AgentPulse/ui/dashboard.html'}),view=dom.window,root=view.document.getElementById('root'),frames=new Map(),observers=[],intersections=[],contexts=[],plays=[],errors=[],media=[];let frameId=0,time=1000;
  view.requestAnimationFrame=callback=>{const id=++frameId;frames.set(id,callback);return id;};view.cancelAnimationFrame=id=>frames.delete(id);Object.defineProperty(view.performance,'now',{value:()=>time});
  view.matchMedia=query=>{const callbacks=new Set(),item={query,matches:query.includes('reduced-motion')?reduced:true,addEventListener(_name,fn){callbacks.add(fn);},removeEventListener(_name,fn){callbacks.delete(fn);},callbacks};media.push(item);return item;};
  view.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  view.IntersectionObserver=class{constructor(callback){this.callback=callback;intersections.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  view.HTMLCanvasElement.prototype.getContext=function(kind){if(kind==='2d')return {drawImage(){}};if(!webgl)return null;const gl=fakeGL();contexts.push(gl);return gl;};
  const cards=create({root,onActivate:item=>plays.push(item),onError:error=>errors.push(error)}),front=root.querySelector('.music-cover-front'),stack=root.querySelector('.music-cards-stack');
  const bounds=()=>({left:100,top:100,width:240,height:240,right:340,bottom:340});front.getBoundingClientRect=stack.getBoundingClientRect=bounds;
  front.setPointerCapture=()=>{};front.releasePointerCapture=()=>{};
  const img=front.querySelector('img');Object.defineProperties(img,{complete:{get:()=>true},naturalWidth:{get:()=>1024},naturalHeight:{get:()=>768}});
  function paint(){time+=1000/60;const batch=[...frames];frames.clear();for(const[,callback]of batch)callback(time);}
  function settle(){for(let n=0;n<200&&frames.size;n++)paint();assert.equal(frames.size,0,'render loop must settle');}
  function pointer(type,x,y=110,at=time){const event=new view.MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,cancelable:true});Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:'mouse'},isPrimary:{value:true},timeStamp:{value:at}});front.dispatchEvent(event);}
  return {dom,view,root,cards,front,img,setReduced(value){for(const item of media)if(item.query.includes('reduced-motion')){item.matches=value;for(const fn of item.callbacks)fn();}},frames,observers,intersections,contexts,plays,errors,paint,settle,pointer,get time(){return time;},load:()=>img.dispatchEvent(new view.Event('load')),close(){cards.dispose();view.close();}};
}

test('music cards accept only controlled images and bounded ordered track queue',()=>{
  assert.equal(safeCover('https://p1.music.126.net/a.jpg'),'');assert.equal(safeCover('file:///private'),'');assert.equal(safeCover('javascript:alert(1)'),'');assert.equal(safeCover(cover('a')),cover('a'));
  const normalized=normalizeItems([tracks[0],tracks[0],tracks[1],tracks[2],{id:'d'}]);assert.deepEqual(normalized.map(item=>item.id),['a','b','c','d']);assert.equal(normalizeItems(Array.from({length:550},(_,i)=>({id:String(i)}))).length,530);assert.equal(normalizeItems(null).length,0);
});

test('critically damped card springs settle without overshoot and keep finite velocity through retargeting',()=>{
  let position=0,velocity=0;
  for(let n=0;n<50;n++){const next=springStep(position,velocity,1,1/60);assert(next.position>=position&&next.position<=1);position=next.position;velocity=next.velocity;}
  assert(Math.abs(position-1)<.00001);const before=position,next=springStep(position,velocity,-1,1/120);assert(Math.abs(next.position-before)<.05);assert(Number.isFinite(next.velocity));
  assert.deepEqual(springStep(3,2,10,0),{position:3,velocity:2});
});

test('cards construct inert, avoid duplicate back cards, and keyboard cycling preserves all three tracks',()=>{
  const f=fixture();try{
    f.cards.update(tracks);assert.equal(f.contexts.length,0);assert.equal(f.frames.size,0);assert.equal(f.img.getAttribute('src'),null);f.cards.activate();f.settle();
    assert.equal(f.img.getAttribute('src'),tracks[0].coverURL);assert.equal(f.root.querySelectorAll('.music-cover-back:not([hidden])').length,2);
    f.front.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.deepEqual(f.cards.getState().order,['b','c','a']);assert.equal(f.frames.size,0);
    f.front.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.deepEqual(f.cards.getState().order,['a','b','c']);
    f.front.click();assert.equal(f.plays[0].id,'a');f.cards.update([tracks[0]]);assert.equal(f.root.querySelectorAll('.music-cover-back:not([hidden])').length,0);
  }finally{f.close();}
});

test('full-cover horizontal drags cycle both ways, suppress clicks, and cancellation preserves order',()=>{
  const f=fixture();try{
    f.cards.update(tracks);f.cards.activate();f.settle();f.pointer('pointerdown',110);f.pointer('pointermove',30,110,f.time+40);f.pointer('pointerup',30,110,f.time+60);assert.equal(f.cards.getState().phase,'exit');f.front.click();assert.equal(f.plays.length,0);f.settle();assert.deepEqual(f.cards.getState().order,['b','c','a']);
    f.pointer('pointerdown',110);f.pointer('pointermove',70,110,f.time+30);f.pointer('pointercancel',70,110,f.time+50);f.settle();assert.deepEqual(f.cards.getState().order,['b','c','a']);
    f.pointer('pointerdown',220);f.pointer('pointermove',110,110,f.time+30);f.pointer('pointerup',110,110,f.time+50);f.settle();assert.deepEqual(f.cards.getState().order,['c','a','b'],'center drag cycles just like an edge');
    f.pointer('pointerdown',220);f.pointer('pointermove',330,110,f.time+35);f.pointer('pointerup',330,110,f.time+55);assert.equal(f.cards.getState().phase,'exit');f.settle();assert.deepEqual(f.cards.getState().order,['b','c','a'],'rightward drag reverses smoothly');
  }finally{f.close();}
});

test('quickly interrupting a committed card exit never duplicates or drops songs',()=>{
  const f=fixture();try{
    f.cards.update(tracks);f.cards.activate();f.settle();
    for(let n=0;n<4;n++){f.pointer('pointerdown',110);f.pointer('pointermove',10,110,f.time+50);f.pointer('pointerup',10,110,f.time+60);f.paint();}
    f.settle();assert.equal(new Set(f.cards.getState().order).size,3);assert.deepEqual([...f.cards.getState().order].sort(),['a','b','c']);
    f.cards.update(tracks);assert.equal(new Set(f.cards.getState().order).size,3);
  }finally{f.close();}
});

test('keyboard navigation during a committed swipe first honors that swipe, then the new keyboard command',()=>{
  const f=fixture();try{
    f.cards.update(tracks);f.cards.activate();f.settle();f.pointer('pointerdown',110);f.pointer('pointermove',10,110,f.time+50);f.pointer('pointerup',10,110,f.time+60);assert.equal(f.cards.getState().phase,'exit');
    f.front.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.deepEqual(f.cards.getState().order,['c','a','b']);assert.equal(f.frames.size,0);
  }finally{f.close();}
});

test('reduced motion switches cards immediately and hover never starts a moving reflection loop',()=>{
  const f=fixture({reduced:true});try{
    f.cards.update(tracks);f.cards.activate();f.settle();f.pointer('pointermove',330,110);assert.equal(f.frames.size,0);
    f.pointer('pointerdown',110);f.pointer('pointermove',10,110,f.time+50);f.pointer('pointerup',10,110,f.time+70);assert.deepEqual(f.cards.getState().order,['b','c','a']);assert.equal(f.frames.size,0);assert.equal(f.cards.getState().phase,'idle');
  }finally{f.close();}
});

test('one bounded WebGL context draws the sharp cover with two static blur passes, then releases all GPU resources',()=>{
  const f=fixture({webgl:true});try{
    f.cards.update(tracks);f.cards.activate();f.settle();f.load();assert.equal(f.cards.getState().renderer,'webgl');assert.equal(f.contexts.length,1);const gl=f.contexts[0];
    assert.equal(gl.live.texture.size,3);assert.equal(gl.live.framebuffer.size,2);assert.equal(gl.live.program.size,2);assert.equal(gl.live.buffer.size,1);
    assert(f.root.querySelector('canvas').width<=MAX_RENDER);const upload=gl.calls.find(value=>value[0]==='upload'&&value.length===7);assert.equal(upload.at(-1).width,MAX_TEXTURE);assert.equal(upload.at(-1).height,MAX_TEXTURE);
    assert(gl.calls.some(value=>value[0]==='shader'&&value[1].includes('reflect(')));
    const count=f.cards.getState().uploads;f.pointer('pointermove',330,110);f.settle();assert.equal(f.cards.getState().uploads,count,'hover only changes uniforms, not blur textures');assert.equal(f.contexts.length,1);assert.equal(f.frames.size,0);
    f.cards.deactivate();assert.equal(f.cards.getState().gpuContexts,0);assert.equal(f.frames.size,0);for(const resources of Object.values(gl.live))assert.equal(resources.size,0);assert.equal(f.root.querySelector('canvas'),null);assert.equal(f.img.getAttribute('src'),null);assert(gl.calls.some(value=>value[0]==='lose'));
    f.cards.activate();f.settle();f.load();assert.equal(f.contexts.length,2);assert.equal(f.cards.getState().gpuContexts,1);f.cards.update([]);assert.equal(f.cards.getState().gpuContexts,0);
  }finally{f.close();}
});

test('invisible or disposed cards stop frames and release GPU, while failed contexts use CSS fallback',()=>{
  const f=fixture({webgl:true});try{
    f.cards.update(tracks);f.cards.activate();f.settle();f.load();f.intersections[0].callback([{target:f.root,isIntersecting:false}]);assert.equal(f.cards.getState().gpuContexts,0);assert.equal(f.frames.size,0);assert.equal(f.cards.getState().visible,false);
    f.intersections[0].callback([{target:f.root,isIntersecting:true}]);f.settle();f.load();assert.equal(f.cards.getState().gpuContexts,1);f.cards.dispose();assert.equal(f.cards.getState().gpuContexts,0);assert(f.observers[0].disconnected);assert(f.intersections[0].disconnected);assert.equal(f.root.children.length,0);f.cards.update(tracks);f.cards.activate();assert.equal(f.frames.size,0);
  }finally{f.close();}
  const fallback=fixture();try{fallback.cards.update(tracks);fallback.cards.activate();fallback.settle();fallback.load();assert.equal(fallback.cards.getState().renderer,'css');assert.equal(fallback.errors.length,1);assert.equal(fallback.img.getAttribute('src'),tracks[0].coverURL);}finally{fallback.close();}
});

test('card resize observations coalesce outside observer delivery and cancel their owned work when inactive',()=>{
  const f=fixture();try{
    f.cards.update(tracks);f.cards.activate();f.settle();const before=f.front.style.transform;
    f.observers[0].callback();f.observers[0].callback();assert.equal(f.frames.size,1);assert.equal(f.front.style.transform,before,'observer callback must not write layout');
    f.settle();assert.equal(f.cards.getState().pendingFrame,false);f.observers[0].callback();assert(f.cards.getState().pendingFrame);f.cards.deactivate();assert.equal(f.cards.getState().pendingFrame,false);assert.equal(f.frames.size,0);
  }finally{f.close();}
});

 test('five visible layers traverse the full ordered daily and radar queue before repeating',()=>{const f=fixture();try{const tracks=Array.from({length:12},(_,i)=>({id:String(i),title:String(i),coverURL:cover(String(i))}));f.cards.update(tracks);f.cards.activate();f.settle();assert.equal(f.root.querySelectorAll('.music-cover-back:not([hidden])').length,4);for(let i=1;i<=12;i++){f.front.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));f.settle();assert.equal(f.cards.getState().order[0],String(i%12));}}finally{f.close();}});


test('a delayed radar deck is applied after an in-progress drag settles without resetting the displayed song',()=>{const f=fixture();try{f.cards.update(tracks);f.cards.activate();f.settle();f.pointer('pointerdown',150);f.pointer('pointermove',50,110,f.time+40);f.cards.update([...tracks,{id:'radar',title:'雷达',coverURL:cover('r')}]);assert.deepEqual(f.cards.getState().order,['a','b','c']);f.pointer('pointerup',50,110,f.time+60);f.settle();assert.deepEqual(f.cards.getState().order,['b','c','radar','a']);}finally{f.close();}});


test('pending radar metadata applies after a stationary pointer release',()=>{const f=fixture();try{f.cards.update(tracks);f.cards.activate();f.settle();f.pointer('pointerdown',150);f.cards.update([...tracks,{id:'radar',coverURL:cover('r')}]);f.pointer('pointerup',150);assert.deepEqual(f.cards.getState().order,['a','b','c','radar']);}finally{f.close();}});

test('turning on reduced motion during settle applies the pending queue and ends the transition',()=>{const f=fixture();try{f.cards.update(tracks);f.cards.activate();f.settle();f.pointer('pointerdown',150);f.pointer('pointermove',30,110,f.time+40);f.pointer('pointerup',30,110,f.time+60);for(let i=0;i<100&&f.cards.getState().phase==='exit';i++)f.paint();assert.equal(f.cards.getState().phase,'settle');f.cards.update([...tracks,{id:'radar',coverURL:cover('r')}]);f.setReduced(true);assert.equal(f.cards.getState().phase,'idle');assert.deepEqual(f.cards.getState().order,['b','c','radar','a']);assert.equal(f.frames.size,0);}finally{f.close();}});
