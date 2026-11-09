'use strict';
// Bounded desktop sampling. The map only reads OUTSIDE the island contour.
// No capture exclusion, files, screen-sized textures or codecs are needed.
const { buildEdgeMap, refractEdges } = require('./refraction-map.cjs');
const { analyzeSurroundings } = require('./glass-appearance.cjs');
function createGDICapture() {
  const koffi = require('koffi');
  const user = koffi.load('user32.dll'), gdi = koffi.load('gdi32.dll'), kernel = koffi.load('kernel32.dll');
  const api = {
    getDC: user.func('void * __stdcall GetDC(void *window)'),
    releaseDC: user.func('int __stdcall ReleaseDC(void *window, void *dc)'),
    createDC: gdi.func('void * __stdcall CreateCompatibleDC(void *dc)'),
    createDIB: gdi.func('void * __stdcall CreateDIBSection(void *dc, void *info, uint32_t usage, _Out_ void **bits, void *section, uint32_t offset)'),
    select: gdi.func('void * __stdcall SelectObject(void *dc, void *object)'),
    blit: gdi.func('int __stdcall BitBlt(void *dest, int x, int y, int width, int height, void *source, int sx, int sy, uint32_t operation)'),
    flush: gdi.func('int __stdcall GdiFlush()'),
    deleteDC: gdi.func('int __stdcall DeleteDC(void *dc)'),
    deleteObject: gdi.func('int __stdcall DeleteObject(void *object)'),
    copy: kernel.func('void __stdcall RtlMoveMemory(_Out_ void *destination, void *source, size_t length)')
  };
  let bitmap, memoryDC, previous, pointer, pixels, width = 0, height = 0;
  function dispose() {
    pixels = pointer = null;
    if (memoryDC && previous) api.select(memoryDC, previous);
    if (bitmap) api.deleteObject(bitmap);
    if (memoryDC) api.deleteDC(memoryDC);
    bitmap = memoryDC = previous = null; width = height = 0;
  }
  function ensure(w, h) {
    if (width === w && height === h && pixels) return;
    dispose();
    const info = Buffer.alloc(40); info.writeUInt32LE(40, 0);
    info.writeInt32LE(w, 4); info.writeInt32LE(-h, 8);
    info.writeUInt16LE(1, 12); info.writeUInt16LE(32, 14);
    const bits = [null];
    try {
      memoryDC = api.createDC(null);
      if (!memoryDC) throw Error('Memory DC unavailable');
      bitmap = api.createDIB(null, info, 0, bits, null, 0);
      if (!bitmap || !bits[0]) throw Error('DIB allocation failed');
      previous = api.select(memoryDC, bitmap);
      if (!previous) throw Error('DIB selection failed');
      // Electron's V8 cage forbids wrapping off-heap DIB memory in an external
      // ArrayBuffer. Keep an opaque pointer and copy into a V8-owned Buffer.
      pointer = bits[0]; pixels = Buffer.alloc(w * h * 4);
      width = w; height = h;
    } catch (error) { dispose(); throw error; }
  }
  return {
    read(rect) {
      const { x, y, width: w, height: h } = rect;
      if (![x,y,w,h].every(Number.isInteger) || w < 1 || h < 1 || w > 2176 || h > 1152) throw Error('Capture bounds invalid');
      ensure(w, h);
      const screenDC = api.getDC(null);
      if (!screenDC) throw Error('Desktop DC unavailable');
      try {
        if (!api.blit(memoryDC, 0, 0, w, h, screenDC, x, y, 0x40cc0020)) throw Error('Desktop region unavailable');
        if (!api.flush()) throw Error('Desktop copy did not complete');
        api.copy(pixels, pointer, pixels.length);
        return pixels;
      } finally { api.releaseDC(null, screenDC); }
    },
    testMemory() {
      ensure(8, 8);
      const expected = Buffer.from(Array.from({length: 256}, (_, index) => (index * 17) & 255));
      api.copy(pointer, expected, expected.length); api.copy(pixels, pointer, pixels.length);
      return pixels.length === expected.length && pixels.every((value, index) => value === expected[index]);
    },
    dispose
  };
}

function createRefraction({ getWindow, getGeometry, onFrame, captureFactory = createGDICapture, supported = process.platform === 'win32', schedule = setTimeout, cancel = clearTimeout }) {
  let enabled = false, rim = true, stopped = false, timer = null, window, capture, map, key = '', failed = null, appearance = {};
  let frames = 0, totalMs = 0;
  function clearFrame() { onFrame({ active: false, reason: failed || 'disabled' }); }
  function release() {
    if (timer != null) cancel(timer); timer = null;
    try { capture?.dispose(); } finally {
      capture = null; map = null; key = '';
      window = null; clearFrame();
    }
  }
  function tick() {
    timer = null;
    if (!enabled || stopped) return;
    const current = getWindow();
    if (!current || current.isDestroyed() || !current.isVisible()) { enabled = false; release(); return; }
    try {
      const geometry = getGeometry(current);
      const { x, y, ...shape } = geometry;
      const nextKey = JSON.stringify(shape);
      if (key !== nextKey) { map = buildEdgeMap(geometry); key = nextKey; }
      const started = performance.now();
      capture ||= captureFactory();
      const { width, height, padding } = map.geometry;
      const pixels = capture.read({ x: geometry.x - padding, y: geometry.y - padding, width: width + padding * 2, height: height + padding * 2 });
      appearance = analyzeSurroundings(pixels, map.geometry, appearance) || appearance;
      const rgba = rim ? refractEdges(pixels, map) : null;
      totalMs += performance.now() - started; frames++;
      onFrame({ active: rim, width, height, pixels: rgba, appearance });
      // A discrete 4 Hz rim; the center remains native per-pixel transparency.
      timer = schedule(tick, 250);
    } catch (error) { failed = String(error.message || error).slice(0, 120); enabled = false; release(); }
  }
  return {
    configure({ enabled: requested, rim: requestedRim = true }) {
      if (stopped) return;
      rim = requestedRim !== false;
      const current = getWindow();
      const next = Boolean(requested && supported && current && !current.isDestroyed() && current.isVisible());
      if (next === enabled && (!next || current === window)) return;
      release(); enabled = next; failed = null;
      if (!enabled) return;
      window = current;
      timer = schedule(tick, 250);
    },
    getStatus: () => ({ enabled, available: supported, captureExcluded: false, source: 'outside-contour', reason: failed, frames, averageFrameMs: frames ? Math.round(totalMs / frames * 100) / 100 : 0 }),
    stop() { enabled = false; stopped = true; release(); }
  };
}
module.exports = { createRefraction, createGDICapture };
