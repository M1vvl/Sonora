'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMonitor, redact, dayKey, titlePreview } = require('../src/monitor.cjs');
const { normalizeUsage, priceUsage } = require('../src/pricing.cjs');
const NOW = Date.parse('2026-10-28T04:00:00Z');
const timestamp = '2026-10-28T03:00:00Z';
const line = (type, payload, time = timestamp) => JSON.stringify({ type, timestamp: time, payload }) + '\n';
const raw = (input, cached, output, reasoning = 0) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-monitor-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const codexHome = path.join(folder, 'codex'), claudeHome = path.join(folder, 'claude');
  const day = path.join(codexHome, 'sessions', '2026', '10', '28');
  await fs.mkdir(day, { recursive: true });
  await fs.mkdir(path.join(claudeHome, 'projects', 'test'), { recursive: true });
  const monitor = createMonitor({ codexHome, claudeHome, now: () => NOW, historyDays: 1 });
  t.after(() => monitor.stop());
  return { folder, day, claudeHome, monitor };
}
function header(id = 's1') {
  return line('session_meta', { id, cwd: 'D:\\work', timestamp }) + line('turn_context', { model: 'gpt-6.1-sol' });
}
test('cached input is a subset of input and reasoning is a subset of output', () => {
  const tokens = normalizeUsage(raw(1000, 800, 200, 150));
  assert.equal(tokens.total, 1200);
  assert.equal(priceUsage('gpt-6.1-sol', tokens).costUSD, 0.00248);
  assert.equal(priceUsage('unknown-model', tokens).costUSD, null);
  assert.equal(priceUsage('unknown-model', tokens).unpricedTokens, 1200);
});
test('modern usage records and mirrored legacy token_count count once; inherited parent records do not count', async t => {
  const { day, monitor } = await fixture(t);
  const tokens = raw(1000, 800, 200, 100);
  await fs.writeFile(path.join(day, 'session.jsonl'), header()
    + line('token_usage_record', { thread_id: 'parent', response_id: 'inherited', usage: tokens, thread_token_usage: tokens })
    + line('event_msg', { type: 'token_count', info: { total_token_usage: tokens, last_token_usage: tokens } })
    + line('token_usage_record', { thread_id: 's1', response_id: 'response1', usage: tokens, thread_token_usage: tokens })
    + line('event_msg', { type: 'token_count', info: { total_token_usage: tokens, last_token_usage: tokens }, rate_limits: { primary: { used_percent: 5, window_minutes: 300, resets_at: 123 }, plan_type: 'plus', credits: { balance: 'secret' } } })
    + line('token_usage_record', { thread_id: 's1', response_id: 'response1', usage: tokens, thread_token_usage: tokens }));
  await monitor.refresh();
  const snapshot = monitor.getSnapshot();
  assert.equal(snapshot.totals.total, 1200);
  assert.equal(snapshot.sessions[0].usageRequests, 1);
  assert.equal(snapshot.sessions[0].rateLimits.plan_type, 'plus');
  assert.ok(!JSON.stringify(snapshot).includes('secret'));
});
test('legacy duplicates, cumulative resets, and model changes preserve correct deltas and unknown pricing', async t => {
  const { day, monitor } = await fixture(t);
  const tokenEvent = (total, last) => line('event_msg', { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } });
  await fs.writeFile(path.join(day, 'legacy.jsonl'), header()
    + tokenEvent(raw(100, 40, 20), raw(100, 40, 20))
    + tokenEvent(raw(100, 40, 20), raw(100, 40, 20))
    + tokenEvent(raw(250, 100, 40), raw(150, 60, 20))
    + tokenEvent(raw(50, 20, 10), raw(50, 20, 10))
    + line('turn_context', { model: 'unverified-model' })
    + tokenEvent(raw(100, 30, 20), raw(50, 10, 10)));
  await monitor.refresh();
  const snapshot = monitor.getSnapshot();
  assert.equal(snapshot.totals.input, 350);
  assert.equal(snapshot.totals.output, 60);
  assert.equal(snapshot.totals.total, 410);
  assert.equal(snapshot.totals.unpricedTokens, 60);
  assert.equal(snapshot.totals.costUSD, null);
  assert.ok(snapshot.totals.knownCostUSD > 0);
  assert.equal(snapshot.byModel.length, 2);
});
test('incremental tails buffer partial UTF-8 and partial JSON lines until newline', async t => {
  const { day, monitor } = await fixture(t);
  const file = path.join(day, 'incremental.jsonl');
  await fs.writeFile(file, header());
  await monitor.refresh();
  const payload = Buffer.from(line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '中文消息' }] }));
  const chinese = payload.indexOf(Buffer.from('中'));
  await fs.appendFile(file, payload.subarray(0, chinese + 1));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().sessions[0].events.length, 0);
  await fs.appendFile(file, payload.subarray(chinese + 1));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().sessions[0].events[0].text, '中文消息');
  assert.equal(monitor.getSnapshot().diagnostics.malformedLines, 0);
  await fs.appendFile(file, line('token_usage_record', { thread_id: 's1', response_id: 'one', usage: raw(50, 30, 10), thread_token_usage: raw(50, 30, 10) }));
  await monitor.refresh(); await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 60);
});
test('file truncation replaces rather than adds previous usage', async t => {
  const { day, monitor } = await fixture(t);
  const file = path.join(day, 'rewrite.jsonl');
  await fs.writeFile(file, header() + line('token_usage_record', { thread_id: 's1', response_id: 'a', usage: raw(10000, 0, 500), thread_token_usage: raw(10000, 0, 500) }) + line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(2000) }] }));
  await monitor.refresh();
  await fs.writeFile(file, header() + line('token_usage_record', { thread_id: 's1', response_id: 'b', usage: raw(20, 0, 5), thread_token_usage: raw(20, 0, 5) }));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 25);
});
test('Claude input adds cache read/write, repeated streaming message usage updates once, and unverified models stay unpriced', async t => {
  const { claudeHome, monitor } = await fixture(t);
  const file = path.join(claudeHome, 'projects', 'test', 'claude.jsonl');
  const assistant = output => JSON.stringify({ type: 'assistant', sessionId: 'c1', timestamp, message: { id: 'msg1', model: 'claude-unverified', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 20, output_tokens: output } } }) + '\n';
  await fs.writeFile(file, assistant(2) + assistant(8));
  await monitor.refresh();
  const snapshot = monitor.getSnapshot();
  assert.equal(snapshot.totals.input, 60);
  assert.equal(snapshot.totals.cached, 30);
  assert.equal(snapshot.totals.output, 8);
  assert.equal(snapshot.totals.total, 68);
  assert.equal(snapshot.sessions[0].usageRequests, 1);
  assert.equal(snapshot.totals.costUSD, null);
});
test('snapshots redact credentials and omit tool arguments/results', async t => {
  const { day, monitor } = await fixture(t);
  const secret = 'sk-1234567890abcdefghijkl';
  await fs.writeFile(path.join(day, 'redact.jsonl'), header()
    + line('response_item', { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: secret }) })
    + line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `api_key=${secret} and Bearer abcdefghijklmnop` }] }));
  await monitor.refresh();
  assert.ok(!JSON.stringify(monitor.getSnapshot()).includes(secret));
  assert.equal(monitor.getSnapshot().sessions[0].events[0].text, '调用 exec_command');
  assert.ok(redact('password: "hello"').includes('[已隐藏凭据]'));
});
test('Shanghai day boundary is independent of host timezone', () => {
  assert.equal(dayKey('2026-10-27T17:00:00Z'), '2026-10-28');
});
test('bounded tail has explicit partial scope and cannot price usage before a model context', async t => {
  const { day, claudeHome } = await fixture(t);
  const file = path.join(day, 'rollout-2026-10-28T10-00-00-s1.jsonl');
  const record = line('token_usage_record', { thread_id: 's1', response_id: 'tail-response', usage: raw(100, 20, 10), thread_token_usage: raw(100, 20, 10) });
  const contents = header() + line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(5000) }] }) + record;
  await fs.writeFile(file, contents);
  const bounded = createMonitor({ codexHome: path.resolve(day, '..', '..', '..', '..'), claudeHome, now: () => NOW, historyDays: 1, maxInitialBytes: Buffer.byteLength(record) + 20 });
  t.after(() => bounded.stop());
  await bounded.refresh();
  const snapshot = bounded.getSnapshot();
  assert.equal(snapshot.diagnostics.partial, true);
  assert.equal(snapshot.sessions[0].partial, true);
  assert.equal(snapshot.sessions[0].tokens.total, 110);
  assert.equal(snapshot.sessions[0].costUSD, null);
  assert.equal(snapshot.sessions[0].unpricedTokens, 110);
});
test('inherited modern snapshots remain a baseline across repeated legacy mirrors', async t => {
  const { day, monitor } = await fixture(t);
  const token = value => raw(value, 0, 0);
  const legacy = (total, last = total) => line('event_msg', { type: 'token_count', info: { total_token_usage: token(total), last_token_usage: token(last) } });
  const file = path.join(day, 'inherit.jsonl');
  await fs.writeFile(file, header() + line('token_usage_record', { thread_id: 'parent', response_id: 'parent1', usage: token(100), thread_token_usage: token(100) }) + legacy(100) + legacy(100));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 0);
  await fs.appendFile(file, legacy(120, 20));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 20);
});
test('an out-of-order duplicate modern record cannot rewind the cumulative legacy baseline', async t => {
  const { day, monitor } = await fixture(t);
  const record = (response, current) => line('token_usage_record', { thread_id: 's1', response_id: response, usage: raw(100, 0, 0), thread_token_usage: raw(current, 0, 0) });
  await fs.writeFile(path.join(day, 'replay.jsonl'), header() + record('r1', 100) + record('r2', 200) + record('r1', 100) + line('event_msg', { type: 'token_count', info: { total_token_usage: raw(200, 0, 0), last_token_usage: raw(100, 0, 0) } }));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 200);
});
test('canonical records retain surviving duplicate sources after the original source is rewritten', async t => {
  const { day, monitor } = await fixture(t);
  const record = (id, n) => line('token_usage_record', { thread_id: 's1', response_id: id, usage: raw(n, 0, 0), thread_token_usage: raw(n, 0, 0) });
  const a = path.join(day, 'a.jsonl'), b = path.join(day, 'b.jsonl');
  await fs.writeFile(a, header() + record('shared', 100) + '\n'.repeat(200));
  await fs.writeFile(b, header() + record('shared', 100));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 100);
  await fs.writeFile(a, header() + record('new', 20));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 120);
});
test('modern records without cumulative counters do not cause their legacy mirror to count again', async t => {
  const { day, monitor } = await fixture(t);
  await fs.writeFile(path.join(day, 'missing-cumulative.jsonl'), header()
    + line('token_usage_record', { thread_id: 's1', response_id: 'r1', usage: raw(100, 0, 0), thread_token_usage: raw(100, 0, 0) })
    + line('token_usage_record', { thread_id: 's1', response_id: 'r2', usage: raw(20, 0, 0) })
    + line('event_msg', { type: 'token_count', info: { total_token_usage: raw(120, 0, 0), last_token_usage: raw(20, 0, 0) } }));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 120);
});
test('a bounded tail beginning exactly at a JSON line does not drop that first complete record', async t => {
  const { day, claudeHome } = await fixture(t);
  const record = line('token_usage_record', { thread_id: 's1', response_id: 'boundary', usage: raw(100, 0, 0), thread_token_usage: raw(100, 0, 0) });
  await fs.writeFile(path.join(day, 'rollout-2026-10-28T10-00-00-s1.jsonl'), header() + record);
  const monitor = createMonitor({ codexHome: path.resolve(day, '..', '..', '..', '..'), claudeHome, now: () => NOW, historyDays: 1, maxInitialBytes: Buffer.byteLength(record) });
  t.after(() => monitor.stop());
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 100);
});
test('skipped malformed records remain marked partial after rediscovery', async t => {
  const { day, monitor } = await fixture(t);
  await fs.writeFile(path.join(day, 'broken.jsonl'), header() + '{broken}\n');
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().diagnostics.partial, true);
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().diagnostics.partial, true);
  assert.equal(monitor.getSnapshot().diagnostics.malformedLines, 1);
});
test('attachment metadata and open-page context do not dominate session titles', () => {
  assert.equal(titlePreview('<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>'), '');
  assert.equal(titlePreview('{"page_id":null}'), '');
  assert.equal(titlePreview('# Files mentioned by the user:\n## a.png\n## My request:\n[REA](https://github.com/morluto/rea)"D:\\Table\\REA"我把当前REA项目已经下载下来'), '我把当前REA项目已经下载下来');
});
test('a new legacy request with identical usage is not mistaken for a known cumulative modern mirror', async t => {
  const { day, monitor } = await fixture(t);
  await fs.writeFile(path.join(day, 'same-usage.jsonl'), header()
    + line('token_usage_record', { thread_id: 's1', response_id: 'r1', usage: raw(100, 0, 0), thread_token_usage: raw(100, 0, 0) })
    + line('event_msg', { type: 'token_count', info: { total_token_usage: raw(200, 0, 0), last_token_usage: raw(100, 0, 0) } }, '2026-10-28T03:00:01Z'));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 200);
});
test('cross-file Claude streaming snapshots select the complete message usage', async t => {
  const { claudeHome, monitor } = await fixture(t);
  const assistant = output => JSON.stringify({ type: 'assistant', sessionId: 'c1', timestamp, message: { id: 'same', model: 'claude-unverified', content: [], usage: { input_tokens: 10, output_tokens: output } } }) + '\n';
  await fs.writeFile(path.join(claudeHome, 'projects', 'test', 'a.jsonl'), assistant(2));
  await fs.writeFile(path.join(claudeHome, 'projects', 'test', 'b.jsonl'), assistant(8));
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().totals.total, 18);
  assert.equal(monitor.getSnapshot().totals.output, 8);
});
