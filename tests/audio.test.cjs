'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createAudioMonitor } = require('../src/audio/index.cjs');
const { forIsland } = require('../src/snapshots.cjs');
const { sanitize } = require('../src/settings.cjs');
function fixture() {
  const children = [], frames = [];
  const audio = createAudioMonitor({ onFrame: value => frames.push(value), spawn: (_path, args) => {
    const child = new EventEmitter(); Object.assign(child, { args, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: false, pid: 123 });
    child.kill = () => { child.killed = true; child.emit('exit', 0); };
    children.push(child); return child;
  }});
  return { audio, children, frames };
}
test('audio defaults require no player selection; optional modes are validated', () => {
  assert.equal(sanitize({}).musicReactive, true);
  assert.equal(sanitize({}).audioSourceMode, 'auto');
  assert.equal(sanitize({ musicReactive: false, audioSourceMode: 'music' }).audioSourceMode, 'music');
  assert.equal(sanitize({ audioSourceMode: 'arbitrary executable' }).audioSourceMode, 'auto');
});
test('audio protocol handles partial JSON, rejects malformed frames and clamps levels', () => {
  const { audio, children, frames } = fixture();
  audio.configure({ enabled: true }); const child = children[0];
  child.stdout.write('{"type":"frame","levels":[0.3,');
  assert.equal(frames.length, 1);
  child.stdout.write('2,-1],"active":true,"audioSources":["cloudmusic"]}\n');
  assert.deepEqual(frames.at(-1).levels, [.3, 1, 0]);
  assert.equal(frames.at(-1).enabled, true);
  child.stdout.write('not json\n{"type":"frame","levels":[null,2,1]}\n');
  assert.equal(frames.length, 2);
  audio.stop();
});
test('disabling audio kills helper and ignores stale output; reconfigure is idempotent', () => {
  const { audio, children, frames } = fixture();
  audio.configure({ enabled: true }); audio.configure({ enabled: true });
  assert.equal(children.length, 1);
  const child = children[0]; audio.configure({ enabled: false });
  assert.equal(child.killed, true); assert.equal(audio.getPid(), null);
  child.stdout.write('{"type":"frame","levels":[1,1,1],"active":true}\n');
  assert.equal(frames.at(-1).state, 'disabled'); assert.deepEqual(frames.at(-1).levels, [0, 0, 0]);
});
test('manual source change replaces helper, only allowlisted arguments reach process', () => {
  const { audio, children } = fixture();
  audio.configure({ enabled: true });
  audio.configure({ enabled: true, mode: 'music' });
  assert.equal(children[0].killed, true); assert.deepEqual(children[1].args, ['--music-only']);
  audio.configure({ enabled: true, mode: 'custom shell' });
  assert.deepEqual(children[2].args, []); audio.stop();
});
test('helper exit reports unavailable and stop cancels pending restart', () => {
  const { audio, children } = fixture(); audio.configure({ enabled: true });
  children[0].emit('exit', 1); assert.equal(audio.getStatus().state, 'unavailable');
  audio.stop(); assert.equal(audio.getStatus().state, 'disabled');
});
test('island projection preserves main-chat usage, omits archived bulk and subagents', () => {
  const main = { id: 'main', tokens: { total: 9 }, today: { total: 3 }, title: 'chat', events: [{ type: 'text', text: 'hello' }, { type: 'usage' }], dailyUsage: new Array(1000).fill({ total: 1 }) };
  const input = { sessions: [main, { isSubagent: true, id: 'child' }], pricing: {}, diagnostics: { loading: false }, projects: [{ id: 'project' }] };
  const output = forIsland(input);
  assert.equal(output.sessions.length, 1); assert.deepEqual(output.sessions[0].tokens, { total: 9 });
  assert.deepEqual(output.sessions[0].today, { total: 3 }); assert.equal(output.sessions[0].events[0].text, 'hello');
  assert.equal(output.sessions[0].dailyUsage, undefined); assert.equal(output.projects, undefined); assert.equal(output.pricing, undefined);
  assert.ok(JSON.stringify(output).length < JSON.stringify(input).length / 5);
});
