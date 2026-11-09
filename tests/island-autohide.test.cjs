'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { JSDOM } = require('jsdom');
const { createIslandAutoHide, insideRoundedBounds, isDownwardPull } = require('../src/island-autohide.cjs');
const { createSettings, sanitize } = require('../src/settings.cjs');

function fixture() {
  let stamp = 0;
  let sequence = 0;
  const timers = new Map();
  const saved = [];
  const inputs = [];
  const visibility = [];
  const positions = [];
  let point = { x: 700, y: 600 };
  let expanded = false;
  let visible = true;
  let destroyed = false;
  let bounds = { x: 500, y: 200, width: 480, height: 44 };
  const settings = { islandEnabled: true, islandAutoHide: false };
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 2, bounds: { x: -1280, y: -200, width: 1280, height: 1024 }, workArea: { x: -1280, y: -200, width: 1280, height: 984 } }
  ];
  const window = {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    getBounds: () => ({ ...bounds }),
    setPosition(x, y) { positions.push({x, y}); bounds = { ...bounds, x, y }; },
    setIgnoreMouseEvents(value, options) { inputs.push({ value, options }); },
    showInactive() { visible = true; },
    hide() { visible = false; }
  };
  const controller = createIslandAutoHide({
    getWindow: () => destroyed ? null : window,
    getSettings: () => ({ ...settings }),
    saveSettings(value) { saved.push(value); Object.assign(settings, value); },
    screen: {
      getCursorScreenPoint: () => point,
      getAllDisplays: () => displays,
      getDisplayNearestPoint: value => value.x < 0 ? displays[1] : displays[0]
    },
    isExpanded: () => expanded,
    onSettingsChanged() {},
    onVisibilityChanged: value => visibility.push(value),
    now: () => stamp,
    setTimer(fn) { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimer(id) { timers.delete(id); }
  });
  return {
    controller, saved, inputs, visibility, settings, timers, displays, positions,
    resize(width) { bounds = {...bounds, width}; controller.configure(); },
    bounds: () => ({ ...bounds }), visible: () => visible,
    cursor(value) { point = value; },
    expand(value) { expanded = value; controller.configure(); },
    destroy(notify = true) { destroyed = true; if (notify) controller.configure(); },
    step(ms) { stamp += ms; const batch = [...timers.values()]; timers.clear(); for (const fn of batch) fn(); },
    close() { controller.dispose(); }
  };
}

test('island centers on full display bounds despite a side taskbar and odd DIP widths', () => {
  const f = fixture();
  try {
    f.displays[0].bounds.width = 1921;
    f.displays[0].workArea = {x: 64, y: 0, width: 1857, height: 1040};
    f.controller.configure();
    assert.equal(f.bounds().x, 721);
    const calls = f.positions.length;
    for (let index = 0; index < 10; index++) f.controller.configure();
    assert.equal(f.positions.length, calls, 'rounded DIP coordinates must not reposition on every configuration');
    f.resize(520);
    assert.equal(f.bounds().x, 701);
    f.settings.islandAutoHide = true;
    f.controller.configure();
    f.step(1700);
    f.step(500);
    f.cursor({x: -900, y: -200});
    f.step(200);
    f.step(200);
    assert.equal(f.bounds().x, -900);
  } finally { f.close(); }
});

test('top-edge reveal and delayed leave share the persistent automatic mode', () => {
  const f = fixture();
  try {
    f.settings.islandAutoHide = true;
    f.controller.configure();
    assert.equal(f.bounds().y, 10);
    assert.equal(f.visible(), true);
    f.step(500);
    assert.equal(f.visible(), false);
    f.cursor({ x: 700, y: 0 });
    f.step(200);
    assert.equal(f.visible(), false, 'a transient edge crossing must not flash the window');
    f.step(200);
    assert.equal(f.visible(), true);
    f.cursor({ x: 700, y: 25 });
    f.step(500);
    assert.equal(f.visible(), true);
    assert.deepEqual(f.visibility, [false, true]);
    assert.equal(f.timers.size, 1);
  } finally { f.close(); }
  assert.equal(f.timers.size, 0);
});

test('downward pulls toggle setting, while horizontal drags and cancellation preserve it', () => {
  const f = fixture();
  try {
    f.controller.configure();
    f.controller.beginDrag();
    assert.equal(f.controller.endDrag({ dx: 3, dy: 60 }), true);
    assert.equal(f.settings.islandAutoHide, true);
    f.controller.beginDrag();
    f.step(1000);
    assert.equal(f.visible(), true);
    assert.equal(f.controller.endDrag({ dx: 0, dy: 60 }), true);
    assert.equal(f.settings.islandAutoHide, false);
    for (const offset of [{ dx: 90, dy: 55 }, { dx: 1, dy: 47 }, { dx: 0, dy: 60, cancelled: true }]) {
      f.controller.beginDrag();
      assert.equal(f.controller.endDrag(offset), false);
    }
    assert.equal(f.saved.length, 2);
    f.step(1000);
    assert.equal(f.visible(), true);
  } finally { f.close(); }
});

