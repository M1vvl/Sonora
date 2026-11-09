'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {resolveNeteasePlayback,completeTrack,qualityCandidates}=require('../src/music/netease-playback.cjs');
const {createNeteaseClient}=require('../src/music/netease.cjs');
const {normalizeQuality,QUALITY_OPTIONS,describe}=require('../src/music/quality.cjs');
const song={id:'1',title:'Test recording',artist:'Artist A / Artist B',duration:180};
const empty={body:{code:200,data:[]}};
const response=(id,fields={})=>({body:{code:200,data:[{id,code:200,url:'https://m702.music.126.net/track.flac',level:'lossless',...fields}]}});
const options=()=>({cookie:{MUSIC_U:'synthetic-own-session'},signal:new AbortController().signal});
const decode=body=>{const cipher=crypto.createDecipheriv('aes-128-ecb',Buffer.from('e82ckenh8dichen8'),null);const raw=Buffer.concat([cipher.update(Buffer.from(new URLSearchParams(body).get('params'),'hex')),cipher.final()]).toString();return JSON.parse(raw.split('-36cd479b6b5-')[1]);};

test('NetEase seven visible qualities use current platform level IDs and legacy hires preference migrates separately',()=>{
 assert.deepEqual(QUALITY_OPTIONS.map(item=>item.id),['sky','jymaster','vivid','jyeffect','lossless','exhigh','standard']);
 assert.equal(normalizeQuality('hires'),'jyeffect');assert.equal(describe({level:'hires'},'jyeffect').qualityLabel,'Hi-Res');
 assert.equal(describe({level:'jyeffect'},'jyeffect').qualityLabel,'高清臻音');assert.equal(describe({level:'vivid'},'jyeffect').qualityLabel,'臻音全景声');
 assert.deepEqual(qualityCandidates('hires'),['jyeffect','lossless','exhigh','standard']);
});

test('vivid sends the original provider Android profile and MP3 mapping while sky specifies c51',async()=>{
 const requests=[],client=createNeteaseClient({fetchImpl:async(url,init)=>{requests.push({url,init,data:decode(init.body)});return new Response(JSON.stringify({code:200,data:[]}));}});
 await client.songURL('1',{...options(),quality:'vivid'});await client.songURL('1',{...options(),quality:'sky'});await client.songURLLegacy('1',{...options(),bitrate:128000});
 assert.equal(requests[0].data.level,'vivid');assert.equal(requests[0].data.encodeType,'mp3');assert.equal(requests[0].data.header.os,'android');assert.equal(requests[0].data.header.appver,'9.5.61');
 assert.equal(requests[1].data.immerseType,'c51');assert.equal(requests[1].data.header.os,'pc');assert.equal(requests[1].data.encodeType,'flac');assert.equal(requests[2].data.br,128000);assert.match(requests[2].url,/enhance\/player\/url$/);
});

test('an unavailable high tier falls back only to complete authorized lower tiers and reports its actual server level',async()=>{
 const calls=[],client={songURL:async(id,opts)=>{calls.push(opts.quality);return opts.quality==='lossless'?response(id):response(id,{url:null,level:'jyeffect'});}};
 const result=await resolveNeteasePlayback({client,key:'1',song,options:options(),requested:'jyeffect'});
 assert.deepEqual(calls,['jyeffect','lossless']);assert.equal(result.track.level,'lossless');assert.equal(result.resolvedSongId,'1');
});

test('legacy authorized URL recovery runs after bounded v1 attempts and never labels bitrate as lossless',async()=>{
 const calls=[],client={songURL:async(id,opts)=>{calls.push(opts.quality);return empty;},songURLLegacy:async(id,opts)=>{calls.push(opts.bitrate);return response(id,{level:undefined,br:128000});}};
 const result=await resolveNeteasePlayback({client,key:'1',song,options:options(),requested:'jyeffect'});
 assert.deepEqual(calls,['jyeffect','lossless','exhigh','standard',128000]);assert.equal(describe(result.track,'jyeffect').quality,'standard');
});

test('trial, mismatched IDs, explicit denial and non-NetEase hosts remain unavailable across all fallbacks',async()=>{
 for(const invalid of [{freeTrialInfo:{start:0,end:30}},{id:'2'},{code:403},{url:'https://ws.stream.qqmusic.qq.com/track'}]){
  const client={songURL:async id=>response(id,invalid),songURLLegacy:async id=>response(id,invalid)};
  await assert.rejects(resolveNeteasePlayback({client,key:'1',song,options:options(),requested:'jyeffect'}),{code:'PLAYBACK_UNAVAILABLE'});
 }
 assert(completeTrack(response('1',{code:undefined}),'1'));
});

test('only same-title whole-artist and real-duration catalog alternatives can supply an authorized stream',async()=>{
 const requested=[],client={songURL:async(id,opts)=>{requested.push(id);return id==='4'?response(id):empty;},search:async()=>({body:{code:200,result:{songs:[
  {id:2,name:'Test recording (Live)',dt:180000,ar:[{name:'Artist A'},{name:'Artist B'}]},
  {id:3,name:'Test recording',dt:180000,ar:[{name:'Artist ABC'},{name:'Artist B'}]},
  {id:4,name:'Test recording',dt:181000,ar:[{name:'Artist B'},{name:'Artist A'}]}
 ]}}})};
 const result=await resolveNeteasePlayback({client,key:'1',song,options:options(),requested:'standard'});
 assert.deepEqual(requested,['1','4']);assert.equal(result.matchedFromId,'1');assert.equal(result.resolvedSongId,'4');assert.equal(result.matchKind,'same_title_artist_duration');
});

test('canceled request cannot advance to another tier or another catalog version',async()=>{
 const controller=new AbortController(),calls=[];const client={songURL:async(id,opts)=>{calls.push(opts.quality);controller.abort();return empty;},search:async()=>{throw new Error('must not search');}};
 await assert.rejects(resolveNeteasePlayback({client,key:'1',song,options:{...options(),signal:controller.signal},requested:'jyeffect'}),{code:'CANCELLED'});assert.deepEqual(calls,['jyeffect']);
});

test('one overall resolution deadline stops lower tiers and search without a retry storm',async()=>{
 let clock=0,calls=0;const client={songURL:async()=>{calls++;clock+=13000;return empty;},songURLLegacy:async()=>{throw new Error('must not run');}};
 await assert.rejects(resolveNeteasePlayback({client,key:'1',song,options:options(),requested:'jyeffect',now:()=>clock}),{code:'PLAYBACK_UNAVAILABLE'});assert.equal(calls,1);
});
