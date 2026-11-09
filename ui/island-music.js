(function (host, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else host.PulseIslandMusic = value;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const icons = {
    previous: '<path d="M7 5v14M19 5 9 12l10 7Z"/>',
    next: '<path d="M17 5v14M5 5l10 7-10 7Z"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>',
    pause: '<path d="M9 5v14M15 5v14"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
  const clock = seconds => {
    const value = Math.max(0, Math.floor(seconds || 0));
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
  };
  function lineAt(lines, position) {
    let start = 0, end = lines.length - 1, index = -1;
    while (start <= end) {
      const middle = (start + end) >> 1;
      if (lines[middle].time <= position) { index = middle; start = middle + 1; }
      else end = middle - 1;
    }
    return index;
  }
  const clamp01 = value => Math.max(0, Math.min(1, value));
  function isDisplayLyric(line) {
    return line && Number.isFinite(line.time) && typeof line.text === 'string' && line.text.trim() &&
      !/^\s*\{/.test(line.text) && !/^(?:纯音乐[，,、\s]*(?:请欣赏)?|instrumental|no lyrics)$/i.test(line.text.trim());
  }
  function progressAt(line, next, position, duration) {
    if (!line) return 0;
    if (line.words?.length) {
      let word = null;
      for (const candidate of line.words) { if (candidate.time > position) break; word = candidate; }
      if (!word) return 0;
      const fraction = clamp01((position - word.time) / Math.max(.02, word.duration));
      return clamp01((word.c0 + (word.c1 - word.c0) * fraction) / Math.max(1, line.text.length));
    }
    const end = Number.isFinite(next?.time) ? next.time : duration > line.time ? duration : line.time + 4.8;
    return clamp01((position - line.time) / Math.max(.08, end - line.time));
  }
  function create({ island } = {}) {
    const document = island.ownerDocument, view = document.defaultView;
    const header = island.querySelector('.island-header');
    const monitor = island.querySelector('#island-toggle');
    const monitorDetails = island.querySelector('#island-details');
    const host = document.createElement('div');
    host.className = 'island-music';
    host.innerHTML = '<div class="island-music-header"><span class="island-music-art"><img alt="" hidden></span><div class="island-music-line" aria-live="off"><span></span></div><div class="island-music-controls" data-island-interactive><button type="button" data-music-command="previous" aria-label="上一首">' + icon('previous') + '</button><button type="button" data-music-command="toggle" aria-label="播放">' + icon('play') + '</button><button type="button" data-music-command="next" aria-label="下一首">' + icon('next') + '</button></div></div><section class="island-music-details" hidden><header><strong></strong><small></small></header><div class="island-music-lyrics"></div><div class="island-music-clock"><time></time><time></time></div></section><input class="island-music-seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="音乐播放进度" data-island-interactive><p class="island-music-notice" role="status" hidden></p>';
    island.append(host);
    const $ = selector => host.querySelector(selector);
    const image = $('img'), artwork = $('.island-music-art'), seek = $('input'), compactLine = $('.island-music-line'), lyricRows = $('.island-music-lyrics');
    const listeners = [], motion = view.matchMedia?.('(prefers-reduced-motion:reduce)');
    let page = 'music', expanded = false, media = {}, lines = [], basePosition = 0, receivedAt = 0;
    let frame = null, lastFrame = 0, disposed = false, scrubbing = false, seekTarget = null, commandPending = false;
    let compactText = '', rowSignature = '', trackKey = '', noticeTimer = null;
    const animations = new Set();
    const lyricTimers = new Set();
    const on = (target, name, callback) => { target.addEventListener(name, callback); listeners.push(() => target.removeEventListener(name, callback)); };
    const now = () => view.performance.now();

    function position() {
      const elapsed = media.playing && media.timelineKnown !== false ? Math.min(1.5, Math.max(0, (now() - receivedAt) / 1000)) : 0;
      return Math.max(0, Math.min(media.duration || 86400, basePosition + elapsed));
    }
    function animate(node, frames, duration = 200) {
      if (page !== 'music' || motion?.matches || typeof node.animate !== 'function') return;
      const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.2,.75,.2,1)' });
      animations.add(animation);
      animation.finished.catch(() => {}).finally(() => animations.delete(animation));
    }
    function lyric(text) {
      if (text === compactText) return;
      compactText = text;
      const old = compactLine.firstElementChild;
      const next = document.createElement('span');
      next.textContent = text;
      compactLine.replaceChildren(next);
      if (old?.textContent) {
        old.className = 'is-leaving';
        compactLine.append(old);
        animate(old, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-5px)' }]);
        const timer = view.setTimeout(() => { old.remove(); lyricTimers.delete(timer); }, 220);
        lyricTimers.add(timer);
      }
      animate(next, [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }]);
    }
    function renderLyrics(index) {
      const first = Math.max(0, index - 2), last = Math.min(lines.length, Math.max(0, index) + 3);
      const key = lines.slice(first, last).map(line => line.time + '\n' + line.text).join('\n') + '|' + index;
      if (key === rowSignature) return;
      rowSignature = key;
      const fragment = document.createDocumentFragment();
      for (let n = first; n < last; n++) {
        const row = document.createElement('p');
        row.textContent = lines[n].text;
        row.className = n === index ? 'is-current' : '';
        if (n === index) row.setAttribute('aria-current', 'true');
        fragment.append(row);
      }
      lyricRows.replaceChildren(fragment);
      animate(lyricRows, [{ opacity: .65, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], 240);
    }
    function renderProgress() {
      const current = scrubbing ? Number(seek.value) : position();
      const duration = media.duration || 0;
      seek.max = String(duration || 1);
      if (!scrubbing) seek.value = String(current);
      seek.setAttribute('aria-valuetext', clock(current) + ' / ' + clock(duration));
      seek.style.setProperty('--island-progress', (duration ? Math.min(100, current / duration * 100) : 0) + '%');
      const times = host.querySelectorAll('time');
      times[0].textContent = clock(current); times[1].textContent = clock(duration);
      const index = media.timelineKnown === false ? -1 : lineAt(lines, current);
      const activeLine = lines[index];
      lyric(activeLine?.text || media.title || '');
      compactLine.classList.toggle('is-title', !activeLine);
      if (expanded && page === 'music') {
        if (media.timelineKnown === false) { lyricRows.replaceChildren(); rowSignature = ''; }
        else renderLyrics(index);
      }
      const reveal = (progressAt(lines[index], lines[index + 1], current, duration) * 100).toFixed(3) + '%';
      compactLine.firstElementChild?.style.setProperty('--lyric-reveal', reveal);
      lyricRows.querySelector('.is-current')?.style.setProperty('--lyric-reveal', reveal);
    }
    function stop() { if (frame !== null) view.cancelAnimationFrame(frame); frame = null; }
    function syncArtwork() {
      artwork.dataset.mediaActive = String(media.available === true && !image.hidden);
      artwork.dataset.mediaPlaying = String(media.playing === true);
      artwork.dataset.mediaVisible = String(page === 'music' && !document.hidden);
      artwork.dataset.mediaMotion = ['rotate', 'system', 'still'].includes(media.rotationMode) ? media.rotationMode : 'rotate';
    }
    function tick(time) {
      frame = null;
      if (disposed || page !== 'music' || document.hidden || !media.playing || media.timelineKnown === false) return;
      if (time - lastFrame >= 100) { lastFrame = time; renderProgress(); }
      frame = view.requestAnimationFrame(tick);
    }
    function sync() {
      stop(); renderProgress(); syncArtwork();
      if (page === 'music' && !document.hidden && media.playing && media.timelineKnown !== false) frame = view.requestAnimationFrame(tick);
    }
    function renderControls() {
      for (const button of host.querySelectorAll('[data-music-command]')) {
        const action = button.dataset.musicCommand;
        const key = { toggle: 'canToggle', previous: 'canPrevious', next: 'canNext' }[action];
        button.disabled = commandPending || !media.available || !media.canControl || media[key] === false;
      }
      const toggle = $('[data-music-command="toggle"]');
      toggle.innerHTML = icon(media.playing ? 'pause' : 'play');
      toggle.setAttribute('aria-label', media.playing ? '暂停' : '播放');
      seek.disabled = commandPending || !media.available || !media.canControl || media.canSeek === false || !(media.duration > 0);
    }
    function notice(text) {
      if (noticeTimer !== null) view.clearTimeout(noticeTimer);
      const node = $('.island-music-notice'); node.textContent = text; node.hidden = !text;
      noticeTimer = view.setTimeout(() => { node.hidden = true; noticeTimer = null; }, 3000);
    }
    function clearPalette() {
      host.style.removeProperty('--island-song-light');
      host.style.removeProperty('--island-song-dark');
    }
    function coverPalette() {
      const palette = view.PulseCoverPalette?.read(image);
      if (!palette) return;
      host.style.setProperty('--island-song-light', palette.light);
      host.style.setProperty('--island-song-dark', palette.dark);
    }
    async function command(action, value) {
      if (commandPending || !media.available || !media.canControl) return;
      commandPending = true; renderControls();
      try {
        const result = await view.pulse?.islandMusicCommand?.(action, value);
        if (disposed) return;
        if (result?.ok !== true) notice(result?.error || '播放器暂未响应');
      } catch { if (!disposed) notice('播放器暂未响应'); }
      finally { commandPending = false; if (!disposed) renderControls(); }
    }
    function receive(value) {
      if (disposed || !value || typeof value !== 'object') return;
      const nextKey = String(value.trackKey || '');
      if (nextKey !== trackKey) {
        finishSeek({ cancel: true });
        trackKey = nextKey; media = {}; lines = []; rowSignature = ''; basePosition = 0; receivedAt = now();
      }
      const previousPosition = position();
      const wasPlaying = media.playing;
      media = { ...media, ...value };
      media.duration = Number.isFinite(media.duration) ? Math.max(0, Math.min(86400, media.duration)) : 0;
      if (Number.isFinite(value.position)) { basePosition = Math.max(0, value.position); receivedAt = now(); }
      else if (typeof value.playing === 'boolean' && value.playing !== wasPlaying) { basePosition = previousPosition; receivedAt = now(); }
      if (Array.isArray(value.lines)) {
        lines = value.lines.filter(isDisplayLyric).slice(0, 1200).map(line => ({ time: line.time, text: line.text.slice(0, 1000), words: (Array.isArray(line.words) ? line.words : []).filter(word => [word.time, word.duration, word.c0, word.c1].every(Number.isFinite)).slice(0, 512).map(word => ({ time: word.time, duration: Math.max(.02, word.duration), c0: Math.max(0, word.c0), c1: Math.min(line.text.length, word.c1) })).sort((a, b) => a.time - b.time) })).sort((a, b) => a.time - b.time);
        rowSignature = '';
      }
      const cover = typeof media.cover === 'string' && media.cover.length <= 700000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(media.cover) ? media.cover : '';
      if (cover) { if (image.getAttribute('src') !== cover) { clearPalette(); image.src = cover; } image.hidden = false; }
      else { image.removeAttribute('src'); image.hidden = true; clearPalette(); }
      image.alt = [media.title, media.artist].filter(Boolean).join(' · ');
      $('.island-music-details strong').textContent = media.title || '';
      $('.island-music-details small').textContent = media.artist || '';
      renderControls(); sync();
    }
    function setPage(value, direction = 1) {
      page = value === 'music' ? 'music' : 'monitor';
      island.dataset.page = page;
      host.hidden = page !== 'music'; monitor.hidden = page === 'music';
      monitorDetails.hidden = page === 'music' || !expanded;
      $('.island-music-details').hidden = !expanded;
      const target = page === 'music' ? host : monitor;
      animate(target, [{ opacity: 0, transform: 'translateX(' + direction * 14 + 'px)' }, { opacity: 1, transform: 'translateX(0)' }], 180);
      sync();
    }
    function setExpanded(value) {
      expanded = value === true;
      monitorDetails.hidden = page === 'music' || !expanded;
      $('.island-music-details').hidden = !expanded;
      renderProgress();
    }
    function hold(value) { Promise.resolve(view.pulse?.islandInteraction?.({ type: 'hold', value })).catch(() => {}); }
    function finishSeek({ cancel = false } = {}) {
      if (cancel) seekTarget = null;
      if (!scrubbing) return;
      scrubbing = false; hold(false); renderProgress();
    }
    on(host, 'click', event => { const button = event.target.closest('[data-music-command]'); if (button) { event.stopPropagation(); command(button.dataset.musicCommand); } });
    on(host, 'dblclick', event => { if (event.target.closest('[data-island-interactive]')) event.stopPropagation(); });
    on(seek, 'pointerdown', () => { scrubbing = true; seekTarget = Number(seek.value); hold(true); });
    on(seek, 'input', () => { seekTarget = Number(seek.value); renderProgress(); });
    on(seek, 'change', () => { const target = seekTarget ?? Number(seek.value); seekTarget = null; command('seek', target); finishSeek(); });
    on(document, 'pointerup', () => finishSeek());
    on(document, 'pointercancel', () => finishSeek({ cancel: true }));
    on(view, 'blur', () => finishSeek({ cancel: true }));
    on(document, 'visibilitychange', () => { if (document.hidden) finishSeek({ cancel: true }); sync(); });
    on(image, 'load', coverPalette);
    on(image, 'error', () => { image.hidden = true; clearPalette(); syncArtwork(); });
    const unsubscribe = view.pulse?.onMediaUpdate?.(receive) || (() => {});
    setPage('music');
    return { setPage, setExpanded, receive, getState: () => ({ page, expanded, trackKey, position: position(), lines: lines.length, pendingFrame: frame !== null, scrubbing }), dispose() { if (disposed) return; disposed = true; stop(); finishSeek(); if (noticeTimer !== null) view.clearTimeout(noticeTimer); for (const timer of lyricTimers) view.clearTimeout(timer); lyricTimers.clear(); unsubscribe(); listeners.splice(0).forEach(remove => remove()); for (const animation of animations) animation.cancel(); animations.clear(); host.remove(); } };
  }
  return { create, lineAt, progressAt, isDisplayLyric };
});
