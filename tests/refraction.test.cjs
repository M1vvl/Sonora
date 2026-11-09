'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRefraction } = require('../src/refraction.cjs');
function fixture(options = {}) {
  let visible = true, destroyed = false, created = 0, released = 0, reads = 0, nextId = 0;
  const jobs = new Map(), frames = [], rects = [];
  const win = { isVisible: () => visible, isDestroyed: () => destroyed, setContentProtection() { throw Error('Capture must remain visible'); } };
  let geometry = { x: -50, y: 20, width: 80, height: 44, radius: 22, thickness: 6, padding: 10 };
  const controller = createRefraction({
    getWindow: () => win, getGeometry: () => geometry, onFrame: value => frames.push(value), supported: true,
    schedule: callback => { jobs.set(++nextId, callback); return nextId; }, cancel: id => jobs.delete(id),
    captureFactory: () => { created++; return {
      read(rect) { rects.push(rect); reads++; const bytes = new Uint8Array(rect.width * rect.height * 4); for (let p = 0; p < bytes.length; p += 4) { bytes[p] = reads * 20; bytes[p+1] = p % 255; bytes[p+2] = 120; } return bytes; },
      dispose() { released++; }
    }; }, ...options
  });
  return { controller, frames, rects, get created() { return created; }, get released() { return released; }, get jobs() { return jobs.size; },
    tick() { const [id, callback] = jobs.entries().next().value || []; assert.ok(callback, 'scheduled callback'); jobs.delete(id); callback(); },
    hide() { visible = false; }, destroy() { destroyed = true; }, move(value) { geometry = { ...geometry, ...value }; }
  };
}
test('refraction has no capture resources until visible and enabled; unsupported platforms stay idle', () => {
  const f = fixture(); f.controller.configure({ enabled: false }); assert.equal(f.created, 0); assert.equal(f.jobs, 0);
  f.hide(); f.controller.configure({ enabled: true }); assert.equal(f.jobs, 0);
  const unsupported = fixture({ supported: false }); unsupported.controller.configure({ enabled: true }); assert.equal(unsupported.jobs, 0);
});
test('real frames update from source pixels, stay screenshot-visible, and moving uses current physical coordinates', () => {
  const f = fixture(); f.controller.configure({ enabled: true }); f.controller.configure({ enabled: true }); assert.equal(f.jobs, 1);
  f.tick(); f.move({ x: -20 }); f.tick();
  const frames = f.frames.filter(frame => frame.active); assert.equal(frames.length, 2);
  const pixel = frames[0].pixels.findIndex((value, index) => index % 4 === 3 && value > 0) - 3;
  assert.ok(pixel >= 0); assert.notEqual(frames[0].pixels[pixel+2], frames[1].pixels[pixel+2]);
  assert.deepEqual(f.rects.map(rect => rect.x), [-60, -30]); assert.equal(f.created, 1);
  assert.equal(f.controller.getStatus().captureExcluded, false); assert.equal(f.controller.getStatus().source, 'outside-contour');
  f.controller.stop(); assert.equal(f.released, 1); assert.equal(f.jobs, 0); assert.equal(f.frames.at(-1).active, false);
});
test('hiding, resizing and disabling release resources and never leave a capture loop running', () => {
  const f = fixture(); f.controller.configure({ enabled: true }); f.tick();
  f.move({ width: 96, height: 64, radius: 26 }); f.tick(); assert.equal(f.frames.at(-1).width, 96);
  f.hide(); f.tick(); assert.equal(f.released, 1); assert.equal(f.jobs, 0); assert.equal(f.controller.getStatus().enabled, false);
  f.controller.stop(); assert.equal(f.released, 1);
});
test('native capture failure degrades once without retries or affecting other modules', () => {
  let released = 0;
  const f = fixture({ captureFactory: () => ({ read() { throw Error('device unavailable'); }, dispose() { released++; } }) });
  f.controller.configure({ enabled: true }); f.tick();
  assert.equal(f.jobs, 0); assert.equal(released, 1); assert.equal(f.frames.at(-1).active, false);
  assert.equal(f.controller.getStatus().reason, 'device unavailable'); assert.equal(f.controller.getStatus().enabled, false);
});
