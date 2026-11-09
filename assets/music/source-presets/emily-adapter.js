/* MineRadio Emily runs its visual clock locally. Audio/state IPC is bounded
 * independently, so renderer cadence does not depend on a parent mouse event. */
(() => {
  'use strict';
  const token = new URLSearchParams(location.search).get('token');
  let current = null, receivedAt = 0, previous = 0, pending = null;
  let frameCount = 0, disposed = false, presented = false, projectedPosition = 0;
  function post(value) {parent.postMessage({...value, token}, '*');}
  function stop() {
    if (pending !== null) cancelAnimationFrame(pending);
    pending = null;
  }
  function render(stamp, force = false) {
    if (!current || disposed || document.hidden) return;
    const fps = current.reducedMotion ? 20 : Math.max(15, Math.min(60, current.settings?.fps || 60));
    if (!force && stamp - previous < 1000 / fps - .5) return;
    const dt = Math.max(.001, Math.min(.1, (stamp - previous) / 1000 || 1 / 60));
    previous = stamp;
    const elapsed = current.playing ? Math.min(.5, Math.max(0, (stamp - receivedAt) / 1000)) : 0;
    let position = Math.max(0, (Number(current.position) || 0) + elapsed);
    if (current.playing && !current.seeking) position = Math.max(projectedPosition, position);
    if (current.duration > 0) position = Math.min(position, current.duration);
    projectedPosition = position;
    const input = {...current, position, time: (Number(current.time) || 0) + elapsed * 1000};
    const preset = input.settings?.preset === 'topography' ? 7 : 0;
    const projected = PulseSourceSpace.prepare(input, dt, preset);
    PulseEmilyFrame.update(projected, dt);
    window.PulseSonicHost?.update(input, dt);
    PulseSourceCover.step(dt);
    PulseSourceCover.set(projected.coverURL || '', projected);
    PulseSourceSpace.updateLyrics(projected, dt);
    PulseSourceSpace.render();
    frameCount++;
    if (!presented) {
      presented = true;
      post({type: 'pulse-preset-presented', nativeLyrics: PulseSourceLyrics.getState().attached});
    }
    if (frameCount % 60 === 1) post({type: 'pulse-preset-metrics', frames: frameCount,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      calls: renderer.info.render.calls, points: renderer.info.render.points, grid: GRID_X,
      space: PulseSourceSpace.getState()});
  }
  function tick(stamp) {
    pending = null;
    if (disposed || document.hidden || !current?.playing) return;
    render(stamp);
    pending = requestAnimationFrame(tick);
  }
  function sync() {
    if (disposed || document.hidden) {stop(); return;}
    render(performance.now(), true);
    if (current?.playing && pending === null) pending = requestAnimationFrame(tick);
    else if (!current?.playing) stop();
  }
  function receive(event) {
    const input = event.data;
    if (disposed || event.source !== parent || input?.token !== token) return;
    if (input.type === 'pulse-preset-ripple') {
      if (current?.settings?.preset !== 'topography' || current.settings.visualEnabled === false) return;
      if (![input.x, input.y, input.strength].every(Number.isFinite)) return;
      const x = Math.max(-1, Math.min(1, input.x)) * 17;
      const z = -Math.max(-1, Math.min(1, input.y)) * 17;
      MineradioSonicTopography.pointerRipple(x, z, Math.max(.25, Math.min(3, input.strength)));
      window.PulseEmilyRedraw();
      return;
    }
    if (input.type === 'pulse-preset-dispose') {
      disposed = true;
      stop();
      removeEventListener('message', receive);
      document.removeEventListener('visibilitychange', sync);
      delete window.PulseEmilyRedraw;
      window.PulseSonicHost?.dispose();
      PulseSourceSpace.dispose();
      PulseSourceCover.dispose();
      PulseEmilyFrame.dispose();
      return;
    }
    if (input.type !== 'pulse-preset-frame') return;
    const previousPosition = Number(current?.position) || 0;
    const nextPosition = Number(input.position) || 0;
    if (input.seeking || !input.playing || Math.abs(nextPosition - previousPosition) > 1.25) {
      projectedPosition = nextPosition;
    }
    current = {...current, ...input, settings: input.settings || current?.settings || {}};
    receivedAt = performance.now();
    // Running RAF consumes the newest frame without an additional synchronous
    // draw, preventing the old 30Hz message + 60Hz pointer double rendering.
    if (pending === null || !current.playing || input.seeking) sync();
  }
  window.PulseEmilyRedraw = () => {
    if (disposed || document.hidden || !current || pending !== null) return;
    pending = requestAnimationFrame(stamp => {
      pending = null;
      if (current.playing) tick(stamp);
      else render(stamp, true);
    });
  };
  addEventListener('message', receive);
  document.addEventListener('visibilitychange', sync);
  post({type: 'pulse-preset-ready'});
})();
