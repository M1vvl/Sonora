'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const base=path.join(__dirname,'../assets/music/source-presets');
test('Emily source and derived extracts retain recorded provenance and packaged bytes',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(base,'source-manifest.json'),'utf8'));
 for(const row of manifest.files){const bytes=fs.readFileSync(path.join(base,row.path));assert.equal(bytes.length,row.bytes,row.path);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),row.sha256,row.path);}
 assert.equal(manifest.files.length,4);
});
test('all source hosts include lyric dependencies once, before their scene adapter',()=>{
 const order=JSON.parse(fs.readFileSync(path.join(base,'lyrics-source/manifest.json'),'utf8')).order;
 for(const name of ['standard']){
  const html=fs.readFileSync(path.join(base,name+'.html'),'utf8');let previous=html.indexOf('lyrics-source/defaults.js');assert.ok(previous>=0);
  for(const file of ['environment.js',...order]){const token='lyrics-source/'+file,index=html.indexOf(token);assert.ok(index>previous,token);assert.equal(html.indexOf(token,index+token.length),-1);previous=index;}
  assert.ok(html.indexOf('source-lyrics-adapter.js')>previous);assert.ok(html.indexOf('emily-adapter.js')>html.indexOf('source-lyrics-adapter.js'));
  assert.match(fs.readFileSync(path.join(base,'emily-adapter.js'),'utf8'),/PulseSource(?:Lyrics|Space)\.(?:update|updateLyrics)\(/);
 }
});
test('cover palette shares one revision-bound image and cancels stale or hidden loads',()=>{
 const images=[],events={};let palettes=0,renders=0;
 class Image{constructor(){images.push(this);}removeAttribute(){this.src='';}}
 const state={window:{},Image,parent:{},location:{search:'?token=1'},URLSearchParams,setTimeout:()=>1,clearTimeout(){},
  addEventListener:(type,callback)=>events[type]=callback,uniforms:{uHasCover:{value:0},uColorMixT:{value:0},uHasDepth:{value:0},uAiBoost:{value:0}},coverTex:{},prevCoverTex:{},scene:{},camera:{},
  PulseSourceLyrics:{update(){}},renderer:{render(){renders++;}},updateLyricPaletteFromCover(){palettes++;},document:{createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}})})}};
 vm.runInNewContext(fs.readFileSync(path.join(base,'source-scene-cover.js'),'utf8'),state);
 state.window.PulseEmilyRedraw=()=>{renders++;};const cover=state.window.PulseSourceCover;cover.set('cover-a',{});const late=images[0].onload;cover.set('cover-b',{});
 assert.equal(images[0].src,'');assert.equal(images[0].onload,null);late();assert.equal(palettes,0);
 images[1].onload();assert.equal(palettes,1);assert.equal(renders,1);cover.set('cover-b',{});assert.equal(images.length,2);
 cover.set('cover-c',{});cover.dispose();assert.ok(images.every(image=>!image.src));
});
test('Emily preset off hides both particle layers while retaining the lyric renderer',()=>{
 class Vector {set(){} copy(){} }
 const particles={visible:true,rotation:{x:0,y:0}},bloomParticles={visible:true,rotation:new Vector()};
 let resolutionChanges=0,ripples=0;
 const uniforms=new Proxy({}, {get(target,key){return target[key]||(target[key]={value:key==='uTintColor'?new Vector():0});}});
 const context={window:{},THREE:{Raycaster:Vector,Vector2:Vector,Plane:Vector,Vector3:Vector,Quaternion:Vector},
   coverTex:{},prevCoverTex:{},coverEdgeTex:{},rippleTex:{},dotTexture:{},fx:{},bass:0,mid:0,treble:0,beatPulse:0,
   clampRange:(value,min,max)=>Math.max(min,Math.min(max,value)),normalizeHexColor:(value,fallback)=>value||fallback,particles,bloomParticles,uniforms,
   canvas:{width:960,height:540},renderer:{},camera:{},gestureRotation:{},
   applyCoverParticleResolution(){resolutionChanges++;},updateRipples(){ripples++;}};
 vm.runInNewContext(fs.readFileSync(path.join(base,'emily-frame.js'),'utf8'),context);
 context.window.PulseEmilyFrame.update({settings:{visualEnabled:false,bloom:true}},1/60);
 assert.equal(particles.visible,false);assert.equal(bloomParticles.visible,false);
 assert.equal(resolutionChanges,0);assert.equal(ripples,0);
 context.window.PulseEmilyFrame.update({settings:{visualEnabled:true,bloom:true}},1/60);
 assert.equal(particles.visible,true);assert.equal(bloomParticles.visible,true);
 assert.equal(resolutionChanges,1);assert.equal(ripples,1);
 context.window.PulseEmilyFrame.update({settings:{visualEnabled:true,preset:'topography',bloom:true}},1/60);
 assert.equal(particles.visible,true);assert.equal(bloomParticles.visible,true);
 assert.equal(uniforms.uPreset.value,7);
 assert.equal(resolutionChanges,1);assert.equal(ripples,2,'Sonic retains the source star-river clock');
 context.window.PulseEmilyFrame.update({settings:{visualEnabled:true,preset:'topography',backgroundStarRiver:false}},1/60);
 assert.equal(particles.visible,false);assert.equal(uniforms.uAlpha.value,1);
});
