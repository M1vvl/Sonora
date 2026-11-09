'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../ui/media-cover.js'), 'utf8');
const thumbnail = text => `data:image/png;base64,${Buffer.from(text).toString('base64')}`;

function harness() {
  let receive, unsubscribed = false;
  const images = [], documentEvents = new Map(), windowEvents = new Map();
  function element() {
    const attributes = new Map(), events = new Map();
    return { dataset: {}, hidden: false, alt: '', events,
      getAttribute: key => attributes.get(key) ?? null,
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute(key) { attributes.delete(key); if (key === 'src') this.src = ''; },
      addEventListener: (key, value) => events.set(key, value),
      removeEventListener: key => events.delete(key)
    };
  }
  const avatar = element(), agent = element(), cover = element();
  const document = { hidden: false,
    getElementById: key => ({ 'agent-avatar': avatar, 'agent-orb': agent, 'music-cover': cover })[key],
    addEventListener: (key, value) => documentEvents.set(key, value),
    removeEventListener: key => documentEvents.delete(key)
  };
  const window = { pulse: { onMediaUpdate: callback => { receive = callback; return () => { unsubscribed = true; }; } },
    addEventListener: (key, value) => windowEvents.set(key, value),
    removeEventListener: key => windowEvents.delete(key)
  };
  class Candidate {
    constructor() { this.src = ''; this.naturalWidth = 256; this.naturalHeight = 256; images.push(this); }
    decode() { return this.decodeResult || Promise.resolve(); }
  }
  vm.runInNewContext(code, { document, window, Image: Candidate });
  return { avatar, agent, cover, images, document, documentEvents, window, windowEvents,
    receive: frame => receive(frame), get unsubscribed() { return unsubscribed; } };
}

test('media cover accepts bounded local thumbnails and restores the Agent when unavailable', async () => {
  const h = harness();
  assert.equal(h.agent.hidden, false);
  assert.equal(h.cover.hidden, true);
  h.receive({ available: true, cover: 'https://example.com/cover.png', playing: true });
  h.receive({ available: true, cover: `data:image/png;base64,${'A'.repeat(700000)}` });
  h.receive({ available: true, cover: 'data:image/svg+xml;base64,PHN2Zz4=' });
  assert.equal(h.images.length, 0, 'network, oversized and SVG sources never load');
  const data = thumbnail('song-a');
  h.receive({ available: true, source: '网易云音乐', title: '歌曲 A', artist: '歌手', trackKey: 'a', cover: data, playing: true });
  assert.equal(h.agent.hidden, false, 'the Agent stays visible until decoding succeeds');
  await h.images[0].onload();
  assert.equal(h.agent.hidden, true);
  assert.equal(h.cover.hidden, false);
  assert.equal(h.cover.src, data);
  assert.equal(h.avatar.dataset.mediaPlaying, 'true');
  assert.match(h.avatar.title, /歌曲 A · 歌手 · 网易云音乐/);
  h.receive({ available: false });
  assert.equal(h.agent.hidden, false);
  assert.equal(h.cover.hidden, true);
  assert.equal(h.cover.src, '');
});

test('pause and hidden state stop CSS rotation without reloading the cover', async () => {
  const h = harness(), frame = { available: true, trackKey: 'a', cover: thumbnail('a'), playing: true };
  h.receive(frame); await h.images[0].onload();
  h.receive({ ...frame, playing: false });
  assert.equal(h.images.length, 1);
  assert.equal(h.avatar.dataset.mediaPlaying, 'false');
  h.document.hidden = true; h.documentEvents.get('visibilitychange')();
  assert.equal(h.avatar.dataset.mediaVisible, 'false');
  h.document.hidden = false; h.documentEvents.get('visibilitychange')();
  assert.equal(h.avatar.dataset.mediaVisible, 'true');
  assert.equal(h.avatar.dataset.mediaPlaying, 'false');
});

test('a late decode from the previous track cannot overwrite the current song', async () => {
  const h = harness();
  h.receive({ available: true, trackKey: 'a', cover: thumbnail('a'), playing: true });
  let finishOld;
  h.images[0].decodeResult = new Promise(resolve => { finishOld = resolve; });
  const oldLoad = h.images[0].onload();
  h.receive({ available: true, trackKey: 'b', title: 'Song B', cover: thumbnail('b'), playing: true });
  await h.images[1].onload();
  finishOld(); await oldLoad;
  assert.equal(h.cover.src, thumbnail('b'));
  assert.equal(h.avatar.title, 'Song B');
});

test('decode failures and disposal recover the Agent and release subscriptions', async () => {
  const h = harness();
  h.receive({ available: true, trackKey: 'bad', cover: thumbnail('bad'), playing: true });
  h.images[0].decodeResult = Promise.reject(new Error('invalid image'));
  await h.images[0].onload();
  assert.equal(h.agent.hidden, false);
  assert.equal(h.cover.hidden, true);
  h.receive({ available: true, trackKey: 'late', cover: thumbnail('late'), playing: true });
  const staleLoad = h.images[1].onload;
  h.window.agentPulseMediaCover.dispose();
  await staleLoad();
  assert.equal(h.unsubscribed, true);
  assert.equal(h.documentEvents.size, 0);
  assert.equal(h.windowEvents.size, 0);
  assert.equal(h.cover.hidden, true);
  assert.equal(h.agent.hidden, false);
});
