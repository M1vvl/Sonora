'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createMediaMonitor,validateMedia}=require('../src/media/index.cjs');
const current={type:'media',available:true,source:'spotify',trackKey:'b'.repeat(64),title:'Track',cover:null,playing:true,position:14,duration:100,canControl:true,canToggle:true,canSeek:true,canPrevious:true,canNext:true};
test('native timeline is bounded and a valid session remains controllable when artwork is unavailable',()=>{
  const result=validateMedia({...current,position:Infinity,duration:1e9});assert.equal(result.source,'spotify');assert.equal(result.available,true);assert.equal(result.canControl,true);assert.equal(result.cover,null);assert.equal(result.position,0);assert.equal(result.duration,86400);
});

test('missing provider timeline remains unknown without losing an actual position lacking duration',()=>{
 const empty=validateMedia({...current,source:'cloudmusic',position:0,duration:0,timelineKnown:false,canSeek:false});
 assert.equal(empty.timelineKnown,false);assert.equal(empty.position,0);assert.equal(empty.canToggle,true);assert.equal(empty.canSeek,false);
 const partial=validateMedia({...current,position:12,duration:0});assert.equal(partial.position,12);assert.equal(partial.timelineKnown,true);assert.equal(partial.canSeek,false);
});

test('QQ Music, Apple Music and Spotify preserve real timelines and their independent control capabilities',()=>{
 for(const source of ['qqmusic','applemusic','spotify']){
  const result=validateMedia({...current,source,position:42,duration:240,timelineKnown:true,canSeek:false});
  assert.equal(result.source,source);assert.equal(result.timelineKnown,true);assert.equal(result.position,42);assert.equal(result.duration,240);assert.equal(result.canSeek,false);assert.equal(result.canToggle,true);assert.equal(result.canNext,true);
  const unknown=validateMedia({...current,source,position:0,duration:0,timelineKnown:false});assert.equal(unknown.timelineKnown,false);assert.equal(unknown.canSeek,false);
 }
});
test('transport commands are track-bound, acknowledged, bounded and canceled with the helper',async()=>{
  let child;const writes=[];
  const monitor=createMediaMonitor({spawn(){child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stdin:new PassThrough(),stderr:new PassThrough(),pid:1,kill(){this.emit('exit');}});child.stdin.on('data',value=>writes.push(String(value)));return child;}});
  monitor.configure({enabled:true});child.stdout.write(JSON.stringify(current)+'\n');
  try{
    assert((await monitor.control('toggle',{source:'qqmusic',trackKey:current.trackKey})).error);assert.equal(writes.length,0);
    const toggle=monitor.control('toggle',{source:current.source,trackKey:current.trackKey});const fields=writes[0].trim().split('\t');assert.equal(fields.length,6);assert.equal(fields[2],'toggle');assert.equal(fields[3],'spotify');assert.equal(fields[4],current.trackKey);
    child.stdout.write(JSON.stringify({type:'command',requestId:Number(fields[1]),ok:true})+'\n');assert.deepEqual(await toggle,{ok:true});
    assert((await monitor.control('seek',{source:current.source,trackKey:current.trackKey,position:NaN})).error);
    const seek=monitor.control('seek',{source:current.source,trackKey:current.trackKey,position:999});const next=writes.at(-1).trim().split('\t');assert.equal(next[5],'100');
    monitor.stop();assert((await seek).error);
    child.stdout.write(JSON.stringify({type:'command',requestId:Number(next[1]),ok:true})+'\n');assert.equal(monitor.getStatus().available,false);
  }finally{monitor.stop();}
});
