'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, HOVER_MS } = require('../ui/dashboard-drag.js');

function harness(options = {}) {
  let time = 0, nextId = 1;
  const timers = new Map(), frames = new Map(), calls = [], removals = [];
  class Events {
    constructor() { this.events = new Map(); }
    addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(callback); }
    removeEventListener(name, callback) { this.events.get(name)?.delete(callback); }
    emit(name, event = {}) { for (const callback of this.events.get(name) || []) callback(event); }
    count() { return [...this.events.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
  }
  class Element extends Events {
    constructor(parent = null, interactive = false) {
      super(); this.nodeType = 1; this.parentElement = parent; this.interactive = interactive; this.attributes = new Map(); this.classes = new Set(); this.captured = new Set();
      this.classList = { add: (...names) => names.forEach(name => this.classes.add(name)), remove: (...names) => names.forEach(name => this.classes.delete(name)) };
    }
    contains(node) { for (let item = node; item; item = item.parentElement) if (item === this) return true; return false; }
    closest() { return this.interactive ? this : this.parentElement?.closest() || null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
  }
  const view = new Events(), document = new Events();
  view.performance = { now: () => time };
  view.setTimeout = (callback, delay) => { const id = nextId++; timers.set(id, { callback, at: time + delay }); return id; };
  view.clearTimeout = id => timers.delete(id);
  view.requestAnimationFrame = callback => { const id = nextId++; frames.set(id, callback); return id; };
  view.cancelAnimationFrame = id => frames.delete(id);
  const root = new Element(), paragraph = new Element(root), control = new Element(root, true);
  const text = { nodeType: 3, parentElement: paragraph, nodeValue: '你好，Agent Pulse 正在运行' };
  root.ownerDocument = document; document.defaultView = view; document.hidden = false;
  const selection = {
    anchorNode: null, focusNode: null, anchorOffset: 0, focusOffset: 0, isCollapsed: true,
    removeAllRanges() { removals.push(true); this.anchorNode = this.focusNode = null; this.isCollapsed = true; },
    setBaseAndExtent(a, ao, b, bo) { this.anchorNode = a; this.anchorOffset = ao; this.focusNode = b; this.focusOffset = bo; this.isCollapsed = a === b && ao === bo; },
    toString() { return this.anchorNode === text && this.focusNode === text ? text.nodeValue.slice(Math.min(this.anchorOffset, this.focusOffset), Math.max(this.anchorOffset, this.focusOffset)) : ''; }
  };
  document.getSelection = () => selection;
  document.caretPositionFromPoint = x => ({ offsetNode: text, offset: Math.max(0, Math.min(text.nodeValue.length, Math.floor((x - 10) / 10))) });
  document.createRange = () => ({
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    getClientRects() { return [{ left: 10 + this.startOffset * 10, right: 10 + this.endOffset * 10, top: 20, bottom: 38, width: (this.endOffset - this.startOffset) * 10, height: 18 }]; }
  });
  const controller = createController({ root, moveWindow: payload => { calls.push(payload); return options.moveWindow?.(payload); } });
  function event(values = {}) {
    return { target: paragraph, pointerId: 7, button: 0, buttons: 1, detail: 1, clientX: 12, clientY: 26, screenX: 112, screenY: 126, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
  }
  function emit(name, values) { const value = event(values); (name === 'pointerdown' || name === 'click' || name === 'pointerleave' || name === 'lostpointercapture' ? root : document).emit(name, value); return value; }
  function advance(amount) {
    time += amount;
    for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
  }
  function frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); }
  return { controller, root, paragraph, control, text, document, view, selection, calls, removals, timers, frames, emit, advance, frame };
}
const drained = () => new Promise(resolve => setImmediate(resolve));
const position = (dx, dy) => ({ clientX: 12 + dx, clientY: 26 + dy, screenX: 112 + dx, screenY: 126 + dy });

test('quick text and blank-surface drags move the window with absolute screen deltas', async () => {
  const h = harness(); h.emit('pointerdown'); h.emit('pointermove', position(30, 2)); h.frame();
  h.emit('pointerup', position(30, 2)); await drained();
  assert.deepEqual(h.calls, [{ deltaX: 0, deltaY: 0, phase: 'begin' }, { deltaX: 30, deltaY: 2, phase: 'move' }, { deltaX: 30, deltaY: 2, phase: 'end' }]);
  assert.equal(h.controller.state.mode, 'idle'); assert.equal(h.root.captured.size, 0);
  assert.equal(h.selection.toString(), ''); h.controller.dispose();
});

test('only 320ms of actual visible glyph hover arms horizontal Chinese selection', async () => {
  const h = harness(); h.emit('pointermove'); h.advance(HOVER_MS - 1);
  assert.equal(h.controller.state.armed, false); h.advance(1);
  assert.equal(h.paragraph.attributes.get('data-pulse-drag-text-armed'), 'true');
  h.emit('pointerdown'); h.emit('pointermove', position(30, 0));
  assert.equal(h.controller.state.mode, 'selection'); assert.equal(h.selection.toString(), '你好，');
  h.emit('pointerup', position(30, 0)); await drained();
  assert.equal(h.calls.length, 0); assert.ok(h.root.classes.has('dashboard-selection-readable')); h.controller.dispose();
});

test('armed vertical and diagonal drags still move the window, and 319ms does not select', async () => {
  for (const [elapsed, dx, dy] of [[320, 2, 20], [320, 12, 12], [319, 30, 0]]) {
    const h = harness(); h.emit('pointermove'); h.advance(elapsed); h.emit('pointerdown');
    h.emit('pointermove', position(dx, dy)); h.frame(); h.emit('pointerup', position(dx, dy)); await drained();
    assert.equal(h.calls[0].phase, 'begin'); assert.equal(h.calls.at(-1).phase, 'end'); assert.equal(h.selection.toString(), ''); h.controller.dispose();
  }
});

test('empty borders near a caret and interactive controls never arm or steal native behavior', async () => {
  const h = harness(); h.emit('pointermove', { clientX: 12, clientY: 60 }); h.advance(400);
  assert.equal(h.controller.state.armed, false); assert.equal(h.timers.size, 0);
  const down = h.emit('pointerdown', { target: h.control });
  h.emit('pointermove', { target: h.control, ...position(30, 0) });
  h.emit('pointerup', { target: h.control, ...position(30, 0) }); await drained();
  assert.equal(down.defaultPrevented, false); assert.equal(h.root.captured.size, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.emit('click', { target: h.control }).defaultPrevented, false); h.controller.dispose();
});

test('old selection survives pointerdown and pending motion; a confirmed click or drag can clear it', async () => {
  const h = harness(); h.selection.setBaseAndExtent(h.text, 0, h.text, 2);
  h.emit('pointerdown'); h.emit('pointermove', position(2, 1));
  assert.equal(h.selection.toString(), '你好'); assert.equal(h.removals.length, 0);
  h.emit('pointerup', position(2, 1)); assert.equal(h.selection.toString(), ''); assert.equal(h.removals.length, 1);
  h.selection.setBaseAndExtent(h.text, 0, h.text, 2);
  h.emit('pointerdown'); h.emit('pointermove', position(0, 12)); h.emit('pointerup', position(0, 12)); await drained();
  assert.equal(h.removals.length, 2); assert.equal(h.selection.toString(), ''); h.controller.dispose();
});

test('reverse selection remains directional, and the caretRangeFromPoint fallback selects real text', () => {
  const h = harness();
  h.document.caretRangeFromPoint = (x, y) => { const result = h.document.savedCaret(x, y); return { startContainer: result.offsetNode, startOffset: result.offset }; };
  h.document.savedCaret = h.document.caretPositionFromPoint; delete h.document.caretPositionFromPoint;
  h.emit('pointermove', position(30, 0)); h.advance(320); h.emit('pointerdown', position(30, 0)); h.emit('pointermove', position(0, 0));
  assert.equal(h.selection.toString(), '你好，'); assert.ok(h.selection.anchorOffset > h.selection.focusOffset);
  h.emit('pointerup', position(0, 0)); h.controller.dispose();
});

test('high frequency movement coalesces behind a slow bridge and phases remain ordered', async () => {
  const pending = [], h = harness({ moveWindow: () => new Promise(resolve => pending.push(resolve)) });
  h.emit('pointerdown'); h.emit('pointermove', position(10, 0)); await drained();
  for (let index = 11; index <= 100; index++) { h.emit('pointermove', position(index, 0)); h.frame(); }
  assert.equal(h.calls.length, 1); assert.equal(h.controller.state.queued, 1);
  h.emit('pointerup', position(100, 0)); assert.equal(h.controller.state.queued, 2);
  pending.shift()(); await drained(); assert.deepEqual(h.calls[1], { deltaX: 100, deltaY: 0, phase: 'move' });
  pending.shift()(); await drained(); assert.equal(h.calls[2].phase, 'end');
  pending.shift()(); await drained(); h.controller.dispose();
});

test('blur, hidden, cancellation, and disposal release capture, frames, timers, and listeners', async () => {
  const h = harness();
  h.emit('pointermove'); h.advance(80); h.emit('pointermove', position(1, 0)); h.emit('pointerleave');
  assert.equal(h.timers.size, 0);
  h.emit('pointermove'); h.advance(20); h.emit('pointermove', position(2, 0)); h.controller.dispose();
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.root.count() + h.document.count() + h.view.count(), 0);
  for (const reason of ['blur', 'hidden', 'pointercancel']) {
    const other = harness(); other.emit('pointerdown'); other.emit('pointermove', position(20, 3));
    if (reason === 'blur') other.view.emit('blur');
    else if (reason === 'hidden') { other.document.hidden = true; other.document.emit('visibilitychange'); }
    else other.emit('pointercancel');
    other.frame(); await drained();
    assert.equal(other.controller.state.mode, 'idle'); assert.equal(other.root.captured.size, 0); assert.equal(other.frames.size, 0);
    assert.deepEqual(other.calls.map(call => call.phase), ['begin', 'end']); other.controller.dispose();
  }
});

