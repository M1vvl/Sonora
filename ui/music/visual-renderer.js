/* Source visual host. One renderer, one shared analyser, bounded state IPC. */
(function(host, factory) {
  const analysis = typeof module === 'object' && module.exports ? require('./audio-analysis.js') : host.PulseMusicAudioAnalysis;
  const value = factory(analysis, host.document?.currentScript?.src);
  if (typeof module === 'object' && module.exports) module.exports = value;
  else host.PulseMusicVisualRenderer = value;
})(typeof window === 'object' ? window : globalThis, function(analysisModule, scriptURL) {
  'use strict';
  const PRESETS = Object.freeze([
    {id: 'cover', label: 'Emily 专辑封面', description: '封面粒子 · 立体浮雕'},
    {id: 'topography', label: '音域回响 · 原版', description: '原版地形 · 浮空方块 · 星尘'}
  ]);
  function create({canvas, audio, onNotice = () => {}, onLyricsState = () => {}} = {}) {
    if (!canvas?.ownerDocument) throw new TypeError('Visual engine needs a canvas');
    const document = canvas.ownerDocument, view = document.defaultView;
    const analysis = audio ? analysisModule.acquire(audio, {onNotice}) : null;
    const listeners = [], motion = view.matchMedia?.('(prefers-reduced-motion:reduce)');
    const on = (target, name, callback) => {
      target?.addEventListener(name, callback);
      listeners.push(() => target?.removeEventListener(name, callback));
    };
    let active = false, disposed = false, pending = null, previous = 0, source = null;
    let serial = 0, ready = false, presented = false, readyTimer = null, failed = false;
    let native = false, nativeAvailable = false, lyricFailed = false, draws = 0, metrics = {};
    let settings = {preset: 'cover', fps: 60, coverResolution: 384};
    let pointer = null;
    let settingsRevision = 0, sentSettings = -1, lyricRevision = 0, sentLyrics = -1;
    let metadata = {lines: [], songId: null, title: ''}, position = 0, coverURL = '';
    const orbit = {yaw: 0, pitch: 0, rotating: false};
    let shelf = {open: false, detail: false};
    const empty = {bins: new Uint8Array(1024), bass: 0, mid: 0, treble: 0, energy: 0, rms: 0};
    function nativeLyrics(value) {
      value = !!value;
      if (value === native) return;
      native = value;
      onLyricsState(value);
    }
    function post(value) {source?.contentWindow?.postMessage({...value, token: String(serial)}, '*');}
    function stop() {
      if (pending !== null) view.cancelAnimationFrame(pending);
      pending = null;
    }
    function releaseSource() {
      if (readyTimer !== null) view.clearTimeout(readyTimer);
      readyTimer = null;
      if (source) {post({type: 'pulse-preset-dispose'}); source.remove();}
      source = null;
      ready = presented = nativeAvailable = false;
      sentLyrics = sentSettings = -1;
      metrics = {};
      nativeLyrics(false);
      canvas.hidden = false;
    }
    function sourceFailure() {
      if (failed || disposed) return;
      failed = true;
      releaseSource();
      onNotice('视觉场景暂时无法载入，可重新打开歌词页重试。');
    }
    function ensureSource() {
      if (source || failed) return;
      serial++;
      source = document.createElement('iframe');
      source.className = 'music-source-preset';
      source.setAttribute('sandbox', 'allow-scripts');
      source.setAttribute('title', '音乐视觉场景');
      source.setAttribute('aria-hidden', 'true');
      source.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;z-index:-2;background:transparent;opacity:0;user-select:none';
      source.src = 'pulse-visual-media://builtin/standard.html?token=' + serial;
      source.addEventListener('error', sourceFailure);
      canvas.after(source);
      canvas.hidden = true;
      readyTimer = view.setTimeout(sourceFailure, 12000);
    }
    function draw(stamp = view.performance.now()) {
      if (!active || disposed || document.hidden) return;
      ensureSource();
      if (!ready || !source) return;
      const signal = analysis?.sample(stamp) || empty;
      if (sentLyrics !== lyricRevision) {
        post({type: 'pulse-preset-lyrics', ...metadata});
        sentLyrics = lyricRevision;
      }
      const changedSettings = sentSettings !== settingsRevision;
      post({type: 'pulse-preset-frame',
        ...(changedSettings ? {settings: lyricFailed ? {...settings, lyric3D: false} : settings} : {}),
        position: audio?.getAttribute('src') ? Number(audio.currentTime) || 0 : position,
        duration: Number.isFinite(audio?.duration) ? audio.duration : 0,
        playing: !!audio && !audio.paused, seeking: audio?.seeking === true,
        // MineRadio's source-space projection owns peak/onset detection. Do
        // not inject a second bass-difference beat above the original shader.
        audio: signal, time: stamp,
        width: Math.min(1920, view.innerWidth), height: Math.min(1080, view.innerHeight),
        coverURL, ...orbit, pointer, shelf, reducedMotion: motion?.matches === true});
      sentSettings = settingsRevision;
      draws++;
    }
    function animate(stamp) {
      pending = null;
      if (!active || disposed || document.hidden || audio?.paused) return;
      if (stamp - previous >= 1000 / 30 - .5) {previous = stamp; draw(stamp);}
      pending = view.requestAnimationFrame(animate);
    }
    function resume() {
      stop();
      if (!active || disposed || document.hidden) return;
      if (audio && !audio.paused) {analysis?.ensure(); analysis?.resume();}
      draw();
      if (audio && !audio.paused) pending = view.requestAnimationFrame(animate);
    }
    function resize() {
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(box.width));
      canvas.height = Math.max(1, Math.round(box.height));
      if (active) draw();
    }
    on(view, 'message', event => {
      if (!source || event.source !== source.contentWindow || event.data?.token !== String(serial)) return;
      const data = event.data;
      if (typeof data.nativeLyrics === 'boolean') nativeAvailable = data.nativeLyrics;
      if (data.type === 'pulse-preset-ready') {ready = true; if (active) draw();}
      if (data.type === 'pulse-preset-presented') {
        presented = true;
        if (readyTimer !== null) view.clearTimeout(readyTimer);
        readyTimer = null;
        source.style.opacity = '1';
      }
      if (data.type === 'pulse-preset-metrics') metrics = {...metrics, ...data};
      if (data.type === 'pulse-preset-error') {sourceFailure(); return;}
      if (data.type === 'pulse-preset-lyrics-error') {
        if (!lyricFailed) onNotice('三维歌词暂不可用，已切换为普通歌词。');
        lyricFailed = true;
        settingsRevision++;
      }
      nativeLyrics(presented && nativeAvailable && settings.lyric3D !== false && !lyricFailed);
    });
    on(audio, 'playing', resume);
    for (const name of ['pause', 'ended']) on(audio, name, () => {stop(); if (active) draw();});
    on(audio, 'seeked', () => {if (active) draw();});
    on(document, 'visibilitychange', () => {
      if (document.hidden) {stop(); releaseSource(); canvas.width = canvas.height = 1;}
      else resume();
    });
    on(view, 'resize', resize);
    on(motion, 'change', resume);
    return {
      activate() {if (disposed) return; active = true; failed = false; resize(); resume();},
      deactivate() {active = false; stop(); releaseSource(); canvas.width = canvas.height = 1;},
      trim() {if (active || disposed) return false; releaseSource(); return true;},
      update(value) {
        const requested = value?.preset ?? settings.preset;
        const preset = PRESETS.some(item => item.id === requested) ? requested : 'cover';
        settings = {...settings, ...value, preset};
        settingsRevision++;
        resume();
      },
      setLyrics(lines, song = {}) {
        metadata = {lines: Array.isArray(lines) ? lines.slice(0, 1200) : [], songId: song?.id || null, title: song?.title || ''};
        lyricRevision++;
        if (lyricFailed) settingsRevision++;
        lyricFailed = false;
        if (active) draw();
      },
      setLyricPosition(value) {position = Math.max(0, Number(value) || 0); if (active && audio?.paused) draw();},
      setShelf(value) {shelf = {open: value?.open === true, detail: value?.detail === true}; if (active) draw();},
      ripple(x, y, strength) {
        if (!active || settings.preset !== 'topography') return;
        post({type: 'pulse-preset-ripple', x, y, strength});
      },
      setOrbit(yaw, pitch, rotating = false) {
        orbit.yaw = Number.isFinite(yaw) ? yaw : 0;
        orbit.pitch = Math.max(-Math.PI * .45, Math.min(Math.PI * .45, Number(pitch) || 0));
        orbit.rotating = rotating;
        if (active && audio?.paused) draw();
      },
      resetOrbit() {orbit.yaw = orbit.pitch = 0; orbit.rotating = false; if (active) draw();},
      setPointer(x, y) {
        pointer = Number.isFinite(x) && Number.isFinite(y) ? {x, y: -y} : null;
        if (active && audio?.paused && pending === null) pending = view.requestAnimationFrame(stamp => {pending = null; draw(stamp);});
      },
      setCover(value) {coverURL = typeof value === 'string' ? value : ''; if (active) draw();},
      getPresetPreview(preset = 'cover') {
        const name = preset === 'topography' ? 'topography' : 'cover';
        return new URL('../../assets/music/presets/' + name + '.png', scriptURL || document.baseURI).href;
      },
      getState() {return {active, pendingFrame: pending !== null, sourceReady: ready, sourcePresented: presented,
        sourceKind: settings.preset, preset: settings.preset, backend: source ? 'mineradio-source-webgl' : 'unavailable',
        threeDimensional: !!source, nativeLyrics: native, sourceMetrics: {...metrics}, orbit: {...orbit},
        canvasWidth: canvas.width, canvasHeight: canvas.height, drawCalls: draws,
        analyser: !!analysis?.getState().available, bins: 1024};},
      dispose() {
        if (disposed) return;
        active = false;
        stop();
        releaseSource();
        disposed = true;
        listeners.splice(0).forEach(remove => remove());
        analysis?.release();
        canvas.width = canvas.height = 1;
      }
    };
  }
  return {create, PRESETS};
});
