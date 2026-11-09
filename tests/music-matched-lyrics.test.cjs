'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMatchedLyrics}=require('../src/music/matched-lyrics.cjs');
test('Spotify matching reuses timed lyrics only after title, credited artists and recording duration agree',async()=>{
 const calls=[],song={id:'123',title:'Song',artist:'Artist / Guest',duration:193};
 const lookup=createMatchedLyrics({request:async(action,payload)=>{calls.push({action,payload});return action==='search'?{songs:[{...song,id:'wrong',duration:220},song]}:{lines:[{time:1,text:'Line'}],timingSource:'lrc-line'};}});
 try{const target={title:'Song',artist:'Artist / Guest',duration:193};const value=await lookup.lookup(target);assert.equal(value.lyricSource,'netease');assert.equal(value.lines[0].time,1);assert.equal(calls.at(-1).payload.id,'123');value.lines[0].text='Mutated';assert.equal((await lookup.lookup(target)).lines[0].text,'Line');assert.equal(calls.length,2);}finally{lookup.dispose();}
});
test('a different artist/version is left unmatched and title-only search retains strict verification',async()=>{
 let calls=0;const lookup=createMatchedLyrics({request:async(action)=>{calls++;assert.equal(action,'search');return {songs:[{id:'wrong',title:'Song',artist:'Different',duration:193}]};}});
 try{assert.deepEqual(await lookup.lookup({title:'Song',artist:'Artist',duration:193}),{lines:[]});assert.equal(calls,2);}finally{lookup.dispose();}
});
test('disposing a pending lyric lookup prevents stale publication',async()=>{
 let release;const lookup=createMatchedLyrics({request:()=>new Promise(resolve=>{release=resolve;})});const pending=lookup.lookup({title:'Song',artist:'Artist'});lookup.dispose();release({songs:[]});assert.deepEqual(await pending,{lines:[]});
});
