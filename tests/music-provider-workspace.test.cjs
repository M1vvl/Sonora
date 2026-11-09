'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createMusicState} = require('../src/music/state.cjs');
const {createProviderWorkspace} = require('../src/music/provider-workspace.cjs');
const {installMusicBridge} = require('../src/music-bridge.cjs');

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
}
function fixture({saved = 'netease', platform, netease} = {}) {
  let preferences = {activeProvider: saved, quality: 'lossless'};
  const neteaseCalls = [], platformCalls = [], changes = [];
  const workspace = createProviderWorkspace({
    requestNetease(action, payload) {
      neteaseCalls.push({action, payload});
      if (netease) {
        const result = netease(action, payload);
        if (result !== undefined) return result;
      }
      if (action === 'preferences') {
        preferences = {...preferences, ...payload};
        return {preferences: {...preferences}};
      }
      if (action === 'listening') return {todaySeconds: 10, todaySongs: 1, streakDays: 1};
      if (action === 'bootstrap') return {profile: {nickname: 'NetEase'}};
      return {songs: [{id: '1', title: 'NetEase song'}]};
    },
    async requestPlatform(payload) {
      platformCalls.push(payload);
      if (platform) {
        const result = await platform(payload);
        if (result !== undefined) return result;
      }
      if (payload.action === 'profile') return {apiConnected: true, profile: {nickname: payload.provider}};
      if (payload.action === 'playlists') return {playlists: [{id: payload.provider + ':list', title: payload.provider}]};
      return {songs: [{id: payload.provider + ':song', source: payload.provider, title: payload.provider + ' song'}]};
    },
    onChange(value) {changes.push(value);}
  });
  return {workspace, neteaseCalls, platformCalls, changes, preferences: () => preferences};
}

test('verified Spotify web accounts select the official workspace without OAuth catalog requests', async t => {
  const calls = [], profile = {userId: 'owned', nickname: 'Listener', avatarURL: 'https://i.scdn.co/avatar'};
  let preferences = {activeProvider: 'netease'};
  const workspace = createProviderWorkspace({
    requestNetease: async (action, value) => {assert.equal(action, 'preferences');preferences = {...preferences, ...value};return {preferences};},
    requestPlatform: async value => {calls.push(value);throw new Error('No API client needed');},
    platformStatus: async () => ({webAuthenticated: true, webProfile: profile, apiConnected: false})
  });t.after(() => workspace.dispose());
  const selected = await workspace.select({provider: 'spotify'});
  assert.equal(selected.webPlayer, true);assert.equal(selected.apiConnected, false);assert.equal(preferences.activeProvider, 'spotify');
  const home = await workspace.request('home');assert.equal(home.provider, 'spotify');assert.equal(home.webPlayer, true);assert.equal(home.profile.nickname, 'Listener');assert.deepEqual(home.playlists, []);assert.equal(calls.length, 0);
  assert.equal((await workspace.state()).webAuthenticated, true);
});

test('saved browser cookies alone cannot select the Spotify workspace', async t => {
  const workspace = createProviderWorkspace({requestNetease: async () => ({preferences: {}}), requestPlatform: async () => ({}), platformStatus: async () => ({sessionSaved: true, webAuthenticated: false})});
  t.after(() => workspace.dispose());await assert.rejects(workspace.select({provider: 'spotify'}), /登录 Spotify/);
});

test('genuinely API-authorized Spotify accounts use the Sonara catalog instead of the website surface',async t=>{
 const calls=[],profile={userId:'owned',nickname:'Listener'};
 const workspace=createProviderWorkspace({requestNetease:async()=>({preferences:{}}),platformStatus:async()=>({apiConnected:true,profile,webAuthenticated:true}),requestPlatform:async value=>{calls.push(value);return {songs:[{id:'spotify:1234567890ABCDEFGHIJKL',title:'Song',source:'spotify'}],playlists:[],cards:[]};}});
 t.after(()=>workspace.dispose());const selected=await workspace.select({provider:'spotify'});assert.equal(selected.webPlayer,false);
 const home=await workspace.request('home');assert.notEqual(home.webPlayer,true);assert.equal(home.songs[0].source,'spotify');assert(calls.some(value=>value.action==='home'));
});

