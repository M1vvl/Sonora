'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create}=require('../ui/music/player.js');
function fixture(api){
  const dom=new JSDOM('<section></section>',{pretendToBeVisual:true,url:'https://local.test'}),view=dom.window;
  Object.defineProperty(view.HTMLMediaElement.prototype,'paused',{configurable:true,get(){return this.__paused!==false;}});
  view.HTMLMediaElement.prototype.pause=function(){this.__paused=true;this.dispatchEvent(new view.Event('pause'));};view.HTMLMediaElement.prototype.load=function(){};
  view.HTMLMediaElement.prototype.play=function(){this.__paused=false;this.dispatchEvent(new view.Event('playing'));return Promise.resolve();};
  const player=create({root:view.document.querySelector('section'),api});
  return {view,player,close(){player.dispose();view.close();}};
}
test('player control results cover successful play, pause, offline, empty queue and disposal',async()=>{
  const f=fixture(async action=>action==='play'?{audioURL:'pulse-music-audio://stream/1'}:{});
  try{
    assert.equal((await f.player.toggle()).ok,false);assert.equal((await f.player.next()).ok,false);
    assert.equal((await f.player.play({id:'1',title:'One'})).ok,true);assert.equal((await f.player.toggle()).ok,true);assert(f.player.getAudio().paused);
    Object.defineProperty(f.view.navigator,'onLine',{get:()=>false});assert.equal((await f.player.toggle()).ok,false);
    assert.equal((await f.player.play({id:'2'})).ok,false);f.player.dispose();assert.equal((await f.player.previous()).ok,false);assert.equal((await f.player.toggle()).ok,false);
  }finally{f.close();}
});
test('a stream completing after player disposal returns cancellation instead of successful playback',async()=>{
  let finish;const f=fixture(async action=>action==='play'?new Promise(resolve=>finish=resolve):{});
  try{const pending=f.player.play({id:'1',title:'One'});f.player.dispose();finish({audioURL:'pulse-music-audio://stream/1'});const result=await pending;assert.equal(result.ok,false);assert.equal(result.cancelled,true);}finally{f.close();}
});
