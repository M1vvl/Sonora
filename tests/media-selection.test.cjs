'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMediaSelection}=require('../src/media-selection.cjs');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const native={available:true,playing:true,source:'qqmusic',cover:'data:image/png;base64,QQ==',trackKey:'native'};
test('playing app takes priority, paused app yields to native player, and hidden island does not load art',async()=>{
 let reads=0;const updates=[],router=createMediaSelection({loadCover:async()=>{reads++;return 'data:image/png;base64,AA==';},onUpdate:v=>updates.push(v)});
 router.setApp({id:'1',coverURL:'cover1',playing:true});await settle();assert.equal(reads,0);router.setNative(native);router.configure(true);await settle();assert.equal(router.getStatus().source,'agentpulse');assert.equal(reads,1);
 router.setApp({id:'1',coverURL:'cover1',playing:false});assert.equal(router.getStatus().source,'qqmusic');router.setNative({...native,source:'spotify'});assert.equal(router.getStatus().source,'spotify');router.setNative({...native,playing:false});assert.equal(router.getStatus().playing,false);assert.equal(router.getStatus().available,true);router.configure(false);router.dispose();assert(updates.length>0);
});
test('late art cannot replace the newer song and repeated semantic state reuses its bounded cover',async()=>{
 const pending=new Map(),router=createMediaSelection({loadCover:key=>new Promise(resolve=>pending.set(key,resolve))});router.configure(true);router.setNative(native);router.setApp({id:'1',coverURL:'one',playing:true});await settle();router.setApp({id:'2',coverURL:'two',playing:true});await settle();pending.get('one')('old');await settle();assert.equal(router.getStatus().source,'agentpulse');assert.equal(router.getStatus().id,'2');assert.equal(router.getStatus().cover,null);pending.get('two')('new');await settle();assert.equal(router.getStatus().cover,'new');router.setApp({id:'2',coverURL:'two',playing:true});await settle();assert.equal(pending.size,2);router.setApp(null);assert.equal(router.getStatus().source,'qqmusic');router.dispose();
});
test('paused app remains controllable after hiding and revealing even before its artwork returns',async()=>{
 let reads=0,finishCover;const router=createMediaSelection({loadCover:()=>{reads++;return new Promise(resolve=>{finishCover=resolve;});}});
 router.configure(true);router.setApp({id:'paused',coverURL:'cover',playing:true});await settle();finishCover('first');await settle();
 router.setApp({id:'paused',coverURL:'cover',playing:false});router.configure(false);router.configure(true);
 assert.equal(router.getStatus().source,'agentpulse');assert.equal(router.getStatus().available,true);assert.equal(router.getStatus().canControl,true);assert.equal(router.getStatus().playing,false);assert.equal(router.getStatus().cover,null);
 await settle();assert.equal(reads,2);finishCover('second');await settle();assert.equal(router.getStatus().cover,'second');router.dispose();
});
test('restored paused app can resume without artwork while a playing native source still has priority',()=>{
 const router=createMediaSelection({loadCover:async()=>null});router.configure(true);router.setApp({id:'restored',playing:false});
 assert.equal(router.getStatus().available,true);assert.equal(router.getStatus().source,'agentpulse');assert.equal(router.getStatus().cover,null);
 router.setNative(native);assert.equal(router.getStatus().source,'qqmusic');router.dispose();
});
