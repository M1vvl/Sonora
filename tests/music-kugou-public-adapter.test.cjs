'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createProviderAdapter} = require('../src/music/providers/index.cjs');

test('Kugou public playlist adapter keeps special IDs out of the private cloud-list API', async () => {
  const requests = [];
  const hash = 'a'.repeat(32);
  const api = createProviderAdapter({
    provider: 'kugou',
    getCookie: async () => 'userid=123; token=fixture-private-session',
    requestText: async url => {
      requests.push(url);
      const target = new URL(url);
      assert.equal(target.hostname, 'www.kugou.com');
      assert.equal(target.pathname, '/yy/special/single/42.html');
      return 'var data=' + JSON.stringify([{hash, songname: 'Public song', author_name: 'Artist', duration: 180000,
        trans_param: {union_cover: 'https://imge.kugou.com/stdmusic/240/cover.jpg'}, album_id: '7', album_audio_id: '8'}]) + ', ignored=[];';
    },
  });
  try {
    const result = await api.request({action: 'playlist', id: 'kugou:public_42', offset: 0, limit: 30});
    assert.equal(requests.length, 1);
    assert.equal(result.songs[0].id, 'kugou:' + hash);
    assert.equal(result.songs[0].provider, 'kugou');
    assert.equal(result.songs[0].source, 'kugou');
    assert.equal(result.songs[0].duration, 180);
    assert.equal(result.songs[0].coverURL, 'https://imge.kugou.com/stdmusic/240/cover.jpg');
    assert.equal(result.songs[0].albumAudioId, '8');
    assert(!JSON.stringify(result).includes('fixture-private-session'));
    assert.equal(result.hasMore, false);
    await assert.rejects(api.request({action: 'playlist', id: 'kugou:public_../../bad'}), /无效/);
  } finally {
    api.dispose();
  }
});
