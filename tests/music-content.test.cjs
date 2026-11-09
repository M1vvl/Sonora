'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const {createPlayerService, audioURL} = require('../src/music/player-service.cjs');
const {song, playlist, image} = require('../src/music/catalog.cjs');
const {createMusicService} = require('../src/music/index.cjs');
const {createNeteaseClient} = require('../src/music/netease.cjs');
const response = body => new Response(JSON.stringify(body));
const deferred = () => { let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve}; };
const rawSong = id => ({id: Number(id), name: '歌曲 ' + id, dt: 180000, ar: [{name: '歌手'}], al: {name: '专辑', picUrl: 'http://p1.music.126.net/fixture.jpg'}});
function fixture(overrides = {}) {
  const calls = [], auth = {state: 'signedOut', cookie: {}, profile: null};
  const result = body => Promise.resolve({body: {code: 200, ...body}, cookie: {}});
  const client = {
    dailySongs: options => {calls.push({name: 'dailySongs', options}); return result({data: {dailySongs: Array.from({length: 30}, (_, index) => rawSong(index + 1))}});},
    publicSongs: options => {calls.push({name: 'publicSongs', options}); return result({result: [{song: rawSong(999)}]});},
    publicPlaylists: options => {calls.push({name: 'publicPlaylists', options}); return result({result: [{id: 100, name: '公开歌单', picUrl: 'https://p1.music.126.net/pl.jpg'}]});},
    dailyPlaylists: options => {calls.push({name: 'dailyPlaylists', options}); return result({recommend: [{id: 101, name: '私人歌单'}]});},
    search: (query, type, options) => {calls.push({name: 'search', query, type, options}); return result({result: type === 1 ? {songs: [rawSong(10)]} : {playlists: [{id: 100, name: '搜索歌单'}]}});},
    songs: (ids, options) => {calls.push({name: 'songs', ids, options}); return result({songs: ids.map(rawSong)});},
    songURL: (id, options) => {calls.push({name: 'songURL', id, options}); return result({data: [{id: Number(id), url: 'http://m7.music.126.net/fixture.mp3', code: 200, level: 'exhigh'}]});},
    playlist: (id, options) => {calls.push({name: 'playlist', id, options}); return result({playlist: {id: Number(id), name: '歌单', tracks: Array.from({length: 60}, (_, index) => rawSong(index + 1))}});},
    comments: (id, offset, options) => {calls.push({name: 'comments', id, offset, options}); return result({comments: Array.from({length: 40}, (_, index) => ({commentId: index + 1, content: '<b>真实文字评论</b>', time: 1000, likedCount: 3, user: {userId: 1234, nickname: '评论者', avatarUrl: 'https://p1c.music.126.net/user.jpg'}})), total: 100, more: true});},
    like: (id, liked, options) => {calls.push({name: 'like', id, liked, options}); return result({});}, ...overrides
  };
  return {auth, client, calls, create: options => createPlayerService({client, getAuth: () => auth, ...options})};
}
test('song/playlist normalizers preserve canonical seconds and constrain remote images', () => {
  assert.deepEqual(song(rawSong(1)), {id: '1', title: '歌曲 1', artist: '歌手', album: '专辑', coverURL: 'https://p1.music.126.net/fixture.jpg', duration: 180});
  assert.equal(song(song(rawSong(1))).duration, 180);
  assert.equal(song({id: 1, name: 'a', artists: {bad: true}}).artist, '未知歌手');
  assert.equal(song({id: '../unsafe', name: 'x'}), null); assert.equal(playlist({id: 0, name: 'x'}), null);
  assert.equal(image('https://evil.example/a.jpg'), undefined);
});
test('anonymous home uses real daily response but identifies it as public and never sends a cookie', async () => {
  const f = fixture(), service = f.create({random: () => .75}), home = await service.home();
  assert.equal(home.recommendationMode, 'public'); assert.equal(home.cards.length, 30); assert.equal(new Set(home.cards.map(value => value.id)).size, 30); assert.equal(home.songs.length, 30); assert.equal(home.recent.length, 0);
  assert.equal(home.recommendationLabel, '公开每日推荐');
  assert.equal(home.playlists[0].id, '100'); assert.ok(f.calls.every(value => Object.keys(value.options.cookie).length === 0));
  assert.ok(!f.calls.some(value => value.name === 'publicSongs'));
  assert.deepEqual((await service.home()).cards, home.cards); assert.equal(f.calls.length, 2); await service.dispose();
});
test('verified login selects personal recommendation and fallback public content is labelled honestly', async () => {
  const f = fixture(); Object.assign(f.auth, {state: 'signedIn', profile: {userId: 1234}, cookie: {MUSIC_U: 'fixture'}});
  const personal = await f.create().home(); assert.equal(personal.recommendationMode, 'personal'); assert.equal(personal.recommendationLabel, '每日推荐'); assert.ok(f.calls.some(value => value.name === 'dailyPlaylists'));
  const fallback = fixture({dailySongs: async () => ({body: {code: 301}})}); fallback.auth.state = 'signedIn'; fallback.auth.cookie = {MUSIC_U: 'fixture'};
  const home = await fallback.create().home(); assert.equal(home.songs[0].id, '999'); assert.equal(home.recommendationMode, 'public'); assert.equal(home.recommendationLabel, '公开新歌推荐');
});
test('search returns separate songs/playlists, bounded query and playlist expands a bounded song batch', async () => {
  const f = fixture(), service = f.create();
  const search = await service.search({query: ' 晴天 ' + 'x'.repeat(150)}); assert.equal(search.songs[0].id, '10'); assert.equal(search.playlists[0].id, '100');
  assert.ok(f.calls.filter(value => value.name === 'search').every(value => value.query.length === 100));
  assert.equal((await service.playlist({id: 100})).songs.length, 30);
  await assert.rejects(service.playlist({id: 'https://evil.example'}), {code: 'INVALID_PLAYLIST'});
  await service.dispose();
});
test('playlist with only track IDs hydrates at most 30 songs through the official detail adapter', async () => {
  const f = fixture({playlist: async () => ({body: {code: 200, playlist: {id: 99, name: 'ids', trackIds: Array.from({length: 100}, (_, index) => ({id: index + 1}))}}})}), service = f.create();
  assert.equal((await service.playlist({id: 99})).songs.length, 30); assert.equal(f.calls.find(value => value.name === 'songs').ids.length, 30);
});
test('play accepts only official complete authorized URLs; it does not invent history on selection', async () => {
  const f = fixture(), service = f.create(); const play = await service.play({id: 1});
  assert.equal(play.audioURL, 'https://m7.music.126.net/fixture.mp3'); assert.equal(play.playable, true);
  assert.equal((await service.home()).recent.length, 0);
  const saved = service.historyProgress({id: 1, position: 0, duration: 180}); assert.equal(saved.recent.length, 1); assert.equal(saved.recent[0].position, 0);
  await assert.rejects(service.play({id: '../../'}), {code: 'INVALID_SONG'});
  assert.throws(() => service.historyProgress({id: 2, position: 2, duration: 180}), {code: 'INVALID_PROGRESS'});
  assert.equal(audioURL('https://music.126.net.evil.example/track.mp3'), null);
  assert.equal(audioURL('https://user:pass@m7.music.126.net/x'), null);
});
test('null, trial-only and nonofficial song URLs remain actual unavailable errors with empty history', async () => {
  for (const fields of [{url: null}, {url: 'https://m7.music.126.net/test.mp3', freeTrialInfo: {start: 0, end: 30}}, {url: 'https://evil.example/track.mp3'}]) {
    const f = fixture({songURL: async id => ({body: {code: 200, data: [{id: Number(id), code: 200, ...fields}]}})}), service = f.create();
    await assert.rejects(service.play({id: 1}), {code: 'PLAYBACK_UNAVAILABLE'}); assert.equal((await service.home()).recent.length, 0);
    assert.throws(() => service.historyProgress({id: 1, position: 0}), {code: 'INVALID_PROGRESS'});
  }
});
test('like requires verified login, explicit boolean and successful upstream response before changing state', async () => {
  const f = fixture(), service = f.create(); await service.home();
  await assert.rejects(service.like({id: 1, liked: true}), {code: 'LOGIN_REQUIRED'}); assert.equal(f.calls.filter(value => value.name === 'like').length, 0);
  Object.assign(f.auth, {state: 'signedIn', cookie: {MUSIC_U: 'fixture'}, profile: {userId: 1}});
  await assert.rejects(service.like({id: 1}), {code: 'INVALID_LIKE'});
  assert.deepEqual(await service.like({id: 1, liked: true}), {id: '1', liked: true});
  assert.deepEqual(await service.like({id: 1, like: false}), {id: '1', liked: false});
  const failed = fixture({like: async () => ({body: {code: 500}})}); failed.auth.state = 'signedIn';
  await assert.rejects(failed.create().like({id: 1, liked: true}), {code: 'CONTENT_UNAVAILABLE'});
});