test('active provider survives a new state store and invalid provider input preserves it', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sonara-provider-state-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const original = createMusicState(directory);
  original.preferences({activeProvider: 'qq', quality: 'lossless'});
  original.preferences({activeProvider: 'untrusted', cookie: 'must-not-save'});
  const reopened = createMusicState(directory);
  assert.deepEqual(reopened.preferences(), {activeProvider: 'qq', quality: 'lossless'});
  assert(!fs.readFileSync(path.join(directory, 'music-state.json'), 'utf8').includes('must-not-save'));
});

test('a reopened foreign workspace verifies that platform and routes its catalog without a NetEase catalog fallback', async t => {
  const f = fixture({saved: 'qq'});
  t.after(() => f.workspace.dispose());
  assert.equal((await f.workspace.state()).provider, 'qq');
  const home = await f.workspace.request('home');
  assert.equal(home.profile.nickname, 'qq');
  assert.deepEqual(home.playlists.map(value => value.id), ['qq:list']);
  assert.deepEqual(home.cards.map(value => value.id), ['qq:song']);
  await f.workspace.request('search', {query: 'Night City'});
  await f.workspace.request('userPlaylists');
  assert(f.platformCalls.some(value => value.action === 'search' && value.provider === 'qq'));
  assert(f.platformCalls.some(value => value.action === 'playlists' && value.provider === 'qq'));
  assert(f.neteaseCalls.every(value => ['preferences', 'listening'].includes(value.action)));
  assert.equal((await f.workspace.request('discovery', {mode: 'daily'})).songs[0].source, 'qq');
  assert(f.platformCalls.some(value => value.action === 'discovery' && value.provider === 'qq'));
});

test('provider home preserves its real recommendations and labels while excluding other platforms', async t => {
  const f = fixture({saved: 'qq', platform: async payload => {
    if (payload.action === 'home') return {
      playlists: [{id: 'qq:public', title: 'QQ editorial'}, {id: '1', title: 'NetEase row'}],
      songs: [{id: 'qq:chart-song', title: 'Chart track'}],
      cards: [{id: 'qq:chart-song', title: 'Chart track'}],
      discoveryModes: ['daily', 'radar'], discoveryLabels: {daily: '热歌精选', radar: '新歌首发'},
      recommendationMode: 'public', recommendationLabel: 'QQ 音乐 · 热歌精选',
    };
  }});
  t.after(() => f.workspace.dispose());
  const home = await f.workspace.request('home');
  assert.deepEqual(home.playlists.map(value => value.id), ['qq:public']);
  assert.equal(home.songs[0].id, 'qq:chart-song');
  assert.equal(home.discoveryLabels.radar, '新歌首发');
  assert.equal(home.recommendationMode, 'public');
  assert(!f.platformCalls.some(value => value.action === 'playlist'));
});

test('library fallback continues past an empty built-in list to playable account songs', async t => {
  const f = fixture({saved: 'kugou', platform: async payload => {
    if (payload.action === 'home') throw new Error('temporary recommendation outage');
    if (payload.action === 'playlists') return {playlists: [{id: 'kugou:empty'}, {id: 'kugou:full'}]};
    if (payload.action === 'playlist') return {songs: payload.id.endsWith('full') ? [{id: 'kugou:track', title: 'Track'}] : []};
  }});
  t.after(() => f.workspace.dispose());
  assert.equal((await f.workspace.request('home')).songs[0].id, 'kugou:track');
});

