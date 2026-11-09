'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMonitor } = require('../src/monitor.cjs');
const now = Date.parse('2026-10-28T05:00:00Z');
const time = '2026-10-28T04:00:00Z';
const line = (type, payload, timestamp = time) => JSON.stringify({ type, payload, timestamp })+'\n';
const usage = input => ({ input_tokens: input, cached_input_tokens: 0, output_tokens: 0 });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-identity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex'), claudeHome = path.join(root, 'claude');
  const folder = path.join(codexHome, 'sessions', '2026', '10', '28');
  await fs.mkdir(folder, { recursive: true });
  const monitor = createMonitor({ codexHome, claudeHome, now: () => now });
  t.after(() => monitor.stop());
  return { root, codexHome, claudeHome, folder, monitor };
}
test('a replayed parent session_meta cannot rename a subagent or clear its role', async t => {
  const { folder, monitor } = await fixture(t);
  await fs.writeFile(path.join(folder, 'child.jsonl'),
    line('session_meta', { id: 'child', thread_source: 'subagent', parent_thread_id: 'parent', session_id: 'parent', cwd: 'D:\\child', timestamp: time })
    + line('session_meta', { id: 'parent', thread_source: 'user', cwd: 'D:\\parent', timestamp: '2026-10-27T04:00:00Z' })
    + line('turn_context', { model: 'gpt-6.1-sol' })
    + line('token_usage_record', { thread_id: 'child', response_id: 'child-response', usage: usage(20), thread_token_usage: usage(20) }));
  await monitor.refresh();
  const [session] = monitor.getSnapshot().sessions;
  assert.equal(session.id, 'child');
  assert.equal(session.cwd, 'D:\\child');
  assert.equal(session.isSubagent, true);
  assert.equal(session.tokens.total, 20);
});
test('a user-created fork remains a normal conversation despite having a parent', async t => {
  const { folder, monitor } = await fixture(t);
  await fs.writeFile(path.join(folder, 'fork.jsonl'), line('session_meta', { id: 'fork', thread_source: 'user', parent_thread_id: 'parent', cwd: 'D:\\new-project', timestamp: time }));
  monitor.setProjects([{ id: 'old', name: 'Old', roots: ['D:\\old'] }, { id: 'new', name: 'New', roots: ['D:\\new-project'] }], { parent: 'old' });
  await monitor.refresh();
  const [session] = monitor.getSnapshot().sessions;
  assert.equal(session.isSubagent, false);
  assert.equal(session.projectId, 'new');
});
