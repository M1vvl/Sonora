'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../ui/activity-feed.js'), 'utf8');
function harness(options = {}) {
  const allAnimations = [], documentEvents = new Map(), preferenceEvents = new Map(), windowEvents = new Map();
  class Element {
    constructor() { this.dataset = {}; this.children = []; this.scrollTop = 0; this.text = ''; this.classes = new Set(); this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c) }; }
    replaceChildren(...children) { this.children = children; this.text = ''; }
    get firstElementChild() { return this.children[0] || null; }
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this.text; }
    set textContent(value) { this.text = value; this.children = []; }
    animate(frames, config) {
      let resolve, reject;
      const finished = new Promise((a, b) => { resolve = a; reject = b; });
      const animation = { finished, frames, config, cancelled: false, resolve, cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
      allAnimations.push(animation); return animation;
    }
  }
  const feed = new Element(), viewport = new Element(), track = new Element();
  const reduced = { matches: Boolean(options.reduced), addEventListener: (key, cb) => preferenceEvents.set(key, cb), removeEventListener: key => preferenceEvents.delete(key) };
  const document = { hidden: false, documentElement: { dataset: {} }, getElementById: key => ({ 'activity-feed': feed, 'activity-viewport': viewport, 'activity-track': track })[key], createElement: () => new Element(), addEventListener: (key, cb) => documentEvents.set(key, cb), removeEventListener: key => documentEvents.delete(key) };
  const window = { PulseTextPreview: { clean: value => String(value || '').replace(/\*\*/g, '').trim() }, addEventListener: (key, cb) => windowEvents.set(key, cb), removeEventListener: key => windowEvents.delete(key) };
  vm.runInNewContext(code, { document, window, matchMedia: () => reduced, getComputedStyle: () => ({ getPropertyValue: () => 'cubic-bezier(.23, 1, .32, 1)' }) });
  return { api: window.PulseActivityFeed, feed, viewport, track, document, reduced, documentEvents, preferenceEvents, windowEvents, allAnimations,
    async finishPair(index) { allAnimations[index].resolve(); allAnimations[index + 1].resolve(); await new Promise(resolve => setImmediate(resolve)); } };
}
const event = (id, text = id) => ({ id, type: 'text', timestamp: `2026-10-28T12:00:${String(Number(id.replace(/\D/g, '')) || 0).padStart(2, '0')}Z`, text });

test('initial history shows the latest event without replay and repeated snapshots do not animate', () => {
  const h = harness(); h.api.setExpanded(true);
  h.api.update({ sessionId: 'a', events: [event('1'), event('2', '**latest**')] });
  assert.equal(h.track.textContent, 'latest'); assert.equal(h.allAnimations.length, 0);
  h.api.update({ sessionId: 'a', events: [event('1'), event('2', '**updated stream**')] });
  assert.equal(h.track.textContent, 'updated stream'); assert.equal(h.allAnimations.length, 0);
  h.api.dispose();
});

test('a new event moves upward once, and streaming changes update its pending entry', async () => {
  const h = harness(); h.api.setExpanded(true); h.api.update({ sessionId: 'a', events: [event('1')] });
  h.api.update({ sessionId: 'a', events: [event('1'), event('2', 'first chunk')] });
  assert.equal(h.allAnimations.length, 2); assert.equal(h.track.children.length, 2);
  assert.equal(h.allAnimations[0].frames[1].transform, 'translateY(-100%)');
  h.api.update({ sessionId: 'a', events: [event('1'), event('2', 'complete text')] });
  assert.equal(h.allAnimations.length, 2); assert.equal(h.track.children[1].textContent, 'complete text');
  await h.finishPair(0); assert.equal(h.track.textContent, 'complete text'); assert.equal(h.track.children.length, 1);
  h.api.dispose();
});