test('restoring a different identity on the same platform expires its cached recommendations', async t => {
  let owner = 'first';
  const f = fixture({saved: 'qq', platform: async payload => {
    if (payload.action === 'profile') return {apiConnected: true, profile: {userId: owner, nickname: owner}};
    if (payload.action === 'home') return {playlists: [], songs: [{id: 'qq:' + owner, title: owner}]};
  }});
  t.after(() => f.workspace.dispose());
  assert.equal((await f.workspace.request('home')).songs[0].id, 'qq:first');
  owner = 'second';
  await f.workspace.state();
  assert.equal((await f.workspace.request('home')).songs[0].id, 'qq:second');
});

test('unverified saved account stays selected and reports its failure without loading NetEase songs', async t => {
  const f = fixture({saved: 'kugou', platform: async payload => {
    if (payload.action === 'profile') return {apiConnected: false, profile: null};
  }});
  t.after(() => f.workspace.dispose());
  const state = await f.workspace.state();
  assert.equal(state.provider, 'kugou');
  assert.equal(state.apiConnected, false);
  assert.match(state.message, /扫码登录/);
  assert.equal(Object.hasOwn(state, 'error'), false);
  await assert.rejects(f.workspace.request('home'), /扫码登录/);
  assert(f.neteaseCalls.every(value => value.action === 'preferences'));
  assert.equal(f.preferences().activeProvider, 'kugou');
});

test('a failed provider verification preserves the committed account and its persisted selection', async t => {
  const f = fixture({platform: async payload => {
    if (payload.provider === 'kugou' && payload.action === 'profile') throw new Error('official verification unavailable');
  }});
  t.after(() => f.workspace.dispose());
  await f.workspace.select({provider: 'qq'});
  await assert.rejects(f.workspace.select({provider: 'kugou'}), /unavailable/);
  assert.equal((await f.workspace.state()).provider, 'qq');
  assert.equal(f.preferences().activeProvider, 'qq');
  assert.equal(f.changes.length, 1);
});

test('one inaccessible first playlist does not hide the available account playlists', async t => {
  const f = fixture({saved: 'qq', platform: async payload => {
    if (payload.action === 'playlists') return {playlists: [{id: 'qq:private', title: 'Private'}, {id: 'qq:second', title: 'Second'}, {id: '1', title: 'foreign row'}]};
    if (payload.action === 'playlist') throw new Error('private playlist unavailable');
  }});
  t.after(() => f.workspace.dispose());
  const home = await f.workspace.request('home');
  assert.deepEqual(home.playlists.map(value => value.id), ['qq:private', 'qq:second']);
  assert.deepEqual(home.songs, []);
});

test('an old foreign catalog result cannot overwrite a newly selected provider', async t => {
  const old = deferred();
  const f = fixture({saved: 'qq', platform: async payload => {
    if (payload.provider === 'qq' && payload.action === 'playlists') return old.promise;
  }});
  t.after(() => f.workspace.dispose());
  const earlier = f.workspace.request('home');
  const rejected = assert.rejects(earlier, /已切换/);
  await settle();
  await f.workspace.select({provider: 'kugou'});
  old.resolve({playlists: [{id: 'qq:old', title: 'Old'}]});
  await rejected;
  const current = await f.workspace.request('home');
  assert.equal(current.provider, 'kugou');
  assert.deepEqual(current.playlists.map(value => value.id), ['kugou:list']);
});

test('an old NetEase catalog result is invalidated after a foreign account selection', async t => {
  const old = deferred();
  const f = fixture({netease: action => action === 'home' ? old.promise : undefined});
  t.after(() => f.workspace.dispose());
  const earlier = f.workspace.request('home');
  const rejected = assert.rejects(earlier, /已切换/);
  await settle();
  await f.workspace.select({provider: 'qq'});
  old.resolve({songs: [{id: '1', title: 'Old NetEase result'}]});
  await rejected;
});

