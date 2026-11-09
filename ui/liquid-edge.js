'use strict';
(() => {
  const island = document.getElementById('island');
  if (!island) return;
  const canvas = document.createElement('canvas'), edge = document.createElement('div');
  canvas.className = 'refraction-canvas'; canvas.hidden = true; canvas.setAttribute('aria-hidden', 'true');
  edge.className = 'liquid-edge'; edge.setAttribute('aria-hidden', 'true');
  island.prepend(canvas); island.append(edge);
  const context = canvas.getContext('2d', { alpha: true });
  let mode = 'light', raf = 0, point = null, disposed = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function reset() { canvas.hidden = true; context?.clearRect(0, 0, canvas.width, canvas.height); }
  function paintLight() {
    raf = 0;
    if (!point || disposed || document.hidden) return;
    const rect = island.getBoundingClientRect();
    edge.style.setProperty('--liquid-x', `${Math.max(0, Math.min(100, (point.x - rect.left) / rect.width * 100))}%`);
    edge.style.setProperty('--liquid-y', `${Math.max(0, Math.min(100, (point.y - rect.top) / rect.height * 100))}%`);
  }
  function move(event) {
    if (mode === 'off' || reduced.matches || document.hidden) return;
    point = { x: event.clientX, y: event.clientY };
    if (!raf) raf = requestAnimationFrame(paintLight);
  }
  function leave() {
    point = null; if (raf) cancelAnimationFrame(raf); raf = 0;
    edge.style.removeProperty('--liquid-x'); edge.style.removeProperty('--liquid-y');
  }
  function frame(value) {
    if (value?.appearance && !disposed && !document.hidden) {
      const appearance = value.appearance;
      if (['dark', 'light'].includes(appearance.ink)) {
        document.documentElement.dataset.glassInk = appearance.ink;
        island.style.setProperty('--ambient-tint', String(Math.max(.06, Math.min(.22, Number(appearance.tint) || .06))));
      }
    }
    if (disposed || mode !== 'refract' || document.hidden || !value?.active) { reset(); return; }
    const { width, height, pixels } = value;
    if (!context || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || width > 2048 || height < 1 || height > 1024 || !ArrayBuffer.isView(pixels) || pixels.byteLength !== width * height * 4) return;
    // A late compact frame must never stretch across a newly expanded window.
    if (Math.abs(width - innerWidth * devicePixelRatio) > 2 || Math.abs(height - innerHeight * devicePixelRatio) > 2) { reset(); return; }
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const rgba = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    context.putImageData(new ImageData(rgba, width, height), 0, 0); canvas.hidden = false;
  }
  function setMode(next) {
    mode = ['off', 'light', 'refract'].includes(next) ? next : 'light';
    document.documentElement.dataset.liquidEdge = mode;
    if (mode !== 'refract') reset();
    if (mode === 'off') leave();
  }
  const unsubscribe = window.pulse?.onRefractionFrame?.(frame) || (() => {});
  const visibility = () => { if (document.hidden) { leave(); reset(); } };
  const resize = () => { leave(); reset(); };
  island.addEventListener('pointermove', move, { passive: true }); island.addEventListener('pointerleave', leave);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', () => {
    disposed = true; leave(); reset(); unsubscribe();
    island.removeEventListener('pointermove', move); island.removeEventListener('pointerleave', leave);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('resize', resize);
  }, { once: true });
  window.PulseLiquidEdge = Object.freeze({ setMode }); setMode(mode);
})();
