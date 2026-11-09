'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clean } = require('../ui/text-preview.js');
const { forIsland } = require('../src/snapshots.cjs');
test('island previews hide internal directives and format text without changing the words', () => {
  assert.equal(clean('已完成 **Agent Pulse**。 :codex-annotation{index="1"} 查看 [官方文档](https://example.com)。'), '已完成 Agent Pulse。 查看 官方文档。');
  assert.equal(clean('## 结果\n```js\nconsole.log(`ok`);\n```'), '结果\nconsole.log(ok);');
  assert.equal(clean(''), '');
  assert.equal(clean('abcd', 3), 'abc');
});
test('island event window is bounded, chronological, and contains only display fields', () => {
  const events = Array.from({ length: 20 }, (_, i) => ({ id: String(i), type: i===19?'usage':'text', title: '助手', text: 'a'.repeat(3000), args: 'private', timestamp: String(i).padStart(2,'0') }));
  const projected = forIsland({ sessions: [{ id: 'main', events }] }).sessions[0].events;
  assert.equal(projected.length, 6);
  assert.deepEqual(projected.map(event=>event.id), ['13','14','15','16','17','18']);
  assert.equal(projected[0].args, undefined);
  assert.equal(projected[0].text.length, 1600);
  assert.equal(events[13].text.length, 3000);
});
