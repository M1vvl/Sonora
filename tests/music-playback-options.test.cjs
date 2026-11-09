'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseLyrics}=require('../src/music/lyrics.cjs');
const {actualQuality,describe}=require('../src/music/quality.cjs');
const {createPlayerService}=require('../src/music/player-service.cjs');
const {createMusicState}=require('../src/music/state.cjs');
function fixture(){let clock=Date.parse('2026-10-30T15:59:50Z'),lastQuality;
  const client={songs:async ids=>({body:{code:200,songs:ids.map(id=>({id,name:'真实歌曲',dt:200000,ar:[{name:'作者'}]}))}}),songURL:async(id,options)=>{lastQuality=options.quality;return {body:{code:200,data:[{id,code:200,url:'https://m7.music.126.net/audio.flac',level:'exhigh',br:320000}]}};},lyrics:async()=>({body:{code:200,lrc:{lyric:'[00:01.00]第一句\n[00:04.50]第二句'},tlyric:{lyric:'[00:01.00]Translation'}}})};
  const service=createPlayerService({client,getAuth:()=>({state:'signedOut'}),now:()=>clock});
  return {service,advance:seconds=>{clock+=seconds*1000;},get quality(){return lastQuality;}};
}
test('actual server quality is displayed independently from requested mastering and never inferred lossless from bitrate',async t=>{
  const f=fixture();t.after(()=>f.service.dispose());const result=await f.service.play({id:1,quality:'hires'});
  assert.equal(f.quality,'jyeffect');assert.equal(result.requestedQuality,'jyeffect');assert.equal(result.quality,'exhigh');assert.equal(result.degraded,true);assert.equal(result.qualityLabel,'极高 HQ');assert.equal(result.bitrate,320000);
  assert.equal(f.service.playbackOptions().quality,'jyeffect');assert.equal(f.service.playbackOptions().qualityOptions.length,7);assert(f.service.playbackOptions().sources.slice(1).every(source=>source.available===false));
  assert.equal(actualQuality({br:1999000}),'exhigh');assert.equal(actualQuality({}),'unknown');
  assert.equal(actualQuality({level:'future-unverified',br:1999000}),'unknown');assert.equal(describe({level:'lossless'},'standard').degraded,false);assert.equal(describe({level:'sky'},'hires').qualityLabel,'沉浸环绕声');
  await assert.rejects(f.service.play({id:1,quality:'fake4k'}),{code:'INVALID_QUALITY'});await assert.rejects(f.service.play({id:1,source:'qq'}),{code:'SOURCE_UNAVAILABLE'});
});
test('each of the seven NetEase requests preserves the returned tier instead of the requested badge',async t=>{
  const f=fixture();t.after(()=>f.service.dispose());
  for(const option of f.service.playbackOptions().qualityOptions){
    const result=await f.service.play({id:1,quality:option.id});
    assert.equal(f.quality,option.id);assert.equal(result.requestedQuality,option.id);assert.equal(result.quality,'exhigh');
  }
});
test('old listening days keep duration but discard track ID sets to stay within the storage budget',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pulse-music-stats-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ids=Array.from({length:300},(_,n)=>String(1000000000+n)),listening=Array.from({length:100},(_,n)=>({date:new Date(Date.UTC(2026,0,n+1)).toISOString().slice(0,10),seconds:60,ids}));
  const file=path.join(dir,'music-state.json');await fs.writeFile(file,JSON.stringify({listening}));const state=createMusicState(dir);state.preferences({quality:'hires'});
  const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(saved.listening.length,100);assert.equal(saved.listening[0].seconds,60);assert.equal(saved.listening[0].ids.length,0);assert.equal(saved.listening.at(-1).ids.length,300);assert((await fs.stat(file)).size<60000);
});
test('lyrics normalize multiple timestamps, translations, millisecond offset and bounded plain lyrics',async t=>{
  const parsed=parseLyrics({lrc:{lyric:'[offset:100]\n[00:01.25][00:03.5]歌词\n[ti:title]\n[00:10.000]第二句'},tlyric:{lyric:'[00:01.35]翻译'}});
  assert.deepEqual(parsed.lines,[{time:1.35,text:'歌词',translation:'翻译'},{time:3.6,text:'歌词'},{time:10.1,text:'第二句'}]);
  assert.equal(parseLyrics({lrc:{lyric:'纯文本歌词'}}).unsynced,'纯文本歌词');assert.equal(parseLyrics({nolyric:true}).instrumental,true);
  const f=fixture();t.after(()=>f.service.dispose());assert.equal((await f.service.lyrics({id:1})).lines[0].translation,'Translation');
});
test('structured credits and damaged JSON fragments never become lyrics',()=>{
  const raw='[00:00.000]{"t":0,"c":[{"tx":"作词"},{"tx":"作者"}]}\n[00:01.000]{"c"}\n[00:02.000]{c}\n[00:03.000]真正歌词';
  assert.deepEqual(parseLyrics({lrc:{lyric:raw}}).lines,[{time:3,text:'真正歌词'}]);
  assert.equal(parseLyrics({lrc:{lyric:'{"t":0,"c":[{"tx":"作者"}]}\n{"c"}'}}).unsynced,'');
  assert.deepEqual(parseLyrics({lrc:{lyric:'[99:00.000]纯音乐，请欣赏'}}).lines,[]);
  assert.deepEqual(parseLyrics({nolyric:true,lrc:{lyric:'[00:00.00]无歌词占位'}}).lines,[]);
  assert.equal(parseLyrics({lrc:{lyric:'[00:00.00]{A song lyric}'}}).lines[0].text,'{A song lyric}');
});
test('listening uses elapsed playback seconds, bounds inflated reports and separates Beijing dates',async t=>{
  const f=fixture();t.after(()=>f.service.dispose());await f.service.play({id:1});
  f.service.historyProgress({id:1,position:0,duration:200,listenedSeconds:0});
  f.advance(5);const first=f.service.historyProgress({id:1,position:100,duration:200,listenedSeconds:5});assert.equal(first.listening.todaySeconds,5);assert.equal(first.listening.todaySongs,1);
  const duplicate=f.service.historyProgress({id:1,position:150,duration:200,listenedSeconds:500});assert(duplicate.listening.todaySeconds<=5.25);
  f.advance(10);f.service.historyProgress({id:1,position:160,duration:200,listenedSeconds:10});assert.equal(f.service.listening().todaySongs,1);assert.equal(f.service.listening().streakDays,2);assert.equal(f.service.listening().todaySeconds,5);
});
test('listening state keeps duplicate songs unique and increments continuous days with persisted daily counts',()=>{
  const state=createMusicState(),song={id:'1',title:'曲目',artist:'作者',duration:180},at=Date.parse('2026-10-29T01:00:00Z');
  state.progress(song,10,180,at,10);state.progress(song,20,180,at+10000,10);assert.deepEqual(state.listening(at),{todaySeconds:20,todaySongs:1,streakDays:1});
  state.progress(song,30,180,at+86400000,10);assert.deepEqual(state.listening(at+86400000),{todaySeconds:10,todaySongs:1,streakDays:2});
});
