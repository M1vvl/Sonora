const test=require('node:test');
const assert=require('node:assert/strict');
const {webURL,mediaFormat,progressRecord}=require('../src/anime-player.cjs');
test('media resolver accepts actual media paths and MIME, never URL-like query alone',()=>{
  assert.equal(mediaFormat('https://cdn.test/series/1.m3u8?token=abc'),'hls');
  assert.equal(mediaFormat('https://cdn.test/video','application/vnd.apple.mpegurl'),'hls');
  assert.equal(mediaFormat('https://cdn.test/a.mp4'),'video');
  assert.equal(mediaFormat('https://parser.test/?url=https://cdn.test/a.mp4'),null);
  assert.equal(mediaFormat('https://cdn.test/a.png','image/png'),null);
  assert.equal(webURL('file:///C:/test.mp4'),null);assert.equal(webURL('https://user:password@test.com'),null);
});
test('history progress only records actual playback and bounds invalid durations',()=>{
  const plan={subject:{id:42,title:'条目'},rule:{id:'age'},episode:{name:'第1集',url:'https://test/1'},roadIndex:0,episodeIndex:0};
  assert.equal(progressRecord(plan,{position:0,duration:1200}),null);
  assert.equal(progressRecord(plan,{position:NaN}),null);
  assert.deepEqual(progressRecord(plan,{position:12,duration:Infinity}),{subject:plan.subject,ruleId:'age',episodeName:'第1集',episodeUrl:'https://test/1',roadIndex:0,episodeIndex:0,position:12,duration:0});
});
