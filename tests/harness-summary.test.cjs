'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { project, shorten } = require('../ui/harness-summary.js');
test('Harness summary follows observed tool, message, waiting and completed states', () => {
  const session = { id: 'a', status: 'working', events: [{ id: 'message', type: 'message', title: '助手', role: 'assistant', text: '**正在检查菜单宽度** :codex-annotation{index="1"}', timestamp: '1' }] };
  assert.equal(project(session).text, '正在检查菜单宽度');
  assert.notEqual(project(session).text, '助手');
  session.events.push({ id: 'tool', type: 'tool', title: 'functions.exec_command', args: 'secret', timestamp: '2' });
  assert.equal(project(session).text, '正在执行命令');
  session.status = 'waiting'; assert.equal(project(session).text, '等待你的输入');
  session.status = 'completed'; assert.equal(project(session).text, '本轮已完成');
  assert.equal(project(null, true).text, '正在发现会话');
});
test('same streamed event keeps its transition key, switch and state changes produce a different key', () => {
  const event = { id: 'stream', type: 'message', text: '正在分析', timestamp: '1' };
  const a = project({ id: 'a', status: 'working', events: [event] });
  const b = project({ id: 'a', status: 'working', events: [{ ...event, text: '正在分析项目记录' }] });
  assert.equal(a.key, b.key); assert.notEqual(a.text, b.text);
  assert.notEqual(project({ id: 'a', status: 'completed', events: [event] }).key, a.key);
  assert.notEqual(project({ id: 'b', status: 'working', events: [event] }).sessionId, a.sessionId);
  assert.ok(Array.from(shorten('长消息'.repeat(30))).length <= 28);
  assert.match(shorten('长消息'.repeat(30)), /…$/);
});
