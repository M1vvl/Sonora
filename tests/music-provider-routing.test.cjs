'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {providerKey,providerSong}=require('../src/music/provider-song.cjs');
const {normalize}=require('../src/music/playback-state.cjs');
const {audioURL,imageURL}=require('../src/music/media-policy.cjs');
const {matchSong}=require('../src/music/song-match.cjs');

test('foreign playback resumes only bounded provider metadata with no credentials or signed URL',()=>{
  const song={id:'qq:001SongMid',source:'qq',title:'Song',artist:'Artist',duration:210,coverURL:'https://y.gtimg.cn/music/photo.jpg',url:'https://ws.stream.qqmusic.qq.com/song?token=private',cookie:'private'};
  const value=normalize({song,queue:[song],position:81});
  assert.equal(value.song.id,song.id);assert.equal(value.song.source,'qq');assert.equal(value.position,81);assert.equal(value.queue.length,1);
  assert(!JSON.stringify(value).includes('private'));
  assert.equal(providerSong({...song,source:'kugou'}),null);assert.equal(providerKey('qq:../../unsafe'),null);
  assert.equal(providerSong({id:'kugou:'+'a'.repeat(32),title:'K',duration:200}).duration,200);
});

test('provider streams and artwork use exact official CDN hosts with redirect-safe URL validation',()=>{
  for(const url of ['https://ws.stream.qqmusic.qq.com/a','https://isure.stream.qqmusic.qq.com/a','https://webfs.hw.kugou.com/a','https://fs123.kugou.com/a','https://fsandroid.tx.kugou.com/a','https://fsandroid.ali.kugou.com/a','https://fsandroid.hw.kugou.com/a'])assert(audioURL(url),url);
  for(const url of ['https://y.gtimg.cn/a','https://qpic.y.qq.com/music_cover/a','https://q1.qlogo.cn/g?b=qq&nk=10000&s=100','https://imgessl.kugou.com/a','https://imge.kugou.com/a','https://stdmusicidimg.kugou.com/a','https://p1.music.126.net/a'])assert(imageURL(url),url);
  assert.equal(imageURL('http://qpic.y.qq.com/music_cover/a').protocol,'https:');
  assert.equal(audioURL('http://fsandroid.tx.kugou.com/authorized.mp3').protocol,'https:');
  for(const url of ['http://evil.test/avatar','https://q1.qlogo.cn.evil.test/avatar','https://user:secret@q1.qlogo.cn/avatar'])assert.equal(imageURL(url),null,url);
  for(const url of ['http://ws.stream.qqmusic.qq.com/a','https://qq.com/a','https://ws.stream.qqmusic.qq.com.evil.test/a','https://fsandroid.tx.kugou.com.evil.test/a','https://user:secret@fs1.kugou.com/a','https://127.0.0.1/a','https://evil.kugou.com/a'])assert.equal(audioURL(url),null,url);
});

test('source matching requires the same title, credited artists and compatible duration',()=>{
  const target={title:'Track (Live)',artist:'One / Two',duration:210};
  const songs=[{id:'wrong-version',title:'Track',artist:'One / Two',duration:210},{id:'wrong-artist',title:target.title,artist:'Other',duration:210},{id:'wrong-duration',title:target.title,artist:'One / Two',duration:250},{id:'exact',title:target.title,artist:'Two / One',duration:211}];
  assert.equal(matchSong(target,songs).id,'exact');assert.equal(matchSong({...target,artist:''},songs),null);assert.equal(matchSong(target,songs.slice(0,3)),null);
  assert.equal(matchSong({title:'Track',artist:'A',duration:200},[{title:'Track',artist:'AB',duration:200}]),null);
});
