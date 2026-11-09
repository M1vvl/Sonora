'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {installMusicBridge}=require('../src/music-bridge.cjs');

function fixture(platformResult){
 const calls=[];
 const bridge=installMusicBridge({dataDir:null,isDashboard:()=>true,
  electron:{ipcMain:{handle(){},removeHandler(){}},protocol:{handle(){},unhandle(){}},session:{},safeStorage:{}},
  factories:{
   createService:()=>({request:async(action)=>{calls.push('netease:'+action);return action==='search'?{songs:[{id:'ne',title:'Track',artist:'Artist',duration:200}]}:{lines:[{time:0,text:'Public verse'}]};},dispose:async()=>{}}),
   createPlatformLogin:()=>({request:async payload=>{calls.push(payload.provider+':'+payload.action);return platformResult(payload);},dispose:async()=>{}}),
  }});
 return {bridge,calls};
}

test('external QQ lyrics prefer the exact song from its own authorized catalog',async t=>{
 const f=fixture(payload=>payload.action==='search'?{songs:[{id:'qq:track',title:'Track',artist:'Artist',duration:200}]}:{lines:[{time:0,text:'QQ verse'}]});
 t.after(()=>f.bridge.dispose());
 const lines=await f.bridge.findMediaLyrics({source:'qqmusic',title:'Track',artist:'Artist',duration:200});
 assert.equal(lines[0].text,'QQ verse');assert.deepEqual(f.calls,['qq:search','qq:lyrics']);
});

test('external lyric lookup rejects a different version before public strict matching',async t=>{
 const f=fixture(()=>({songs:[{id:'qq:wrong',title:'Track (Live)',artist:'Artist',duration:200}]}));
 t.after(()=>f.bridge.dispose());
 const lines=await f.bridge.findMediaLyrics({source:'qqmusic',title:'Track',artist:'Artist',duration:200});
 assert.equal(lines[0].text,'Public verse');assert.deepEqual(f.calls,['qq:search','netease:search','netease:lyrics']);
});
