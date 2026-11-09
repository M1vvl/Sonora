'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'../assets/music/source-presets');

function coverFixture(){
  const images=[],canvases=[],timers=new Map();let sequence=0,redraws=0;
  class Image{constructor(){this.naturalWidth=800;this.naturalHeight=400;images.push(this);}removeAttribute(){this.src='';}}
  const makeCanvas=()=>{const value={width:0,height:0,draws:[],getContext(){return {drawImage:(...args)=>value.draws.push(args)};}};canvases.push(value);return value;};
  const state={window:{},Image,parent:{},location:{search:'?token=cover'},URLSearchParams,
    setTimeout(fn){timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),addEventListener(){},
    uniforms:Object.fromEntries(['uHasCover','uColorMixT','uHasDepth','uAiBoost'].map(name=>[name,{value:0}])),
    coverTex:{},prevCoverTex:{},coverEdgeTex:{image:makeCanvas()},updateLyricPaletteFromCover(){},
    buildEdgeAndDepth(input){const value=makeCanvas();value.width=value.height=256;value.input=input;return value;},
    document:{createElement:makeCanvas}};
  state.window.PulseEmilyRedraw=()=>redraws++;
  vm.runInNewContext(fs.readFileSync(path.join(base,'source-scene-cover.js'),'utf8'),state);
  return {state,images,canvases,timers,cover:state.window.PulseSourceCover,get redraws(){return redraws;},runTimers(){const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn());}};
}

test('Emily crops a bounded square source and reveals the original depth smoothly without fetching twice',()=>{
  const f=coverFixture();
  f.cover.set('cover-one',{playing:true,settings:{coverResolution:384}});f.images[0].onload();
  assert.equal(f.state.coverTex.image.width,512);assert.equal(f.state.coverTex.image.height,512);
  assert.deepEqual(f.state.coverTex.image.draws[0].slice(1),[200,0,400,400,0,0,512,512]);
  assert.equal(f.images[0].src,'','the decoded source image must be released');
  assert.equal(f.state.uniforms.uHasDepth.value,0);
  f.runTimers();assert.equal(f.state.uniforms.uHasDepth.value,0,'depth must not pop from zero to one');
  const initialRedraws=f.redraws;f.cover.step(.09);assert.equal(f.redraws,initialRedraws,'playing tween reuses the one scene RAF');
  assert(Math.abs(f.state.uniforms.uHasDepth.value-.5)<1e-9);
  assert(Math.abs(f.state.uniforms.uAiBoost.value-.275)<1e-9);
  f.cover.step(.09);assert.equal(f.state.uniforms.uHasDepth.value,1);assert.equal(f.state.uniforms.uAiBoost.value,.55);
  f.cover.set('cover-one',{settings:{coverResolution:384}});assert.equal(f.images.length,1);
  f.cover.set('cover-two',{playing:false,settings:{coverResolution:128}});f.images[1].onload();
  assert.equal(f.state.coverTex.image.width,256);assert.equal(f.state.prevCoverTex.image.width,256);
  const pausedRedraws=f.redraws;assert.equal(f.state.uniforms.uColorMixT.value,0);f.cover.step(.26);assert.equal(f.state.uniforms.uColorMixT.value,.5);assert.equal(f.redraws,pausedRedraws+1,'paused transitions request bounded one-shot redraws');
  f.cover.step(.26);assert.equal(f.state.uniforms.uColorMixT.value,1);
  f.cover.dispose();assert.equal(f.timers.size,0);assert.equal(f.state.coverTex.image.width,1);assert.equal(f.state.prevCoverTex.image.width,1);
});

test('Emily cancels a pending depth job and stale image when a scene is replaced or disposed',()=>{
  const f=coverFixture();f.cover.set('first',{});const late=f.images[0].onload;
  f.cover.set('second',{});late();assert.equal(f.state.uniforms.uHasCover.value,0);
  f.images[1].onload();assert.equal(f.timers.size,1);
  f.cover.dispose();assert.equal(f.timers.size,0);const before=f.redraws;f.cover.step(.5);assert.equal(f.redraws,before);
});

test('Emily material settings reach the source uniforms and use the original disabled-edge default',()=>{
  class Vector{set(value){this.value=value;return this;}copy(){return this;}}
  const uniforms=new Proxy({}, {get(target,key){return target[key]||(target[key]={value:key==='uTintColor'?new Vector():0});}});
  const context={window:{},THREE:{Raycaster:Vector,Vector2:Vector,Plane:Vector,Vector3:Vector,Quaternion:Vector},
    coverTex:{},prevCoverTex:{},coverEdgeTex:{},rippleTex:{},dotTexture:{},fx:{},bass:0,mid:0,treble:0,beatPulse:0,
    clampRange:(value,min,max)=>Math.max(min,Math.min(max,value)),normalizeHexColor:(value,fallback)=>/^#[a-f0-9]{6}$/i.test(value||'')?value:fallback,
    particles:{rotation:{x:0,y:0}},bloomParticles:{rotation:new Vector()},uniforms,canvas:{width:960,height:540},renderer:{},camera:{},gestureRotation:{},applyCoverParticleResolution(){},updateRipples(){}};
  vm.runInNewContext(fs.readFileSync(path.join(base,'emily-frame.js'),'utf8'),context);
  context.window.PulseEmilyFrame.update({settings:{}},1/60);
  assert.equal(uniforms.uEdgeEnabled.value,0);assert.equal(uniforms.uBackdropAdapt.value,.72);assert.equal(uniforms.uTintStrength.value,0);
  context.window.PulseEmilyFrame.update({settings:{edge:true,lyricBackdropAdapt:false,visualTintMode:'custom',visualTintColor:'#ff7200'}},1/60);
  assert.equal(uniforms.uEdgeEnabled.value,1);assert.equal(uniforms.uBackdropAdapt.value,0);assert.equal(uniforms.uTintStrength.value,.42);assert.equal(uniforms.uTintColor.value.value,'#ff7200');
});
