'use strict';
// Frame-only presentation module: no audio capture, log reads, or usage renders.
(() => {
  const handle = document.querySelector('.drag-handle');
  if (!handle || !window.pulse?.onAudioFrame) return;
  const bars = [...handle.querySelectorAll('span')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const values = [0, 0, 0], targets = [0, 0, 0];
  let animation = 0, lastPaint = 0, lastFrame = 0, active = false, enabled = false;
  let origin = { left: 0, top: 0 }, pixelRatio = 1;
  function measure() {
    const rect = handle.getBoundingClientRect();
    origin = { left: rect.left, top: rect.top };
    pixelRatio = Math.max(1, Math.min(4, Number(window.devicePixelRatio) || 1));
    const snap = value => Math.round(value * pixelRatio) / pixelRatio;
    bars.forEach((bar, i) => {
      bar.style.left = `${snap(origin.left + i * 5) - origin.left}px`;
      bar.style.width = `${snap(2)}px`;
      draw(bar, values[i]);
    });
  }
  function draw(bar, value) {
    const height = Math.round((4 + value * 14) * pixelRatio) / pixelRatio;
    const top = Math.round((origin.top + 15 - height / 2) * pixelRatio) / pixelRatio - origin.top;
    // Only this bounded, absolutely positioned meter is resized; its corner
    // radius is never scaled. Endpoints stay on the actual device pixel grid.
    bar.style.height = `${height}px`;
    bar.style.transform = `translateY(${top}px)`;
  }
  function paint(now) {
    animation = 0;
    if (document.hidden || reduced.matches || handle.classList.contains('dragging')) { reset(); return; }
    const dt = Math.min(100, Math.max(1, now - lastPaint));
    if (dt < 32) { animation = requestAnimationFrame(paint); return; }
    lastPaint = now;
    const stale = now - lastFrame > 500;
    let moving = false;
    bars.forEach((bar, i) => {
      const target = !stale && active && enabled ? targets[i] : 0;
      values[i] += (target - values[i]) * (1 - Math.exp(-dt / (target > values[i] ? 35 : 130)));
      if (values[i] < .002) values[i] = 0;
      draw(bar, values[i]);
      if (values[i] > 0 || target > 0) moving = true;
    });
    if (moving) animation = requestAnimationFrame(paint);
  }
  function reset() {
    cancelAnimationFrame(animation); animation = 0;
    handle.classList.remove('music-active');
    values.fill(0); bars.forEach(bar => draw(bar, 0));
  }
  function receive(frame) {
    enabled = frame?.enabled === true; active = frame?.active === true;
    if (!enabled) { reset(); return; }
    if (Array.isArray(frame.levels)) frame.levels.slice(0, 3).forEach((n, i) => { const energy = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; targets[i] = energy * energy; });
    lastFrame = performance.now();
    handle.classList.toggle('music-active', active);
    const sources = Array.isArray(frame.audioSources) ? frame.audioSources.join('、') : '';
    handle.title = active ? `音频律动${sources ? ` · ${sources}` : ''} · 拖动灵动岛` : '拖动灵动岛 · 自动等待播放音频';
    // Reduced motion still conveys functional meter data, without interpolation
    // or an animation loop. This is capped at ten discrete updates per second.
    if (reduced.matches) {
      cancelAnimationFrame(animation); animation = 0;
      if (!active) { reset(); return; }
      if (!document.hidden && !handle.classList.contains('dragging') && lastFrame - lastPaint >= 100) {
        lastPaint = lastFrame;
        bars.forEach((bar, i) => { values[i] = targets[i]; draw(bar, values[i]); });
      }
      return;
    }
    if (!animation && !document.hidden && !reduced.matches && !handle.classList.contains('dragging') && (active || values.some(n=>n>0))) animation = requestAnimationFrame(paint);
  }
  const unsubscribe = window.pulse.onAudioFrame(receive);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  reduced.addEventListener('change', reset);
  handle.addEventListener('pointerdown', reset);
  window.addEventListener('resize', measure);
  window.addEventListener('pagehide', () => { reset(); unsubscribe(); window.removeEventListener('resize', measure); }, { once: true });
  measure();
  reset();
})();
