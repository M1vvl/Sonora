'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create}=require('../ui/music/player.js');
const song={id:'spotify:1234567890ABCDEFGHIJKL',title:'Fixture',artist:'Artist',source:'spotify',duration:180};
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
function fixture({now}={}){
  const dom=new JSDOM('<div id="player"></div>',{url:'https://local.test',pretendToBeVisual:true}),view=dom.window,calls=[],errors=[];let playing=true,position=12;
  view.HTMLMediaElement.prototype.load=function(){};view.HTMLMediaElement.prototype.pause=function(){this.dispatchEvent(new view.Event('pause'));};view.HTMLMediaElement.prototype.play=async function(){throw new Error('Spotify must not use the local audio element');};
  const root=view.document.querySelector('#player'),player=create({root,now,onError:value=>errors.push(value),api:async(action,payload)=>{
    calls.push({action,payload});
    if(action==='play')return {remote:true,source:'spotify',song,qualityOptions:[{id:'client',label:'在 Spotify 客户端设置音质'}]};
    if(action==='platformRequest'&&payload.action==='playerState')return {song,playing,position,volume:.6};
    if(action==='platformRequest'&&payload.action==='playerControl'){if(payload.control==='pause')playing=false;if(payload.control==='resume')playing=true;if(payload.control==='seek')position=payload.position;return {ok:true};}
    if(action==='like')return {id:song.id,liked:payload.liked};
    return {};
  }});return {dom,root,player,calls,errors,close(){player.dispose();dom.window.close();}};
}
test('Spotify Connect uses one existing audio element without attaching a URL and routes pause, resume, seek and likes',async()=>{
  const f=fixture();try{
    await f.player.play(song,{queue:[song]});await settle();assert.equal(f.root.querySelectorAll('audio').length,1);assert.equal(f.player.getAudio().getAttribute('src'),null);assert.equal(f.player.getState().remote,true);assert.equal(f.player.getState().phase,'playing');assert.equal(f.player.getState().position,12);
    await f.player.toggle();assert.equal(f.player.getState().phase,'paused');await f.player.toggle();assert.equal(f.player.getState().phase,'playing');assert.equal((await f.player.seek(42)).ok,true);assert.equal(f.player.getState().position,42);
    f.root.querySelector('[data-player-action=like]').click();await settle();assert.equal(f.player.getSong().liked,true);assert.equal(f.calls.find(row=>row.action==='like').payload.source,'spotify');assert(!f.errors.length);
  }finally{f.close();}
});
test('clearing the remote queue cancels polling and requests actual Spotify playback shutdown',async()=>{
  const f=fixture();try{await f.player.play(song,{queue:[song]});await settle();f.player.clearQueue();await settle();assert.equal(f.player.getState().remote,false);assert.equal(f.player.getState().phase,'idle');assert(f.calls.some(row=>row.action==='stopAudio'));}finally{f.close();}
});

test('remote playback polls twice per second and smooths only the progress nodes between real samples',async()=>{
 let now=0,id=0;const f=fixture({now:()=>now}),frames=new Map(),timers=new Map();
 f.dom.window.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};f.dom.window.cancelAnimationFrame=key=>frames.delete(key);
 f.dom.window.setTimeout=(fn,delay)=>{timers.set(++id,{fn,delay});return id;};f.dom.window.clearTimeout=key=>timers.delete(key);
 try{
  f.player.activate();await f.player.play(song,{queue:[song]});await settle();
  assert([...timers.values()].some(value=>value.delay===500));assert.equal(frames.size,1);
  const seek=f.root.querySelector('.music-seek'),button=f.root.querySelector('[data-player-action=toggle] svg');
  now=250;for(const [key,fn]of [...frames]){frames.delete(key);fn(250);}assert.equal(Number(seek.value),12.25);assert.equal(f.root.querySelector('[data-player-action=toggle] svg'),button);
  f.player.deactivate();assert.equal(frames.size,0);f.player.activate();assert.equal(frames.size,1);await f.player.toggle();assert.equal(frames.size,0);assert.equal(f.player.getState().phase,'paused');
 }finally{f.close();assert.equal(frames.size,0);}
});
