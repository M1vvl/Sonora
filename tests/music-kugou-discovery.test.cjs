'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {createKugouDiscovery} = require('../src/music/providers/kugou-discovery.cjs');

function setup({ready = true, response} = {}) {
  const calls = [];
  const core = {
    extractKugouAuth: () => ({playbackReady: ready, mid: 'account-device', userid: '42'}),
    async kugouGatewayRequest(path, options) {
      calls.push({path, options});
      return response || {data: {song_list: [{hash: 'a'.repeat(32), name: 'Song'}]}};
    },
    mapKugouPlaylistTrack: value => value,
  };
  const discovery = createKugouDiscovery({core, getCookie: async () => 'isolated-session', now: () => 1234});
  return {discovery, calls};
}

test('Kugou recommendations use the signed account FM contract from MineRadio', async () => {
  const {discovery, calls} = setup();
  const songs = await discovery.recommend(12);
  assert.equal(songs.length, 1);
  const {path, options} = calls[0];
  assert.equal(path, '/v1/app_song_list_offset');
  assert.equal(options.router, 'fm.service.kugou.com');
  assert.equal(options.method, 'POST');
  assert.equal(options.cookie, 'isolated-session');
  assert.equal(options.body.uid, 42);
  assert.equal(options.body.data[0].size, 12);
  assert.equal(options.body.data[0].fmtype, 2);
  assert.equal(options.body.key, createHash('md5').update('1005204891234OIlwieks28dk2k092lksi2UIkp').digest('hex'));
});

test('Kugou recommendations require verified playback credentials', async () => {
  const {discovery, calls} = setup({ready: false});
  await assert.rejects(discovery.recommend(), /登录酷狗/);
  assert.equal(calls.length, 0);
});

test('Kugou recommendations bound their result and ignore duplicate or invalid tracks', async () => {
  const tracks = [
    {hash: 'a'.repeat(32), name: 'First'},
    {hash: 'a'.repeat(32), name: 'Duplicate'},
    {hash: 'invalid', name: 'Invalid'},
    ...Array.from({length: 25}, (_, index) => ({hash: index.toString(16).padStart(32, '0'), name: 'Song ' + index})),
  ];
  const {discovery, calls} = setup({response: {data: {info: tracks}}});
  const songs = await discovery.recommend(999);
  assert.equal(calls[0].options.body.data[0].size, 20);
  assert.equal(songs.length, 20);
  assert.equal(songs[0].name, 'First');
  assert.equal(new Set(songs.map(song => song.hash)).size, songs.length);
});

test('Kugou an empty FM result does not fabricate other-provider recommendations', async () => {
  const {discovery} = setup({response: {data: {song_list: []}}});
  assert.deepEqual(await discovery.recommend(), []);
});

test('Kugou public playlist IDs use a separate namespace and resolve official JSON tracks', async () => {
  const calls = [];
  const core = {
    mapKugouPlaylistTrack: value => ({...value, duration: value.duration * 1000}),
  };
  const discovery = createKugouDiscovery({core, requestText: async url => {
    calls.push(url);
    if (url.includes('/plist/index')) return JSON.stringify({plist: {list: {info: [{specialid: 42, specialname: 'Popular', imgurl: 'https://imgessl.kugou.com/{size}/cover.jpg', songcount: 2}]}}});
    return '<script>var data = ' + JSON.stringify([
      {hash: 'a'.repeat(32), songname: 'Quoted ] title', duration: 180000, authors: [{author_name: 'Artist'}]},
      {hash: 'b'.repeat(32), songname: 'Second', timelength: 200000},
    ]) + ', other = []; runUntrustedCode();</script>';
  }});
  const playlists = await discovery.publicPlaylists();
  assert.equal(playlists[0].id, 'public_42');
  assert.equal(playlists[0].cover, 'https://imgessl.kugou.com/384/cover.jpg');
  const result = await discovery.publicPlaylist('public_42', {offset: 0, limit: 1});
  assert.equal(result.songs[0].name, 'Quoted ] title');
  assert.equal(result.songs[0].duration, 180000);
  assert.equal(result.hasMore, true);
  assert.equal(result.total, 2);
  assert.equal(result.playlist.name, 'Popular');
  assert.equal(calls[1], 'https://www.kugou.com/yy/special/single/42.html');
  await assert.rejects(discovery.publicPlaylist('42'), /无效/);
});

test('Kugou public detail rejects executable expressions and incomplete JSON', async () => {
  const discovery = createKugouDiscovery({core: {mapKugouPlaylistTrack: value => value}, requestText: async () => 'var data = [runUntrustedCode()];'});
  await assert.rejects(discovery.publicPlaylist('public_42'), SyntaxError);
});
