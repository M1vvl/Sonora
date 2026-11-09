'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMonitor } = require('../src/monitor.cjs');
const NOW = Date.parse('2026-10-28T04:00:00Z');
const timestamp = '2026-10-28T03:00:00Z';
const raw = (input, cached = 0, output = 0, reasoning = 0) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
const line = (type, payload) => JSON.stringify({ type, timestamp, payload }) + '\n';
const legacy = (current, last) => line('event_msg', { type: 'token_count', info: { total_token_usage: current, last_token_usage: last || current } });
const modern = (id, usage, cumulative) => line('token_usage_record', { thread_id: 's1', response_id: id, usage, thread_token_usage: cumulative });
const header = line('session_meta', { id: 's1', cwd: 'D:\\project', timestamp }) + line('turn_context', { model: 'gpt-6.1-sol' });
async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-baselines-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const codexHome = path.join(folder, 'codex'), claudeHome = path.join(folder, 'claude');
  const day = path.join(codexHome, 'sessions', '2026', '10', '28');
  await fs.mkdir(day, { recursive: true });
  const options = { codexHome, claudeHome, cachePath: path.join(folder, 'history-cache.json'), now: () => NOW };
  const monitor = createMonitor(options);
  t.after(() => monitor.stop());
  return { file: path.join(day, 's1.jsonl'), monitor, options };
}
test('modern counters starting from zero do not re-charge the older legacy baseline', async t => {
  const { file, monitor } = await fixture(t);
  await fs.writeFile(file, header + legacy(raw(1000))
    + modern('r1', raw(100), raw(100)) + legacy(raw(1100), raw(100))
    + modern('r2', raw(50), raw(150)) + legacy(raw(1150), raw(50)));
  await monitor.refresh();
  const snapshot = monitor.getSnapshot();
  assert.equal(snapshot.totals.total, 1150);
  assert.equal(snapshot.sessions[0].history.total, 1150);
  assert.equal(snapshot.today.total, 1150);
});
test('baseline separation preserves cached input and output accounting', async t => {
  const { file, monitor } = await fixture(t);
  await fs.writeFile(file, header + legacy(raw(1000, 800, 100, 50))
    + modern('r1', raw(100, 80, 10, 5), raw(100, 80, 10, 5))
    + legacy(raw(1100, 880, 110, 55), raw(100, 80, 10, 5))
    + modern('r2', raw(50, 40, 5, 2), raw(150, 120, 15, 7))
    + legacy(raw(1150, 920, 115, 57), raw(50, 40, 5, 2)));
  await monitor.refresh();
  const total = monitor.getSnapshot().totals;
  assert.equal(total.input, 1150);
  assert.equal(total.cached, 920);
  assert.equal(total.output, 115);
  assert.equal(total.reasoning, 57);
  assert.equal(total.total, 1265);
  assert.ok(Math.abs(total.costUSD - 0.001702) < 1e-12);
});
test('pending modern charges survive cache restart before their legacy mirror arrives', async t => {
  const { file, monitor, options } = await fixture(t);
  await fs.writeFile(file, header + legacy(raw(1000)) + modern('r1', raw(100), raw(100)));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 1100);
  monitor.stop();
  const restarted = createMonitor(options); t.after(() => restarted.stop());
  await fs.appendFile(file, legacy(raw(1100), raw(100)));
  await restarted.refresh();
  assert.equal(restarted.getSnapshot().diagnostics.cacheRestored, 1);
  assert.equal(restarted.getSnapshot().totals.total, 1100);
  await fs.appendFile(file, legacy(raw(1120), raw(20)));
  await restarted.refresh();
  assert.equal(restarted.getSnapshot().totals.total, 1120);
});
test('a duplicate modern record does not reserve another pending legacy deduction', async t => {
  const { file, monitor } = await fixture(t);
  await fs.writeFile(file, header + legacy(raw(1000))
    + modern('r1', raw(100), raw(100)) + modern('r1', raw(100), raw(100))
    + legacy(raw(1100), raw(100)) + legacy(raw(1200), raw(100)));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 1200);
});
