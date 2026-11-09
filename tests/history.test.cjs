'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMonitor } = require('../src/monitor.cjs');
const NOW = Date.parse('2026-10-28T04:00:00Z');
const YESTERDAY = '2026-10-27T10:00:00Z';
const TODAY = '2026-10-27T17:00:00Z'; // Beijing Oct 28, despite the UTC date.
const line = (type, payload, timestamp = TODAY) => JSON.stringify({ type, timestamp, payload }) + '\n';
const raw = (input, output = 0) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: 0, reasoning_output_tokens: 0 });
const header = (id, cwd = 'D:\\work', timestamp = YESTERDAY, extra = {}) => line('session_meta', { id, cwd, timestamp, ...extra }, timestamp) + line('turn_context', { model: 'gpt-6.1-sol' }, timestamp);
const record = (id, response, input, output = 0, timestamp = TODAY) => line('token_usage_record', { thread_id: id, response_id: response, usage: raw(input, output) }, timestamp);
async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-history-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const codexHome = path.join(folder, 'codex'), claudeHome = path.join(folder, 'claude'), cachePath = path.join(folder, 'cache', 'history-cache.json');
  const sessions = path.join(codexHome, 'sessions'), archived = path.join(codexHome, 'archived_sessions');
  await fs.mkdir(sessions, { recursive: true }); await fs.mkdir(archived, { recursive: true });
  const make = (extra = {}) => {
    const monitor = createMonitor({ codexHome, claudeHome, now: () => NOW, ...extra });
    t.after(() => monitor.stop()); return monitor;
  };
  return { folder, codexHome, claudeHome, sessions, archived, cachePath, make };
}

test('unarchived history keeps old nested logs beyond the old 120-file cap but excludes the archive', async t => {
  const { sessions, archived, make } = await fixture(t);
  const old = path.join(sessions, '2020', '01', '01'); await fs.mkdir(old, { recursive: true });
  await Promise.all(Array.from({ length: 125 }, (_, index) => fs.writeFile(path.join(old, `${index}.jsonl`), header(`s${index}`) + record(`s${index}`, `r${index}`, 1))));
  await fs.writeFile(path.join(archived, 'archive.jsonl'), header('old') + record('old', 'old-r', 50, 10, YESTERDAY));
  const monitor = make(); await monitor.refresh();
  const snapshot = monitor.getSnapshot();
  assert.equal(snapshot.sessions.length, 125);
  assert.equal(snapshot.totals.total, 125);
  assert.equal(snapshot.today.total, 125);
  assert.equal(snapshot.sessions.find(session => session.id === 'old'), undefined);
  assert.equal(snapshot.diagnostics.historyComplete, true);
  assert.equal(snapshot.diagnostics.partial, false);
  assert.equal(snapshot.diagnostics.filesTotal, 125);
});

test('history and Shanghai daily usage remain separate across models and project assignment', async t => {
  const { sessions, make } = await fixture(t);
  await fs.writeFile(path.join(sessions, 'a.jsonl'), header('a', 'D:\\work\\nested\\app')
    + record('a', 'old', 100, 10, YESTERDAY)
    + line('turn_context', { model: 'gpt-6.1-terra' }, TODAY)
    + record('a', 'new', 20, 2, TODAY));
  await fs.writeFile(path.join(sessions, 'b.jsonl'), header('b', 'D:\\unrelated') + record('b', 'assigned', 7));
  const monitor = make({ projects: [{ id: 'outer', name: '外层项目', roots: ['D:\\work'] }, { id: 'inner', name: '嵌套项目', roots: ['D:\\work\\nested'] }], projectAssignments: { b: 'outer' } });
  await monitor.refresh(); const snapshot = monitor.getSnapshot();
  const a = snapshot.sessions.find(session => session.id === 'a');
  assert.equal(a.projectId, 'inner'); assert.equal(a.history.total, 132); assert.equal(a.tokens.total, 132); assert.equal(a.today.total, 22);
  assert.deepEqual(a.dailyUsage.map(day => [day.date, day.total]), [['2026-10-27', 110], ['2026-10-28', 22]]);
  assert.equal(snapshot.totals.total, 139); assert.equal(snapshot.today.total, 29); assert.equal(snapshot.byModel.length, 2);
  assert.equal(snapshot.projects.find(project => project.id === 'outer').totals.total, 7);
  assert.equal(snapshot.projects.find(project => project.id === 'inner').today.total, 22);
  monitor.setProjects([{ id: 'renamed', name: '重新归属', roots: [] }], { a: 'renamed', b: 'renamed' });
  assert.equal(monitor.getSnapshot().projects.find(project => project.id === 'renamed').totals.total, 139);
});

