'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../assets/music/source-presets');
function fixture(){
 const dom=new JSDOM('<!doctype html>',{runScripts:'outside-only'}),w=dom.window,c=dom.getInternalVMContext();
 vm.runInContext(fs.readFileSync(path.join(base,'three.r128.min.js'),'utf8'),c);
 w.scene=new w.THREE.Scene();w.camera=new w.THREE.PerspectiveCamera(42,1,.1,100);w.camera.position.z=7.6;
 const calls=[];w.renderer={autoClear:true,render(scene,camera){calls.push({scene,camera,autoClear:this.autoClear});},clearDepth(){calls.push('clearDepth');}};
 w.fx={preset:6};w.pulseSourceLyricHost={};w.particles=new w.THREE.Group();w.skullParticleGroup=new w.THREE.Group();w.stageLyrics={group:null};
 vm.runInContext(fs.readFileSync(path.join(base,'source-space.js'),'utf8'),c);
 return {dom,w,api:w.PulseSourceSpace,calls,close:()=>dom.window.close()};
}
test('native lyrics occupy independent foreground scene and all source globals restore even on error',()=>{
 const f=fixture(),{w,api,calls}=f;try{
  const visualScene=w.scene,visualCamera=w.camera,particles=w.particles,skull=w.skullParticleGroup;
  api.prepare({width:1280,height:720,settings:{visualScale:1.2,lyricScale:1.1},lyricYaw:.4,lyricPitch:-.3});
  api.withLyrics({},()=>{assert.notEqual(w.scene,visualScene);assert.notEqual(w.camera,visualCamera);assert.equal(w.fx.preset,0);assert.equal(w.skullParticleGroup,skull);w.stageLyrics.group=new w.THREE.Group();w.scene.add(w.stageLyrics.group);});
  assert.equal(w.scene,visualScene);assert.equal(w.camera,visualCamera);assert.equal(w.particles,particles);assert.equal(w.skullParticleGroup,skull);assert.equal(w.fx.preset,6);
  assert.notEqual(w.stageLyrics.group.parent,visualScene);
  assert.throws(()=>api.withLyrics({},()=>{throw new Error('expected');}),/expected/);assert.equal(w.scene,visualScene);
  api.render();assert.equal(calls.length,3);assert.equal(calls[0].scene,visualScene);assert.equal(calls[1],'clearDepth');assert.equal(calls[2].scene,w.stageLyrics.group.parent);assert.equal(calls[0].autoClear,true);assert.equal(calls[2].autoClear,false);assert.equal(w.renderer.autoClear,true);
 }finally{f.close();}
});
test('visual and lyric scales are separate, bounded and persisted by the setting model',()=>{
 const f=fixture();try{const s=require('../ui/music/visual-settings.js').normalize({visualScale:99,lyricScale:-5});assert.equal(s.visualScale,1.65);assert.equal(s.lyricScale,.55);f.api.prepare({settings:s});assert.equal(f.w.scene.scale.x,1.65);assert.equal(f.api.getState().lyricScale,.55);}finally{f.close();}
});
test('Emily source receive real normalized audio and silence decays without synthetic input',()=>{
 for(const preset of [0]){const f=fixture();try{
  let a;const bins=new Uint8Array(256);bins.fill(180);for(let i=1;i<=30;i++)a=f.w.PulseSourceAudio.project({time:i*33,playing:true,position:i/30,settings:{intensity:.85},audio:{bins,rms:.2,sampleRate:44100,fftSize:512,beat:.3}},1/30,preset);
  assert(a.bass>.1,preset+' bass');assert(a.mid>.05,preset+' mid');assert(a.treble>.05,preset+' treble');assert(a.beat>0);assert.equal(a.sourceProjected,true);
  const loud=a.bass;for(let i=31;i<100;i++)a=f.w.PulseSourceAudio.project({time:i*33,playing:false,settings:{},audio:{rms:0}},1/30,preset);assert(a.bass<loud*.02,preset+' silence');
 }finally{f.close();}}
});
test('audio projection is idempotent within a source frame and does not create a clock or audio graph',()=>{
 const f=fixture();try{const frame={time:100,position:2,playing:true,settings:{},audio:{rms:.2,bass:.2,mid:.1,treble:.08}};const a=f.w.PulseSourceAudio.project(frame,1/30,0),b=f.w.PulseSourceAudio.project(frame,1/30,0);assert.equal(a,b);const code=fs.readFileSync(path.join(base,'source-space.js'),'utf8');assert.doesNotMatch(code,/requestAnimationFrame\(|setInterval\(|AudioContext\(|WebGLRenderer\(/);}finally{f.close();}
});

test('source sub-kick band includes neighboring bins and excludes DC exactly like MineRadio',()=>{
 const f=fixture();try{
  const bins=new Uint8Array(256);bins[0]=255;bins[1]=128;
  assert.equal(f.w.PulseSourceAudio.bandRms(bins,44100,512,38,74),128/255);
  bins[1]=0;assert.equal(f.w.PulseSourceAudio.bandRms(bins,44100,512,38,74),0);
  const detailed=new Uint8Array(1024);detailed[1]=100;detailed[2]=200;detailed[3]=100;detailed[4]=200;
  assert(Math.abs(f.w.PulseSourceAudio.bandRms(detailed,44100,2048,38,74)-Math.sqrt((100**2+200**2+100**2+200**2)/4)/255)<1e-9);
 }finally{f.close();}
});