test('only the drag-generated click is suppressed; new pointer and keyboard clicks remain native', async () => {
  const h = harness(); h.emit('pointerdown'); h.emit('pointermove', position(20, 0)); h.emit('pointerup', position(20, 0)); await drained();
  const generated = h.emit('click'); assert.equal(generated.defaultPrevented, true); assert.equal(generated.stopped, true);
  h.emit('pointerdown'); h.emit('pointermove', position(20, 0)); h.emit('pointerup', position(20, 0));
  assert.equal(h.emit('click', { detail: 0, pointerId: -1 }).defaultPrevented, false);
  h.emit('pointerdown', { target: h.control }); assert.equal(h.emit('click', { target: h.control }).defaultPrevented, false);
  h.controller.dispose(); await drained();
});

test('bridge rejection is contained and does not leave a gesture or unhandled promise', async () => {
  const h = harness({ moveWindow: () => Promise.reject(new Error('IPC unavailable')) });
  h.emit('pointerdown'); h.emit('pointermove', position(15, 0)); h.frame(); h.emit('pointerup', position(15, 0));
  await drained(); assert.equal(h.controller.state.mode, 'idle'); assert.equal(h.calls.at(-1).phase, 'end'); h.controller.dispose();
});

test('live content only defers replacement for its own pending or selected text', () => {
  const {isReading}=require('../ui/dashboard-drag.js');
  const inside={},outside={};let marker=null,selection=null;
  const surface={ownerDocument:{getSelection:()=>selection},querySelector:()=>marker,contains:node=>node===inside};
  assert.equal(isReading(null),false);assert.equal(isReading(surface),false);
  marker={};assert.equal(isReading(surface),true);marker=null;
  selection={isCollapsed:false,anchorNode:inside,focusNode:inside};assert.equal(isReading(surface),true);
  selection.focusNode=outside;assert.equal(isReading(surface),false);
  selection={isCollapsed:true,anchorNode:inside,focusNode:inside};assert.equal(isReading(surface),false);
});

test('touch, pen, secondary pointers, and the right mouse button keep native gestures', async () => {
  const h = harness();
  for (const input of [{ pointerType: 'touch' }, { pointerType: 'pen' }, { isPrimary: false }, { button: 2 }]) {
    const down = h.emit('pointerdown', input); h.emit('pointermove', { ...position(30, 0), ...input }); h.emit('pointerup', { ...position(30, 0), ...input });
    assert.equal(down.defaultPrevented, false); assert.equal(h.controller.state.mode, 'idle');
  }
  await drained(); assert.equal(h.calls.length, 0); assert.equal(h.root.captured.size, 0); h.controller.dispose();
});
