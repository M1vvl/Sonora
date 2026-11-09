'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createMediaMonitor, validateMedia } = require('../src/media/index.cjs');
const { sanitize } = require('../src/settings.cjs');
const frame = { type: 'media', available: true, source: 'cloudmusic', trackKey: 'a'.repeat(64), title: 'Song', artist: 'Artist', playing: true, cover: 'data:image/png;base64,YQ==' };
test('media messages only accept known players, bounded image data, and a valid track identity', () => {
  assert.equal(validateMedia(frame).available, true);
  for (const changed of [{ cover: 'https://remote/image.jpg' }, { source: 'browser' }, { cover: 'data:image/svg+xml;base64,YQ==' }, { trackKey: '' }, { cover: 'data:image/png;base64,' + 'A'.repeat(600000) }]) assert.equal(validateMedia({ ...frame, ...changed }).available, false);
  assert.equal(validateMedia({ type: 'other' }), null);
  assert.equal(sanitize({}).musicCover, true);
  assert.equal(sanitize({}).musicCoverMotion, 'rotate');
  assert.equal(sanitize({ musicCoverMotion: 'script' }).musicCoverMotion, 'rotate');
});
test('media observer handles chunked messages, suppresses duplicates, and clears stale artwork', () => {
  const children = [], updates = [];
  const media = createMediaMonitor({ onUpdate: value => updates.push(value), spawn() {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), stderr: new PassThrough(), pid: 123, killed: false });
    child.kill = () => { child.killed = true; child.emit('exit'); }; children.push(child); return child;
  } });
  media.configure({ enabled: true }); media.configure({ enabled: true }); assert.equal(children.length, 1);
  const text = JSON.stringify(frame) + '\n'; children[0].stdout.write(text.slice(0, 40)); assert.equal(updates.length, 0);
  children[0].stdout.write(text.slice(40)); children[0].stdout.write(text); assert.equal(updates.length, 1);
  children[0].stdout.write(JSON.stringify({ ...frame, playing: false }) + '\n'); assert.equal(updates.at(-1).playing, false);
  children[0].stdout.write('{"type":"media","available":false}\n'); assert.equal(media.getStatus().available, false);
  media.stop(); assert.equal(children[0].killed, true); assert.equal(media.getPid(), null);
  children[0].stdout.write(text); assert.equal(media.getStatus().available, false);
});
