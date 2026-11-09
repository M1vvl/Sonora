'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('audio visualizer only schedules real frames, stops in silence, and respects reduced motion', () => {
  let listener, now = 0, sequence = 0;
  const scheduled = new Map(), classes = new Set(), bars = Array.from({ length: 3 }, () => ({ style: {} }));
  const handle = { querySelectorAll: () => bars, getBoundingClientRect: () => ({ left: 13, top: 7 }), addEventListener: () => {}, classList: { contains: key => classes.has(key), remove: key => classes.delete(key), toggle: (key, value) => value ? classes.add(key) : classes.delete(key) } };
  const reduced = { matches: false, addEventListener: () => {} };
  const context = { document: { hidden: false, querySelector: () => handle, addEventListener: () => {} },
    window: { pulse: { onAudioFrame: cb => { listener = cb; return () => {}; } }, addEventListener: () => {}, removeEventListener: () => {} },
    performance: { now: () => now }, matchMedia: () => reduced,
    requestAnimationFrame: cb => { scheduled.set(++sequence, cb); return sequence; }, cancelAnimationFrame: id => scheduled.delete(id) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/audio-visualizer.js'), 'utf8'), context);
  assert.equal(scheduled.size, 0);
  const step = () => { now += 34; const tasks = [...scheduled.values()]; scheduled.clear(); tasks.forEach(cb => cb(now)); };
  listener({ enabled: true, active: true, levels: [1, .5, .1], audioSources: ['cloudmusic'] });
  for (let i = 0; i < 6; i++) step();
  const height = bar => Number.parseFloat(bar.style.height);
  assert.ok(height(bars[0]) > height(bars[1]) && height(bars[1]) > height(bars[2]));
  listener({ enabled: true, active: false, levels: [0, 0, 0] });
  for (let i = 0; i < 40; i++) step();
  assert.equal(scheduled.size, 0);
  assert.equal(height(bars[0]), 4);
  reduced.matches = true;
  listener({ enabled: true, active: true, levels: [1, 1, 1] });
  assert.equal(scheduled.size, 0);
  assert.ok(height(bars[0]) > 9, 'reduced motion keeps functional audio data visible without an animation loop');
  reduced.matches = false;
  listener({ enabled: true, active: true, levels: [1, 1, 1] });
  assert.equal(scheduled.size, 1);
  listener({ enabled: false }); assert.equal(scheduled.size, 0);
});

test('meter endpoint geometry stays on the physical pixel grid at fractional display scales', () => {
  for (const ratio of [1, 1.25, 1.5, 1.75, 2]) {
    let listener, now = 100;
    const events = new Map(), bars = Array.from({ length: 3 }, () => ({ style: {} }));
    const origin = { left: 13, top: 7 };
    const handle = { querySelectorAll: () => bars, getBoundingClientRect: () => origin, addEventListener() {},
      classList: { contains: () => false, remove() {}, toggle() {} } };
    const context = { document: { hidden: false, querySelector: () => handle, addEventListener() {} },
      window: { devicePixelRatio: ratio, pulse: { onAudioFrame: cb => { listener = cb; return () => {}; } }, addEventListener: (key, cb) => events.set(key, cb), removeEventListener: key => events.delete(key) },
      performance: { now: () => now }, matchMedia: () => ({ matches: true, addEventListener() {} }),
      requestAnimationFrame: () => { throw new Error('reduced motion must not animate'); }, cancelAnimationFrame() {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/audio-visualizer.js'), 'utf8'), context);
    const aligned = value => assert.ok(Math.abs(value - Math.round(value)) < 1e-8, `${value} must land on a device pixel at ${ratio}x`);
    for (const levels of [[.12, .37, .83], [1, .6, .2], [0, 0, 0]]) {
      now += 100;
      listener({ enabled: true, active: true, levels });
      for (const bar of bars) {
        const top = Number(bar.style.transform.match(/translateY\(([-\d.]+)px\)/)[1]);
        const height = Number.parseFloat(bar.style.height), left = Number.parseFloat(bar.style.left), width = Number.parseFloat(bar.style.width);
        aligned((origin.top + top) * ratio);
        aligned((origin.top + top + height) * ratio);
        aligned((origin.left + left) * ratio);
        aligned((origin.left + left + width) * ratio);
        assert.ok(height >= 4 - .5 / ratio && height <= 18 + .5 / ratio);
      }
    }
    assert.ok(events.has('resize'));
    events.get('pagehide')();
    assert.equal(events.has('resize'), false, 'display geometry listener is released with the renderer');
  }
});