test('verified server liked state is projected consistently and auth changes discard its cached projection', async () => {
  const f = fixture({likes: async () => ({body: {code: 200, data: {'1': true, '2': false}}})}); Object.assign(f.auth, {state: 'signedIn', profile: {userId: 123}, cookie: {MUSIC_U: 'fixture'}});
  const service = f.create(); assert.equal((await service.home()).songs[0].liked, true);
  f.auth.state = 'signedOut'; service.authChanged(); const home = await service.home(); assert.equal(home.recommendationMode, 'public'); assert.equal(home.songs[0].liked, undefined);
});

test('a successful like response must be followed by confirmed library membership',async()=>{
 let serverLiked=false;
 const f=fixture({likes:async()=>({body:{code:200,ids:serverLiked?[1]:[]}})});Object.assign(f.auth,{state:'signedIn',profile:{userId:123}});
 const service=f.create();
 try{await assert.rejects(service.like({id:1,liked:true}),{code:'LIKE_UNCONFIRMED'});serverLiked=true;assert.deepEqual(await service.like({id:1,liked:true}),{id:'1',liked:true});}finally{await service.dispose();}
});
test('comments expose at most 20 normalized public records and constrained paging', async () => {
  const f = fixture(), service = f.create(), result = await service.comments({id: 1, offset: 999999});
  assert.equal(result.comments.length, 20); assert.equal(result.total, 100); assert.equal(result.hasMore, true);
  assert.equal(result.comments[0].nickname, '评论者'); assert.equal(result.comments[0].avatarURL, 'https://p1c.music.126.net/user.jpg');
  assert.equal(f.calls[0].offset, 1000); assert.equal(result.comments[0].content, '<b>真实文字评论</b>');
});
test('history and quality preference persist independently, deduplicate and cap at 100', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-pulse-music-content-')); t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  const f = fixture(), service = f.create({dataDir}); assert.deepEqual(service.preferences({quality: 'lossless'}), {preferences: {quality: 'lossless'}});
  for (let id = 1; id <= 105; id++) { await service.play({id}); service.historyProgress({id, position: 5, duration: 180}); }
  service.historyProgress({id: 105, position: 10, duration: 180});
  const restored = f.create({dataDir}), home = await restored.home(); assert.equal(home.recent.length, 100); assert.equal(home.recent[0].id, '105'); assert.equal(home.recent[0].position, 10); assert.equal(home.recent[99].id, '6');
  assert.equal(home.preferences.quality, 'lossless'); assert.ok(!(await fs.readFile(path.join(dataDir, 'music-state.json'), 'utf8')).includes('audioURL'));
});
test('inactive cancels only content; a new operation can start, dispose awaits entered work', async () => {
  const gate = deferred(), started = deferred(); let signal;
  const f = fixture({dailySongs: async options => {signal = options.signal; started.resolve(); await gate.promise; return {body: {code: 200, data: {dailySongs: [rawSong(1)]}}};}}), service = f.create();
  const home = service.home(), rejected = assert.rejects(home, {code: 'CANCELLED'}); await started.promise; service.inactive(); assert.equal(signal.aborted, true);
  let stopped = false; const stopping = service.dispose().then(() => {stopped = true;}); await Promise.resolve(); assert.equal(stopped, false);
  gate.resolve(); await rejected; await stopping; assert.equal(stopped, true);
  await assert.rejects(service.home(), {code: 'CANCELLED'});
});
test('client reserves auth capacity while at most two content requests run', async () => {
  const waiting = [], requests = []; let active = 0, content = 0, maxActive = 0, maxContent = 0;
  const client = createNeteaseClient({fetchImpl: async url => {
    const auth = url.includes('/login/'); active++; if (!auth) content++; maxActive = Math.max(maxActive, active); maxContent = Math.max(maxContent, content); requests.push(url);
    if (auth) { active--; return response({code: 200, unikey: 'test-auth-key-1234'}); }
    await new Promise(resolve => waiting.push(resolve)); active--; content--; return response({code: 200, result: []});
  }});
  const jobs = [client.publicSongs(), client.publicPlaylists(), client.publicSongs()]; await new Promise(setImmediate);
  assert.equal(requests.length, 2); assert.equal(await client.key(), 'test-auth-key-1234'); assert.equal(requests.length, 3);
  waiting.shift()(); await new Promise(setImmediate); waiting.splice(0).forEach(resolve => resolve()); await Promise.all(jobs);
  assert.equal(maxActive, 3); assert.equal(maxContent, 2);
});
test('service exposes content actions lazily and deactivate does not invalidate the auth QR', async () => {
  const service = createMusicService({toDataURL: async () => 'data:image/png;base64,dGVzdA==', fetchImpl: async url => {
    if (url.endsWith('/unikey')) return response({code: 200, unikey: 'test-auth-key-1234'});
    if (url.endsWith('/client/login')) return response({code: 801});
    throw new Error('Unexpected network');
  }});
  const qr = await service.beginQR(); assert.deepEqual(await service.request('deactivate'), {canceled: true});
  assert.equal((await service.checkQR(qr)).status, 'waiting'); assert.deepEqual(await service.preferences({quality: 'lossless'}), {preferences: {quality: 'lossless'}});
  await service.dispose();
});