test('default reads long files and large JSON records in full instead of clipping the first 32 MiB', async t => {
  const { sessions, make } = await fixture(t);
  const file = path.join(sessions, 'large.jsonl');
  await fs.writeFile(file, header('long') + record('long', 'beginning', 100, 0, YESTERDAY));
  await fs.appendFile(file, line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(34 * 1024 * 1024) }] }));
  await fs.appendFile(file, record('long', 'ending', 20));
  const monitor = make(); await monitor.refresh(); const snapshot = monitor.getSnapshot();
  assert.equal(snapshot.totals.total, 120); assert.equal(snapshot.today.total, 20);
  assert.equal(snapshot.diagnostics.truncatedFiles, 0); assert.equal(snapshot.diagnostics.oversizedLines, 0);
  assert.equal(snapshot.diagnostics.historyComplete, true);
  assert.ok(snapshot.sessions[0].events.find(event => event.type === 'message').text.length <= 420);
});

test('warm cache skips unchanged history and resumes an incomplete UTF-8 line without retaining raw text', async t => {
  const { sessions, cachePath, make } = await fixture(t);
  const file = path.join(sessions, 'cached.jsonl');
  const prefix = header('cached') + record('cached', 'first', 100, 10, YESTERDAY);
  const message = Buffer.from(line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '中文 Bearer supersecretcredential' }] }));
  const split = message.indexOf(Buffer.from('中')) + 1;
  await fs.writeFile(file, prefix);
  const cold = make({ cachePath }); await cold.refresh(); cold.stop();
  const warm = make({ cachePath }); await warm.refresh();
  assert.equal(warm.getSnapshot().diagnostics.cacheRestored, 1); assert.equal(warm.getSnapshot().diagnostics.bytesRead, 0);
  await fs.appendFile(file, message.subarray(0, split)); await warm.refresh(); warm.stop();
  const cache = await fs.readFile(cachePath, 'utf8');
  assert.ok(!cache.includes('supersecretcredential'));
  const resumed = make({ cachePath });
  await fs.appendFile(file, message.subarray(split));
  await fs.appendFile(file, record('cached', 'second', 20, 2));
  await resumed.refresh(); const snapshot = resumed.getSnapshot();
  assert.equal(snapshot.totals.total, 132); assert.equal(snapshot.today.total, 22);
  assert.equal(snapshot.diagnostics.malformedLines, 0);
  assert.ok(!JSON.stringify(snapshot).includes('supersecretcredential'));
  assert.ok(snapshot.diagnostics.bytesRead < 2048);
});

test('cache survives source rotation and removes deleted source totals persistently', async t => {
  const { sessions, archived, cachePath, make } = await fixture(t);
  const active = path.join(sessions, 'rotate.jsonl'), archive = path.join(archived, 'rotate.jsonl');
  await fs.writeFile(active, header('rotate') + record('rotate', 'same-response', 100));
  const cold = make({ cachePath }); await cold.refresh(); cold.stop();
  await fs.copyFile(active, archive);
  const moved = make({ cachePath }); await moved.refresh();
  assert.equal(moved.getSnapshot().totals.total, 100);
  assert.equal(moved.getSnapshot().sessions.length, 1);
  await fs.rm(active); await moved.refresh();
  assert.equal(moved.getSnapshot().totals.total, 0);
  assert.equal(moved.getSnapshot().sessions.length, 0);
  await fs.rm(archive); await moved.refresh(); moved.stop();
  const empty = make({ cachePath }); await empty.refresh();
  assert.equal(empty.getSnapshot().totals.total, 0);
  assert.equal(JSON.parse(await fs.readFile(cachePath, 'utf8')).states.length, 0);
});

test('subagents expose their parent and inherited legacy history remains a baseline', async t => {
  const { sessions, make } = await fixture(t);
  const cumulative = n => line('event_msg', { type: 'token_count', info: { total_token_usage: raw(n), last_token_usage: raw(n === 120 ? 20 : n) } }, n === 120 ? TODAY : YESTERDAY);
  await fs.writeFile(path.join(sessions, 'child.jsonl'), header('child', 'D:\\work', TODAY, { parent_thread_id: 'root', session_id: 'root', thread_source: 'subagent' }) + cumulative(100) + cumulative(120));
  const monitor = make(); await monitor.refresh(); const child = monitor.getSnapshot().sessions[0];
  assert.equal(child.isSubagent, true); assert.equal(child.parentThreadId, 'root'); assert.equal(child.rootSessionId, 'root');
  assert.equal(child.tokens.total, 20); assert.equal(child.today.total, 20);
});
