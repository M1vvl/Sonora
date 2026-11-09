'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const messages = new Map(), documentEvents = new Map(), frames = new Map();
  const positions = [], sent = [], released = [];
  let now = 0, sequence = 0;
  const parent = {postMessage(value) {sent.push(value);}};
  const context = {
    location: {search: '?token=clock'}, URLSearchParams, performance: {now: () => now},
    parent, document: {hidden: false,
      addEventListener: (name, fn) => documentEvents.set(name, fn),
      removeEventListener: name => documentEvents.delete(name)},
    addEventListener: (name, fn) => messages.set(name, fn),
    removeEventListener: name => messages.delete(name),
    requestAnimationFrame(fn) {frames.set(++sequence, fn); return sequence;},
    cancelAnimationFrame(id) {frames.delete(id);},
    PulseSourceSpace: {
      prepare: value => value,
      updateLyrics(value) {positions.push(value.position);},
      render() {}, getState: () => ({}), dispose: () => released.push('space')},
    PulseEmilyFrame: {update() {}, dispose: () => released.push('frame')},
    PulseSourceCover: {step() {}, set() {}, dispose: () => released.push('cover')},
    PulseSourceLyrics: {getState: () => ({attached: true})},
    renderer: {info: {memory: {geometries: 1, textures: 4}, render: {calls: 2, points: 33489}}},
    GRID_X: 183
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    '../assets/music/source-presets/emily-adapter.js'), 'utf8'), context);
  return {context, positions, sent, released, frames,
    receive(data) {messages.get('message')?.({source: parent, data: {token: 'clock', ...data}});},
    at(time) {now = time;},
    tick(time) {now = time; const jobs = [...frames.values()]; frames.clear(); for (const fn of jobs) fn(time);},
    visibility(hidden) {context.document.hidden = hidden; documentEvents.get('visibilitychange')?.();}
  };
}

test('Emily owns one autonomous frame clock and extrapolates lyrics without pointer input', () => {
  const f = fixture();
  f.receive({type: 'pulse-preset-frame', position: 10, duration: 240, playing: true, settings: {fps: 60}});
  assert.equal(f.frames.size, 1);
  f.tick(17);
  f.tick(34);
  assert.equal(f.positions.length, 3);
  assert(f.positions.at(-1) > 10.03);
  f.receive({type: 'pulse-preset-frame', position: 10.015, playing: true});
  assert.equal(f.positions.length, 3, '30Hz parent updates must not add synchronous renders');
  f.tick(51);
  assert(f.positions.at(-1) >= f.positions.at(-2), 'lagging parent updates cannot reverse karaoke');
  assert.equal(f.frames.size, 1);
  assert.equal(f.sent.filter(value => value.type === 'pulse-preset-presented').length, 1);
  f.receive({type: 'pulse-preset-frame', position: 3, playing: true, seeking: true});
  assert.equal(f.positions.at(-1), 3, 'explicit seeks reset the projected clock');
  assert.equal(f.frames.size, 1);
});

test('pause, document hiding and disposal cancel the autonomous renderer', () => {
  const f = fixture();
  f.receive({type: 'pulse-preset-frame', position: 10, playing: true, settings: {fps: 60}});
  f.visibility(true);
  assert.equal(f.frames.size, 0);
  f.visibility(false);
  assert.equal(f.frames.size, 1);
  f.receive({type: 'pulse-preset-frame', position: 11, playing: false});
  assert.equal(f.frames.size, 0);
  const pausedFrames = f.positions.length;
  f.tick(1000);
  assert.equal(f.positions.length, pausedFrames);
  f.receive({type: 'pulse-preset-dispose'});
  assert.deepEqual(f.released, ['space', 'cover', 'frame']);
  assert.equal(f.context.PulseEmilyRedraw, undefined);
  f.receive({type: 'pulse-preset-frame', position: 12, playing: true});
  assert.equal(f.frames.size, 0);
});

test('reduced motion keeps real lyric time while limiting the local clock to twenty frames', () => {
  const f = fixture();
  f.receive({type: 'pulse-preset-frame', position: 1, duration: 240, playing: true, reducedMotion: true});
  f.tick(17);
  assert.equal(f.positions.length, 1);
  f.tick(34);
  assert.equal(f.positions.length, 1);
  f.tick(51);
  assert.equal(f.positions.length, 2);
  assert(f.positions.at(-1) > 1.05);
});

test('paused material changes request one coalesced redraw and never create a persistent loop', () => {
  const f = fixture();
  f.receive({type: 'pulse-preset-frame', position: 10, playing: false});
  const before = f.positions.length;
  f.context.PulseEmilyRedraw();
  f.context.PulseEmilyRedraw();
  assert.equal(f.frames.size, 1);
  assert.equal(f.positions.length, before);
  f.tick(17);
  assert.equal(f.positions.length, before + 1);
  assert.equal(f.frames.size, 0);
  f.receive({type: 'pulse-preset-frame', position: 10, playing: true});
  const playingFrames = f.positions.length;
  f.context.PulseEmilyRedraw();
  assert.equal(f.positions.length, playingFrames, 'material updates reuse the playing RAF');
  assert.equal(f.frames.size, 1);
  f.visibility(true);
  f.context.PulseEmilyRedraw();
  assert.equal(f.frames.size, 0);
});
