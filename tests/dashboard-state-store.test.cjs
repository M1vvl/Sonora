'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_DASHBOARD_STATE, MAX_STATE_BYTES, normalizeDashboardState, createDashboardState } = require('../src/dashboard-state.cjs');

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-dashboard-state-'));
  try { return run(path.join(directory, 'dashboard.json'), directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function example() {
  return { version: 1, view: 'settings', selected: 'session-中文', filter: 'Claude', query: '查询', range: 'history', date: '2024-02-29', closedProjects: ['project-b', 'project-a'], openSubagents: ['project-a'], compositionOpen: true, activityMode: 'weekly', scroll: { sessions: 135, events: 230.5, meta: 3, content: 12, activity: 145 } };
}

test('dashboard state persists a full panel independently and returns detached copies', () => fixture(file => {
  const store = createDashboardState(file);
  assert.deepEqual(store.get(), DEFAULT_DASHBOARD_STATE);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(store.save(example()), example());
  const returned = store.get(); returned.closedProjects.push('mutated'); returned.scroll.events = 0;
  assert.deepEqual(store.get(), example());
  assert.deepEqual(createDashboardState(file).get(), example());
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1);
}));

test('normalization accepts only known fields and bounded finite values', () => {
  const value = normalizeDashboardState({ view: 'player', selected: 'x'.repeat(600), filter: 'Evil', query: '中'.repeat(500), range: 'forever', closedProjects: ['a', 'a', 4, '', 'b'], openSubagents: {}, compositionOpen: 1, activityMode: 'arbitrary', scroll: { sessions: -2, events: Infinity, meta: '40', content: 2e8, activity: 4.5, unexpected: 9 }, tokens: 1, log: 'not retained' });
  assert.equal(value.view, 'overview'); assert.equal(value.selected.length, 512);
  assert.equal(value.filter, 'all'); assert.equal(value.query.length, 300); assert.equal(value.range, 'today');
  assert.deepEqual(value.closedProjects, ['a', 'b']); assert.deepEqual(value.openSubagents, []);
  assert.equal(value.compositionOpen, false); assert.equal(value.activityMode, 'daily');
  assert.deepEqual(value.scroll, { sessions: 0, events: 0, meta: 0, content: 1e7, activity: 4.5 });
  assert.equal(Object.hasOwn(value, 'tokens'), false); assert.equal(Object.hasOwn(value, 'log'), false);
  for (const invalid of [null, [], 1, 'bad', { version: 2, query: 'future' }]) assert.deepEqual(normalizeDashboardState(invalid), DEFAULT_DASHBOARD_STATE);
});

test('fixed dates validate calendar days and null keeps today dynamic', () => {
  for (const date of [null, '2023-02-29', '2024-02-30', '2024-13-01', '2024-2-01', '2024-01-00', 'not a day']) assert.equal(normalizeDashboardState({ date }).date, null);
  for (const date of ['2024-02-29', '2026-10-29', '2000-01-01']) assert.equal(normalizeDashboardState({ date }).date, date);
});

test('large Unicode and escaped identifier collections always save within the bounded reader limit', () => fixture(file => {
  const ids = Array.from({ length: 2000 }, (_, index) => `${index}-` + '\u0000中😀'.repeat(200));
  const store = createDashboardState(file);
  const saved = store.save({ ...example(), closedProjects: ids, openSubagents: ids, selected: '\u0000'.repeat(600), query: '\u0000'.repeat(500) });
  assert(saved.closedProjects.length > 0 && saved.closedProjects.length <= 1000);
  assert(saved.openSubagents.every(id => id.length <= 512));
  assert(fs.statSync(file).size <= MAX_STATE_BYTES);
  assert.deepEqual(createDashboardState(file).get(), saved);
  assert.equal(normalizeDashboardState({ closedProjects: Array.from({ length: 2000 }, (_, i) => String(i)) }).closedProjects.length, 1000);
}));

test('malformed, oversized, or future-version files fall back without altering the original', () => fixture(file => {
  for (const contents of ['{bad', JSON.stringify({ version: 9, query: 'future' }), JSON.stringify({ query: 'unversioned' }), ' '.repeat(MAX_STATE_BYTES + 1), 'null']) {
    fs.writeFileSync(file, contents);
    assert.deepEqual(createDashboardState(file).get(), DEFAULT_DASHBOARD_STATE);
    assert.equal(fs.readFileSync(file, 'utf8'), contents);
  }
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify(example()));
  assert.deepEqual(createDashboardState(file).get(), example());
}));

test('identical normalized saves do not rewrite the state file', () => fixture(file => {
  const store = createDashboardState(file);
  store.save(example());
  const oldTime = new Date('2001-01-01T00:00:00Z'); fs.utimesSync(file, oldTime, oldTime);
  const before = fs.statSync(file).mtimeMs;
  store.save({ ...example(), ignored: 'not part of state' });
  assert.equal(fs.statSync(file).mtimeMs, before);
  createDashboardState(file).save(example());
  assert.equal(fs.statSync(file).mtimeMs, before);
}));

test('failed replacement leaves prior disk and in-memory state intact and removes its temporary file', () => fixture((file, directory) => {
  const errors = [], store = createDashboardState(file, { onError: error => errors.push(error) });
  store.save(example()); const previous = fs.readFileSync(file, 'utf8');
  const original = fs.renameSync;
  try {
    fs.renameSync = (...args) => { if (args[1] === file) { const error = new Error('simulated replacement failure'); error.code = 'EACCES'; throw error; } return original(...args); };
    assert.throws(() => store.save({ ...example(), selected: 'different' }), /simulated replacement failure/);
  } finally { fs.renameSync = original; }
  assert.equal(errors.length, 1); assert.equal(fs.readFileSync(file, 'utf8'), previous);
  assert.deepEqual(store.get(), example()); assert.deepEqual(fs.readdirSync(directory), ['dashboard.json']);
  assert.equal(store.save({ ...example(), selected: 'next' }).selected, 'next');
}));
