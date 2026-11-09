'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../ui/header-status.js'), 'utf8');
function harness(options = {}) {
  const animations = [], documentEvents = new Map(), preferenceEvents = new Map(), windowEvents = new Map();
  class Element {
    constructor() {
      this.dataset = {}; this.children = []; this.text = ''; this.title = '会话提示保持不变';
      this.classes = new Set(); this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value) };
    }
    replaceChildren(...children) { this.children = children; this.text = ''; }
    get firstElementChild() { return this.children[0] || null; }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text; }
    set textContent(value) { this.text = value; this.children = []; }
    animate(frames, timing) {
      let resolve, reject;
      const finished = new Promise((a, b) => { resolve = a; reject = b; });
      const animation = { finished, frames, timing, cancelled: false, resolve, cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
      animations.push(animation); return animation;
    }
  }
  const host = new Element();
  const reduced = { matches: Boolean(options.reduced), addEventListener: (key, cb) => preferenceEvents.set(key, cb), removeEventListener: key => preferenceEvents.delete(key) };
  const document = { hidden: false, getElementById: id => id === 'island-title' ? host : null, createElement: () => new Element(), addEventListener: (key, cb) => documentEvents.set(key, cb), removeEventListener: key => documentEvents.delete(key) };
  const window = { PulseTextPreview: { clean: value => String(value).replace(/\*\*/g, '') }, addEventListener: (key, cb) => windowEvents.set(key, cb), removeEventListener: key => windowEvents.delete(key) };
  vm.runInNewContext(code, { document, window, matchMedia: () => reduced, getComputedStyle: () => ({ getPropertyValue: () => 'cubic-bezier(.23, 1, .32, 1)' }) });
  return { api: window.PulseHeaderStatus, host, animations, document, reduced, documentEvents, preferenceEvents, windowEvents,
    async finishPair(index) { animations[index].resolve(); animations[index + 1].resolve(); await new Promise(resolve => setImmediate(resolve)); } };
}
const update = (h, key, text, sessionId = 'session') => h.api.update({ sessionId, key, text });

test('header shows one cleaned and truncated line without overwriting the session tooltip', () => {
  const h = harness();
  update(h, 'initial', '**正在读取**\n  Harness 状态');
  assert.equal(h.host.textContent, '正在读取 Harness 状态');
  assert.equal(h.host.children.length, 1); assert.equal(h.animations.length, 0);
  assert.equal(h.host.title, '会话提示保持不变');
  update(h, 'initial', '音'.repeat(40));
  assert.equal(Array.from(h.host.textContent).length, 28); assert.ok(h.host.textContent.endsWith('…'));
  assert.equal(h.animations.length, 0);
  h.api.dispose();
});

test('new Harness status slides upward and commits a single node', async () => {
  const h = harness(); update(h, 'a', '读取项目'); update(h, 'b', '正在修改代码');
  assert.equal(h.animations.length, 2); assert.equal(h.host.children.length, 2);
  assert.equal(h.animations[0].frames[1].transform, 'translateY(-100%)');
  assert.equal(h.animations[1].frames[0].transform, 'translateY(100%)');
  assert.equal(h.animations[0].timing.duration, 240);
  await h.finishPair(0);
  assert.equal(h.host.textContent, '正在修改代码'); assert.equal(h.host.children.length, 1);
  assert.equal(h.host.dataset.headerStatusTransitioning, 'false'); h.api.dispose();
});

test('rapid updates keep one latest pending status and skip obsolete intermediates', async () => {
  const h = harness(); update(h, 'a', 'A'); update(h, 'b', 'B');
  for (let i = 0; i < 50; i++) update(h, `event-${i}`, `Status ${i}`);
  assert.equal(h.animations.length, 2); assert.equal(h.host.dataset.headerStatusQueued, '1');
  await h.finishPair(0); assert.equal(h.animations.length, 4);
  assert.equal(h.host.children[1].textContent, 'Status 49');
  await h.finishPair(2); assert.equal(h.host.textContent, 'Status 49');
  assert.equal(h.host.dataset.headerStatusQueued, '0'); h.api.dispose();
});

test('same-key streaming changes update nodes in place and do not displace a newer pending state', async () => {
  const h = harness(); update(h, 'a', '正在读取'); update(h, 'a', '正在读取两个文件');
  assert.equal(h.animations.length, 0); assert.equal(h.host.textContent, '正在读取两个文件');
  update(h, 'b', '开始修改'); update(h, 'c', '准备验证'); update(h, 'b', '继续修改');
  assert.equal(h.animations.length, 2); assert.equal(h.host.children[1].textContent, '继续修改');
  update(h, 'a', '读取完成'); assert.equal(h.host.children[0].textContent, '读取完成');
  await h.finishPair(0); assert.equal(h.host.children[1].textContent, '准备验证');
  await h.finishPair(2); assert.equal(h.host.textContent, '准备验证'); h.api.dispose();
});

test('session switches and hidden windows cancel transitions without stale completion or replay', async () => {
  const h = harness(); update(h, 'a', '第一会话'); update(h, 'b', '旧状态');
  update(h, 'x', '新会话', 'other-session');
  assert.ok(h.animations.every(value => value.cancelled));
  await h.finishPair(0); assert.equal(h.host.textContent, '新会话');
  update(h, 'y', '新工作', 'other-session'); update(h, 'z', '最新工作', 'other-session');
  h.document.hidden = true; h.documentEvents.get('visibilitychange')();
  assert.equal(h.host.textContent, '最新工作');
  await h.finishPair(2); assert.equal(h.host.textContent, '最新工作');
  h.document.hidden = false; h.documentEvents.get('visibilitychange')();
  assert.equal(h.animations.length, 4); h.api.dispose();
});

test('system motion respects the OS, explicit scroll overrides locally, and still mode cancels pending work', () => {
  const h = harness({ reduced: true }); h.api.setMotion('system'); update(h, 'a', 'A'); update(h, 'b', 'B');
  assert.equal(h.animations.length, 0); assert.equal(h.host.textContent, 'B');
  h.api.setMotion('scroll'); update(h, 'c', 'C'); assert.equal(h.animations.length, 2);
  h.api.setMotion('still'); assert.equal(h.host.textContent, 'C'); assert.ok(h.animations.every(value => value.cancelled));
  update(h, 'd', 'D'); assert.equal(h.animations.length, 2); assert.equal(h.host.textContent, 'D'); h.api.dispose();
});

test('unchanged summaries do not animate, and disposal releases every observer', async () => {
  const h = harness(); update(h, 'a', '相同摘要'); update(h, 'b', '相同摘要');
  assert.equal(h.animations.length, 0); assert.equal(h.host.dataset.headerStatusKey, 'b');
  update(h, 'c', '下一步'); h.api.dispose();
  assert.equal(h.host.textContent, '下一步'); assert.equal(h.documentEvents.size, 0); assert.equal(h.preferenceEvents.size, 0); assert.equal(h.windowEvents.size, 0);
  await h.finishPair(0); update(h, 'd', '不应出现'); assert.equal(h.host.textContent, '下一步');
});