test('bootstrap restores local audio quality preferences even when home is offline', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-pulse-music-offline-')); t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  const first = createMusicService({dataDir}); first.preferences({quality: 'hires'}); await first.dispose();
  let requests = 0; const restored = createMusicService({dataDir, fetchImpl: async () => { requests++; throw new Error('offline fixture'); }});
  const bootstrap = await restored.bootstrap(); assert.equal(requests, 0); assert.equal(bootstrap.preferences.quality, 'jyeffect');
  await assert.rejects(restored.home(), {code: 'NETWORK_UNAVAILABLE'}); assert.equal((await restored.bootstrap()).preferences.quality, 'jyeffect'); await restored.dispose();
});


test('obsolete account visibility and unknown preferences are removed without losing audio quality or history', async t => {
  const {createMusicState} = require('../src/music/state.cjs');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-pulse-music-preferences-')); t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  const file = path.join(dataDir, 'music-state.json');
  await fs.writeFile(file, JSON.stringify({version:2, preferences:{autoHideAccount:true,quality:'lossless',obsolete:'unused'}, recent:[{id:'1',title:'继续听',artist:'甲',duration:120,position:35,playedAt:1000}]}));
  const state = createMusicState(dataDir), current = state.get();
  assert.deepEqual(current.preferences, {quality:'lossless'});assert.equal(current.recent[0].position,35);
  const persisted = JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(persisted.preferences,{quality:'lossless'});assert.equal(persisted.recent[0].title,'继续听');
  assert.deepEqual(state.preferences({autoHideAccount:false}),{quality:'lossless'});
});