test('both modes keep the same top dock and mode feedback stays visible before delayed hide', () => {
  const f = fixture();
  try {
    f.controller.configure();
    assert.equal(f.bounds().y, 10, 'fixed mode cannot retain an old dragged vertical position');
    const fixed = f.bounds();
    f.controller.beginDrag();
    f.controller.endDrag({ dx: 0, dy: 60 });
    assert.deepEqual(f.bounds(), fixed);
    f.step(1400);
    assert.equal(f.visible(), true, 'release below the island must not immediately hide the feedback');
    f.step(300); f.step(500);
    assert.equal(f.visible(), false);
  } finally { f.close(); }
});

test('expanded content and holds delay hide, and top edge on a negative-coordinate display reveals there', () => {
  const f = fixture();
  try {
    f.settings.islandAutoHide = true;
    f.controller.configure();
    f.expand(true);
    f.step(1000);
    assert.equal(f.visible(), true);
    f.expand(false);
    f.controller.hold(true);
    f.step(1000);
    assert.equal(f.visible(), true);
    f.controller.hold(false);
    f.step(500);
    assert.equal(f.visible(), false);
    f.cursor({ x: -400, y: -200 });
    f.step(200);
    f.step(200);
    assert.equal(f.visible(), true);
    const b = f.bounds();
    assert.equal(b.y, -190);
    assert(b.x >= -1280 && b.x + b.width <= 0);
  } finally { f.close(); }
});

test('only transparent round-corner pixels ignore input and disabled/destroyed controllers stop polling', () => {
  const f = fixture();
  try {
    f.controller.configure();
    const b = f.bounds();
    f.cursor({ x: b.x, y: b.y });
    f.step(125);
    assert.equal(f.inputs.at(-1).value, true);
    f.cursor({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    f.step(125);
    assert.equal(f.inputs.at(-1).value, false);
    f.settings.islandEnabled = false;
    f.controller.configure();
    assert.equal(f.timers.size, 0);
    f.settings.islandEnabled = true;
    f.controller.configure();
    f.destroy(false);
    f.step(125);
    assert.equal(f.timers.size, 0);
  } finally { f.close(); }
});

test('auto hide is type-checked and survives a separate settings instance', () => {
  assert.equal(sanitize({ islandAutoHide: 'yes' }).islandAutoHide, false);
  assert.equal(isDownwardPull({ dy: Infinity }), false);
  assert(insideRoundedBounds({ x: -5, y: 15 }, { x: -15, y: 0, width: 40, height: 30 }, 15));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-island-mode-'));
  const file = path.join(directory, 'settings.json');
  const first = createSettings(file);
  first.save({ islandAutoHide: true, interfaceTheme: 'carbon-lime' });
  assert.equal(createSettings(file).get().islandAutoHide, true);
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
});

test('header uses double click or keyboard to expand and whole-header pull sends one mode gesture', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../ui/island.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  w.pulse = {
    getSettings: async () => ({}), getSnapshot: async () => null,
    onSnapshot() {}, onSettings() {},
    setIslandExpanded: async value => { calls.push(['expanded', value]); return {}; },
    islandInteraction: async value => { calls.push(['interaction', value]); return {}; },
    moveIsland: async value => { calls.push(['move', value]); return {}; }
  };
  w.PulseActivityFeed = { setExpanded() {}, setMotion() {} };
  const header = w.document.querySelector('.island-header');
  header.setPointerCapture = () => {};
  function pointer(type, x, y) {
    const event = new w.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: 1, button: 0, screenX: x, screenY: y })) {
      Object.defineProperty(event, key, { value });
    }
    header.dispatchEvent(event);
  }
  try {
    w.eval(fs.readFileSync(path.join(__dirname, '../ui/island.js'), 'utf8'));
    const button = w.document.getElementById('island-toggle');
    button.dispatchEvent(new w.MouseEvent('click', { bubbles: true, detail: 1 }));
    await Promise.resolve();
    assert.equal(calls.filter(([type]) => type === 'expanded').length, 0);
    header.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await Promise.resolve();
    assert.equal(calls.filter(([type]) => type === 'expanded').length, 1);
    pointer('pointerdown', 300, 20);
    pointer('pointermove', 302, 80);
    pointer('pointerup', 302, 80);
    await Promise.resolve();
    const gestures = calls.filter(([type]) => type === 'interaction').map(([, value]) => value);
    assert.equal(gestures.length, 2);
    assert.equal(gestures[0].type, 'drag-start');
    assert.equal(gestures[1].type, 'drag-end');
    assert.equal(gestures[1].dy, 60);
    assert.equal(calls.filter(([type]) => type === 'move').length, 0);
    button.click();
    await Promise.resolve();
    assert.equal(calls.filter(([type]) => type === 'expanded').length, 2);
  } finally { await new Promise(resolve => setImmediate(resolve)); w.close(); }
});