test('browsing started during provider verification expires when that selection commits', async t => {
  const account = deferred(), old = deferred();
  const f = fixture({netease: action => action === 'search' ? old.promise : undefined, platform: async payload => {
    if (payload.action === 'profile' && payload.provider === 'qq') return account.promise;
  }});
  t.after(() => f.workspace.dispose());
  const selecting = f.workspace.select({provider: 'qq'});
  await settle();
  const earlier = f.workspace.request('search', {query: 'Old account query'});
  const rejected = assert.rejects(earlier, /已切换/);
  await settle();
  account.resolve({apiConnected: true, profile: {nickname: 'QQ account'}});
  await selecting;
  old.resolve({songs: [{id: '1', title: 'Old account result'}]});
  await rejected;
  assert.equal((await f.workspace.state()).provider, 'qq');
});

test('a superseded pending selection cannot leave another provider persisted on restart', async t => {
  const olderWrite = deferred();
  let stored = 'netease';
  const f = fixture({netease(action, payload) {
    if (action !== 'preferences') return undefined;
    if (payload.activeProvider === 'qq') return olderWrite.promise.then(() => {
      stored = 'qq';
      return {preferences: {activeProvider: stored}};
    });
    if (payload.activeProvider) stored = payload.activeProvider;
    return {preferences: {activeProvider: stored}};
  }});
  t.after(() => f.workspace.dispose());
  const first = f.workspace.select({provider: 'qq'});
  const rejected = assert.rejects(first, /已切换/);
  await settle();
  const second = f.workspace.select({provider: 'kugou'});
  await settle();
  olderWrite.resolve();
  await rejected;
  await second;
  assert.equal((await f.workspace.state()).provider, 'kugou');
  assert.equal(stored, 'kugou');
});

test('a failed newer selection restores the committed provider after an obsolete save completes', async t => {
  const olderWrite = deferred();
  let stored = 'netease';
  const f = fixture({netease(action, payload) {
    if (action !== 'preferences') return undefined;
    if (payload.activeProvider === 'qq') return olderWrite.promise.then(() => {
      stored = 'qq';
      return {preferences: {activeProvider: stored}};
    });
    if (payload.activeProvider) stored = payload.activeProvider;
    return {preferences: {activeProvider: stored}};
  }, platform: async payload => {
    if (payload.provider === 'kugou' && payload.action === 'profile') throw new Error('newer account failed verification');
  }});
  t.after(() => f.workspace.dispose());
  const first = f.workspace.select({provider: 'qq'});
  const rejected = assert.rejects(first, /已切换/);
  await settle();
  await assert.rejects(f.workspace.select({provider: 'kugou'}), /failed verification/);
  olderWrite.resolve();
  await rejected;
  assert.equal((await f.workspace.state()).provider, 'netease');
  assert.equal(stored, 'netease');
  assert.deepEqual(f.changes, []);
});

test('provider verification failure clears previously cached authenticated home data', async t => {
  let verified = true;
  const f = fixture({saved: 'qq', platform: async payload => {
    if (payload.action === 'profile') return {apiConnected: verified, profile: verified ? {nickname: 'QQ account'} : null};
  }});
  t.after(() => f.workspace.dispose());
  assert.equal((await f.workspace.request('home')).profile.nickname, 'QQ account');
  verified = false;
  const state = await f.workspace.state();
  assert.equal(state.provider, 'qq');
  assert.equal(state.apiConnected, false);
  assert.equal(state.profile, null);
  assert.match(state.message, /扫码登录/);
  await assert.rejects(f.workspace.request('home'), /扫码登录/);
});

