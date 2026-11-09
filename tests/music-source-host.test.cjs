'use strict';
// No WebGL/context, pixels or BrowserWindow: verifies source scene routing,
// metadata cadence, authenticated message boundaries and lifecycle only.
const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{create}=require('../ui/music/visual-renderer.js');
function fixture(){
 const dom=new JSDOM('<body><canvas></canvas><audio></audio>',{url:'https://fixture.invalid',pretendToBeVisual:true});
 const {window}=dom;Object.defineProperty(window.document,'hidden',{get:()=>false});
 const changes=[],engine=create({canvas:window.document.querySelector('canvas'),audio:window.document.querySelector('audio'),onLyricsState:v=>changes.push(v)});
 engine.update({preset:'cover',lyric3D:true});engine.activate();
 const sent=[];let frame=window.document.querySelector('iframe');frame.contentWindow.postMessage=data=>sent.push(data);frame.dispatchEvent(new window.Event('load'));window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,data:{type:'pulse-preset-ready',token:new URL(frame.src).searchParams.get('token')}}));
 return {dom,window,engine,sent,changes,frame,close(){engine.dispose();window.close();}};
}
test('original scenes share one host and send lyric metadata only on revision',()=>{
 const f=fixture();try{
  assert.match(f.frame.src,/standard\.html/);f.engine.setLyrics([{time:0,text:'One'}],{id:'1',title:'Track'});
  const meta=f.sent.filter(d=>d.type==='pulse-preset-lyrics');assert.equal(meta.at(-1).songId,'1');
  const count=meta.length;f.engine.setLyricPosition(36.5);f.engine.setPointer(.25,.4);f.engine.setOrbit(Math.PI*3,.2);
  assert.equal(f.sent.filter(d=>d.type==='pulse-preset-lyrics').length,count);
  const frame=f.sent.filter(d=>d.type==='pulse-preset-frame').at(-1);assert.equal(frame.position,36.5);assert.equal(frame.yaw,Math.PI*3);assert.deepEqual(frame.pointer,{x:.25,y:-.4});
  f.window.dispatchEvent(new f.window.MessageEvent('message',{source:f.frame.contentWindow,data:{type:'pulse-preset-lyrics-ready',token:'wrong',nativeLyrics:true}}));
  assert.equal(f.engine.getState().nativeLyrics,false);
  f.window.dispatchEvent(new f.window.MessageEvent('message',{source:f.frame.contentWindow,data:{type:'pulse-preset-lyrics-ready',token:new URL(f.frame.src).searchParams.get('token'),nativeLyrics:true}}));
  assert.equal(f.engine.getState().nativeLyrics,false,'script readiness cannot hide fallback before first rendered frame');
  f.window.dispatchEvent(new f.window.MessageEvent('message',{source:f.frame.contentWindow,data:{type:'pulse-preset-presented',token:new URL(f.frame.src).searchParams.get('token')}}));
  assert.equal(f.engine.getState().nativeLyrics,true);assert.equal(f.changes.at(-1),true);
 }finally{f.close();}
});
test('closing source scene resets native availability and removes host resources',()=>{
 const f=fixture();try{f.engine.deactivate();assert.equal(f.window.document.querySelector('iframe'),null);assert.equal(f.engine.getState().pendingFrame,false);assert.equal(f.window.document.querySelector('canvas').width,1);assert.ok(f.sent.some(d=>d.type==='pulse-preset-dispose'));}finally{f.close();}
});
