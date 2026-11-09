'use strict';
// Media-only presentation: no player discovery, screen capture, or usage renders.
(() => {
  const avatar = document.getElementById('agent-avatar');
  const agent = document.getElementById('agent-orb');
  const cover = document.getElementById('music-cover');
  if (!avatar || !agent || !cover || !window.pulse?.onMediaUpdate) return;

  const maximumBytes = 512 * 1024;
  const originalTitle = avatar.getAttribute('title');
  let generation = 0, pending = null, visibleKey = '', pendingKey = '', disposed = false;
  let media = null;

  const label = value => typeof value === 'string' ? value.slice(0, 256) : '';
  function validCover(value) {
    if (typeof value !== 'string' || value.length > Math.ceil(maximumBytes / 3) * 4 + 40) return false;
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
    if (!match || match[1].length % 4) return false;
    const padding = match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0;
    return match[1].length * 3 / 4 - padding <= maximumBytes;
  }
  function stopPending() {
    if (!pending) return;
    pending.onload = pending.onerror = null;
    pending.src = '';
    pending = null;
  }
  function updatePlayback() {
    avatar.dataset.mediaPlaying = String(media?.playing === true);
    avatar.dataset.mediaVisible = String(!document.hidden);
    avatar.dataset.mediaMotion = media?.rotationMode || 'rotate';
  }
  function restoreAgent() {
    cover.hidden = true;
    cover.removeAttribute('src');
    cover.alt = '';
    agent.hidden = false;
    avatar.dataset.mediaActive = 'false';
    visibleKey = '';
    if (originalTitle === null) avatar.removeAttribute('title');
    else avatar.setAttribute('title', originalTitle);
    updatePlayback();
  }
  function describe() {
    const description = [media?.title, media?.artist, media?.source].filter(Boolean).join(' · ');
    avatar.title = description || '当前歌曲';
    cover.alt = description ? `歌曲封面：${description}` : '当前歌曲封面';
  }
  function receive(frame) {
    if (disposed) return;
    media = frame && typeof frame === 'object' ? {
      title: label(frame.title), artist: label(frame.artist), source: label(frame.source), playing: frame.playing === true,
      rotationMode: ['rotate', 'system', 'still'].includes(frame.rotationMode) ? frame.rotationMode : 'rotate'
    } : null;
    updatePlayback();
    if (frame?.available !== true || !validCover(frame.cover)) {
      generation++;
      pendingKey = '';
      stopPending();
      restoreAgent();
      return;
    }
    const key = `${label(frame.trackKey)}\n${frame.cover}`;
    if (key === visibleKey) { describe(); return; }
    if (key === pendingKey) return;

    const request = ++generation;
    stopPending();
    restoreAgent();
    pendingKey = key;
    const candidate = new Image();
    pending = candidate;
    candidate.decoding = 'async';
    const failed = () => {
      if (disposed || request !== generation) return;
      pendingKey = '';
      stopPending();
      restoreAgent();
    };
    candidate.onerror = failed;
    candidate.onload = async () => {
      try {
        if (typeof candidate.decode === 'function') await candidate.decode();
        if (disposed || request !== generation) return;
        if (!candidate.naturalWidth || !candidate.naturalHeight || candidate.naturalWidth > 2048 || candidate.naturalHeight > 2048) { failed(); return; }
        cover.src = candidate.src;
        cover.hidden = false;
        agent.hidden = true;
        avatar.dataset.mediaActive = 'true';
        visibleKey = key;
        pendingKey = '';
        pending = null;
        candidate.onload = candidate.onerror = null;
        describe();
        updatePlayback();
      } catch { failed(); }
    };
    candidate.src = frame.cover;
  }
  // The visible image can still fail independently after a successfully decoded
  // candidate, for example if Chromium rejects an image during presentation.
  function visibleError() {
    generation++;
    pendingKey = '';
    stopPending();
    restoreAgent();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    stopPending();
    if (typeof unsubscribe === 'function') unsubscribe();
    document.removeEventListener('visibilitychange', updatePlayback);
    window.removeEventListener('pagehide', dispose);
    cover.removeEventListener('error', visibleError);
    media = null;
    restoreAgent();
  }
  const unsubscribe = window.pulse.onMediaUpdate(receive);
  document.addEventListener('visibilitychange', updatePlayback);
  window.addEventListener('pagehide', dispose, { once: true });
  cover.addEventListener('error', visibleError);
  restoreAgent();
  window.agentPulseMediaCover = Object.freeze({ receive, dispose });
})();