for (const finishBeforeCommit of [true, false]) {
  test('same-platform account revalidation clears old home ' + (finishBeforeCommit ? 'cached during verification' : 'still pending at commit'), async t => {
    const verification = deferred(), oldPlaylists = deferred();
    let profileReads = 0, playlistReads = 0;
    const f = fixture({saved: 'qq', platform: async payload => {
      if (payload.action === 'profile') {
        profileReads++;
        if (profileReads === 2) return verification.promise;
        return {apiConnected: true, profile: {nickname: profileReads === 1 ? 'Previous account' : 'Current account'}};
      }
      if (payload.action === 'playlists') {
        playlistReads++;
        if (playlistReads === 1) return oldPlaylists.promise;
        return {playlists: [{id: 'qq:current-list', title: 'Current account playlist'}]};
      }
      if (payload.action === 'playlist') {
        return {songs: [{id: payload.id === 'qq:old-list' ? 'qq:old-song' : 'qq:current-song', source: 'qq', title: payload.id}]};
      }
    }});
    t.after(() => f.workspace.dispose());
    await f.workspace.state();
    const selecting = f.workspace.select({provider: 'qq'});
    await settle();
    const previousHome = f.workspace.request('home');
    const rejected = finishBeforeCommit ? null : assert.rejects(previousHome, /已切换/);
    await settle();
    if (finishBeforeCommit) {
      oldPlaylists.resolve({playlists: [{id: 'qq:old-list', title: 'Previous account playlist'}]});
      assert.equal((await previousHome).playlists[0].id, 'qq:old-list');
    }
    verification.resolve({apiConnected: true, profile: {nickname: 'Current account'}});
    await selecting;
    const current = await f.workspace.request('home');
    assert.equal(current.profile.nickname, 'Current account');
    assert.deepEqual(current.playlists.map(value => value.id), ['qq:current-list']);
    assert.deepEqual(current.songs.map(value => value.id), ['qq:current-song']);
    if (!finishBeforeCommit) {
      oldPlaylists.resolve({playlists: [{id: 'qq:old-list', title: 'Previous account playlist'}]});
      await rejected;
    }
    const reused = await f.workspace.request('home');
    assert.equal(reused.profile.nickname, 'Current account');
    assert.equal(reused.playlists[0].id, 'qq:current-list');
    assert.equal(playlistReads, 2);
  });
}

test('bridge account selection routes browsing while preserving the already prepared audio stream', async t => {
  const handlers = new Map(), protocols = new Map(), calls = [], events = [];
  let preferences = {activeProvider: 'netease'};
  const service = {
    request(action, payload = {}) {
      calls.push({kind: 'netease', action});
      if (action === 'preferences') {
        preferences = {...preferences, ...payload};
        return {preferences};
      }
      if (action === 'play') return {song: {id: '1', title: 'Current'}, audioURL: 'https://m7.music.126.net/current'};
      if (action === 'listening') return {};
      return {state: 'signedOut'};
    },
    getState: () => ({}),
    dispose: async () => {}
  };
  const platform = {
    async request(payload) {
      calls.push({kind: payload.provider, action: payload.action});
      if (payload.action === 'profile') return {apiConnected: true, profile: {nickname: 'QQ account'}};
      if (payload.action === 'playlists') return {playlists: [{id: 'qq:list', title: 'QQ list'}]};
      return {songs: [{id: 'qq:track', source: 'qq', title: 'QQ track'}]};
    },
    dispose: async () => {}
  };
  const bridge = installMusicBridge({dataDir: null, isDashboard: () => true,
    getHostWindow: () => ({webContents: {isDestroyed: () => false, send: (...args) => events.push(args)}}),
    electron: {
      ipcMain: {handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name)},
      protocol: {handle: (name, fn) => protocols.set(name, fn), unhandle: name => protocols.delete(name)},
      session: {fromPartition: () => ({setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, fetch: async () => new Response('audio sample'), closeAllConnections: async () => {}})},
      safeStorage: {}
    }, factories: {createService: () => service, createPlatformLogin: () => platform}
  });
  t.after(() => bridge.dispose());
  const invoke = (action, payload) => handlers.get('pulse:music')({}, action, payload);
  const current = await invoke('play', {id: '1'});
  await invoke('selectProvider', {provider: 'qq'});
  assert.equal((await invoke('home')).provider, 'qq');
  assert.equal((await invoke('search', {query: 'Q'})).songs[0].source, 'qq');
  assert(bridge.hasPlayback());
  assert.equal(await (await protocols.get('pulse-music-audio')(new Request(current.audioURL))).text(), 'audio sample');
  assert(events.some(value => value[1].workspaceProvider?.provider === 'qq'));
  assert(!calls.some(value => value.kind === 'netease' && ['home', 'search'].includes(value.action)));
});
