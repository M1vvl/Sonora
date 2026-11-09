'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create}=require('../ui/music/visual-renderer.js');
function fixture({reduced=false}={}){
 const dom=new JSDOM('<body><canvas></canvas><audio src="https://test.invalid/live"></audio></body>',{url:'https://test.invalid',pretendToBeVisual:true}),view=dom.window,document=view.document,audio=document.querySelector('audio'),jobs=new Map(),notices=[];let playing=true,id=0,graphs=0;
 Object.defineProperty(document,'hidden',{get:()=>false});Object.defineProperty(audio,'paused',{get:()=>!playing});Object.defineProperty(audio,'duration',{get:()=>240});view.matchMedia=()=>({matches:reduced,addEventListener(){},removeEventListener(){}});
 view.requestAnimationFrame=callback=>{jobs.set(++id,callback);return id;};view.cancelAnimationFrame=key=>jobs.delete(key);
 view.AudioContext=class {constructor(){graphs++;this.sampleRate=48000;this.currentTime=1;this.state='running';this.destination={};}createMediaElementSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {fftSize:512,connect(){},disconnect(){},getByteFrequencyData:b=>b.fill(120),getFloatTimeDomainData:b=>b.fill(.2)};}resume(){return Promise.resolve();}suspend(){return Promise.resolve();}close(){return Promise.resolve();}};
 const engine=create({canvas:document.querySelector('canvas'),audio,onNotice:value=>notices.push(value)});engine.activate();
 function latest(){return Array.from(document.querySelectorAll('iframe')).sort((a,b)=>Number(new URL(a.src).searchParams.get('token'))-Number(new URL(b.src).searchParams.get('token'))).at(-1);}
 function message(node,type,extra={}){view.dispatchEvent(new view.MessageEvent('message',{source:node.contentWindow,data:{type,token:new URL(node.src).searchParams.get('token'),...extra}}));}
 function ready(node=latest()){const sent=[];node.contentWindow.postMessage=value=>sent.push(value);message(node,'pulse-preset-ready');return sent;}
 return {view,document,audio,engine,jobs,notices,latest,ready,message,graphs:()=>graphs,tick(time){const work=Array.from(jobs);jobs.clear();for(const [,callback]of work)callback(time);},pause(){playing=false;audio.dispatchEvent(new view.Event('pause'));},close(){engine.dispose();view.close();}};
}
test('live playback clock and real spectrum update without mouse, including reduced motion',()=>{
 const f=fixture({reduced:true});try{const sent=f.ready();assert.equal(f.graphs(),1);f.audio.currentTime=21;f.tick(1000);f.audio.currentTime=22;f.tick(1200);const frames=sent.filter(d=>d.type==='pulse-preset-frame');assert.equal(frames.at(-1).position,22);assert(frames.at(-1).audio.bass>0);assert.equal(frames.at(-1).audio.sampleRate,48000);assert.equal(frames.at(-1).reducedMotion,true);assert(f.jobs.size>0);f.pause();assert.equal(f.jobs.size,0);assert.equal(sent.at(-1).playing,false);}finally{f.close();}
});
test('legacy removed preset values cannot create another source context',()=>{
 const f=fixture();try{const initial=f.latest();f.ready();f.message(initial,'pulse-preset-presented',{nativeLyrics:true});f.engine.update({preset:'planet'});assert.equal(f.latest(),initial);assert.equal(f.engine.getState().preset,'cover');assert.equal(f.document.querySelectorAll('iframe').length,1);f.engine.deactivate();assert.equal(f.document.querySelectorAll('iframe').length,0);assert.equal(f.jobs.size,0);}finally{f.close();}
});
