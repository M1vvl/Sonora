'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMediaLyrics}=require('../src/media-lyrics.cjs');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const frame={available:true,playing:true,source:'qqmusic',trackKey:'one',title:'Song',artist:'Singer'};
test('external lyrics load once per track, retain a bounded cache and do not replace newer selection',async()=>{
 const pending=new Map();let changes=0;
 const service=createMediaLyrics({lookup:value=>new Promise(resolve=>pending.set(value.trackKey,resolve)),onChange:()=>changes++});
 service.update(frame);service.update(frame);await settle();assert.equal(pending.size,1);
 service.update({...frame,trackKey:'two'});await settle();pending.get('one')([{time:0,text:'old'}]);await settle();assert.equal(changes,0);
 pending.get('two')([{time:0,text:'current'}]);await settle();assert.equal(service.getLines('two')[0].text,'current');assert.equal(changes,1);
 service.update({...frame,trackKey:'two',position:5});await settle();assert.equal(pending.size,2);service.dispose();assert.equal(service.getLines('two').length,0);
});
test('restored paused external track can load lyrics when later playback begins and internal music uses its own lines',async()=>{
 let requests=0;const service=createMediaLyrics({lookup:async()=>{requests++;return [{time:0,text:'line'}];}});
 service.update({...frame,playing:false});await settle();assert.equal(requests,0);service.update(frame);await settle();assert.equal(requests,1);
 service.update({...frame,source:'agentpulse',trackKey:'app'});await settle();assert.equal(requests,1);service.dispose();
});

test('external cached lyrics reject NetEase credit JSON and damaged metadata fragments',async()=>{
 const service=createMediaLyrics({lookup:async()=>[{time:0,text:'{"c":[{"tx":"credit"}]}'},{time:1,text:'{c}'},{time:2,text:'Actual verse'}]});
 service.update(frame);await settle();assert.deepEqual(service.getLines('one'),[{time:2,text:'Actual verse'}]);service.dispose();
});

test('transient external lyric failure expires without starting a background timer or a retry storm',async()=>{
 let stamp=0,requests=0;
 const service=createMediaLyrics({now:()=>stamp,lookup:async()=>{requests++;if(requests===1)throw new Error('temporary outage');return [{time:0,text:'Recovered verse'}];}});
 service.update(frame);await settle();assert.equal(requests,1);
 for(let i=0;i<20;i++)service.update(frame);
 await settle();assert.equal(requests,1);
 stamp=30001;service.update(frame);await settle();assert.equal(requests,2);assert.equal(service.getLines('one')[0].text,'Recovered verse');
 stamp=1000000;service.update(frame);await settle();assert.equal(requests,2);
 service.dispose();
});

test('returning to a source after a pending lookup was cancelled can request that track again',async()=>{
 const finish=[];
 const service=createMediaLyrics({lookup:()=>new Promise(resolve=>finish.push(resolve))});
 service.update(frame);await settle();
 service.update({available:false});
 finish[0]([{time:0,text:'Obsolete'}]);await settle();
 service.update(frame);await settle();assert.equal(finish.length,2);
 finish[1]([{time:0,text:'Current'}]);await settle();assert.equal(service.getLines('one')[0].text,'Current');service.dispose();
});
