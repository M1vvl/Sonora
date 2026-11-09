'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPlaybackCoordinator}=require('../src/playback-coordinator.cjs');
test('anime and movie share one player and final progress goes to the old owner before switching',async()=>{
  let options,creations=0,opened=false,position=0,plan,disposed=false;const records=[],stopped=[];
  const coordinator=createPlaybackCoordinator({createPlayer:value=>{options=value;creations++;return {async open(value){plan=value;opened=true;position=value.position||0;return {opened:true};},async close(){if(opened){await options.onProgress({subject:plan.subject,position});await options.onClosed();}opened=false;},getStatus:()=>({open:opened,video:{position}}),async dispose(){await this.close();disposed=true;}};}});
  const movie={subject:{id:'film:1'},episodeIndex:0},anime={subject:{id:17},episodeIndex:0};
  await coordinator.open('movies',movie,{onProgress:value=>records.push(['movies',value.position]),onClosed:()=>stopped.push('movies')});position=35;
  await coordinator.open('anime',anime,{onProgress:value=>records.push(['anime',value.position])});
  assert.equal(creations,1);assert.deepEqual(records,[['movies',35]]);assert.deepEqual(stopped,['movies']);assert.equal(coordinator.getStatus('movies').open,false);assert.equal(coordinator.getStatus('anime').open,true);
  await coordinator.close('movies');assert.equal(coordinator.getStatus('anime').open,true);await coordinator.dispose();assert(disposed);
});
test('same title and episode source changes preserve actual seconds without transferring position to a different title',async()=>{
  let options,status={open:false},plans=[];const coordinator=createPlaybackCoordinator({createPlayer:value=>{options=value;return {async open(plan){plans.push(plan);status={open:true,video:{position:plan.position||0}};},async close(){status={open:false};},getStatus:()=>status,async dispose(){}};}});
  await coordinator.open('movies',{subject:{id:'a'},episodeIndex:0,position:0},{});status.video.position=27;
  await coordinator.open('movies',{subject:{id:'a'},episodeIndex:0,position:0},{});assert.equal(plans[1].position,27);
  await coordinator.open('movies',{subject:{id:'b'},episodeIndex:0,position:0},{});assert.equal(plans[2].position,0);assert.equal(typeof options.onEpisode,'function');await coordinator.dispose();
});