test('burst updates keep only six queued transitions and eventually show the newest event', async () => {
  const h = harness(); h.api.setExpanded(true); h.api.update({ sessionId: 'a', events: [event('1')] });
  h.api.update({ sessionId: 'a', events: [event('2')] });
  h.api.update({ sessionId: 'a', events: Array.from({ length: 18 }, (_, i) => event(String(i + 3))) });
  assert.equal(h.feed.dataset.activityQueued, '6');
  for (let pair = 0; pair < 7; pair++) await h.finishPair(pair * 2);
  assert.equal(h.allAnimations.length, 14); assert.equal(h.track.textContent, '20'); assert.equal(h.feed.dataset.activityQueued, '0');
  h.api.dispose();
});

test('switching sessions cancels pending work and stale animation completion cannot overwrite the new session', async () => {
  const h = harness(); h.api.setExpanded(true); h.api.update({ sessionId: 'a', events: [event('1')] });
  h.api.update({ sessionId: 'a', events: [event('2')] });
  h.api.update({ sessionId: 'b', events: [event('3', 'different chat')] });
  assert.ok(h.allAnimations.every(a => a.cancelled));
  await h.finishPair(0); assert.equal(h.track.textContent, 'different chat'); assert.equal(h.track.children.length, 1);
  h.api.dispose();
});

test('collapse and visibility hide settle to the latest event without historical replay', async () => {
  const h = harness(); h.api.setExpanded(true); h.api.update({ sessionId: 'a', events: [event('1')] });
  h.api.update({ sessionId: 'a', events: [event('2')] }); h.api.update({ sessionId: 'a', events: [event('3')] });
  h.api.setExpanded(false); assert.equal(h.track.textContent, '3');
  h.api.setExpanded(true); assert.equal(h.allAnimations.length, 2);
  h.api.update({ sessionId: 'a', events: [event('4')] });
  h.document.hidden = true; h.documentEvents.get('visibilitychange')();
  assert.equal(h.track.textContent, '4');
  await h.finishPair(2); assert.equal(h.track.textContent, '4'); h.api.dispose();
});

test('system and still modes reduce motion, while explicit scroll remains available', () => {
  const h = harness({ reduced: true }); h.api.setExpanded(true); h.api.setMotion('system');
  h.api.update({ sessionId: 'a', events: [event('1')] }); h.api.update({ sessionId: 'a', events: [event('2')] });
  assert.equal(h.allAnimations.length, 0); assert.equal(h.track.textContent, '2');
  h.api.setMotion('scroll'); h.api.update({ sessionId: 'a', events: [event('3')] }); assert.equal(h.allAnimations.length, 2);
  h.api.setMotion('still'); assert.equal(h.track.textContent, '3');
  h.api.update({ sessionId: 'a', events: [event('4')] }); assert.equal(h.allAnimations.length, 2); assert.equal(h.track.textContent, '4');
  h.api.dispose();
});

test('loading placeholders update, temporary errors stay out of activity history, and disposal releases resources', () => {
  const h = harness(); h.api.update({ sessionId: 'a', loading: true, events: [] }); assert.match(h.track.textContent, /正在读取/);
  h.api.update({ sessionId: 'a', loading: false, events: [] }); assert.match(h.track.textContent, /等待这个/);
  h.api.setExpanded(true); h.api.update({ sessionId: 'a', events: [event('1')] }); assert.equal(h.allAnimations.length, 0);
  h.api.showError('bridge unavailable'); assert.match(h.track.textContent, /操作未完成/); assert.equal(h.feed.dataset.activityError, 'true');
  h.api.setExpanded(false); assert.equal(h.track.textContent, '1'); assert.equal(h.feed.dataset.activityError, 'false');
  h.api.dispose(); assert.equal(h.documentEvents.size, 0); assert.equal(h.preferenceEvents.size, 0); assert.equal(h.windowEvents.size, 0);
  h.api.update({ sessionId: 'b', events: [event('2')] }); assert.equal(h.track.textContent, '1');
});
