'use strict';
// Small, bounded presentation state. Log collection and usage accounting stay
// outside this module; only genuine new activity causes a replacement.
(() => {
  const feed = document.getElementById('activity-feed');
  const viewport = document.getElementById('activity-viewport');
  const track = document.getElementById('activity-track');
  if (!feed || !viewport || !track) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const maximumQueue = 6, maximumSeen = 128;
  const seen = new Map();
  let sessionId = null, current = null, latest = null, pending = [];
  let incoming = null, outgoingNode = null, incomingNode = null;
  let animations = [], generation = 0, expanded = false, disposed = false;
  let motion = ['scroll', 'system', 'still'].includes(document.documentElement?.dataset.activityMotion)
    ? document.documentElement.dataset.activityMotion : 'scroll';

  function clean(value) {
    if (window.PulseTextPreview?.clean) return window.PulseTextPreview.clean(value, 1600);
    return String(value || '').slice(0, 1600);
  }
  function normalize(event, index) {
    if (!event || ['usage', 'status'].includes(event.type)) return null;
    const text = clean(event.text) || clean(event.title);
    if (!text) return null;
    return {
      key: String(event.id || `${event.timestamp || ''}:${event.type || ''}:${text}`),
      text, timestamp: String(event.timestamp || ''), type: String(event.type || ''), index
    };
  }
  function nodeFor(item) {
    const node = document.createElement('p');
    node.className = 'activity-entry';
    node.dataset.activityId = item.key;
    node.textContent = item.text;
    return node;
  }
  function mark(item) {
    feed.dataset.activityId = item?.key || '';
    feed.dataset.activityError = String(item?.type === 'error');
    feed.dataset.activityQueued = String(pending.length);
  }
  function stopTransition() {
    generation++;
    const previous = animations; animations = [];
    previous.forEach(animation => { try { animation.cancel(); } catch {} });
    incoming = null; outgoingNode = incomingNode = null;
    track.classList.remove('is-transitioning');
    feed.dataset.activityTransitioning = 'false';
  }
  function show(item) {
    current = item;
    viewport.scrollTop = 0;
    track.replaceChildren(nodeFor(item));
    mark(item);
  }
  function settleLatest() {
    stopTransition(); pending = [];
    if (latest) show(latest);
    else if (current) show(current);
  }
  function canAnimate() {
    return expanded && !document.hidden && motion !== 'still'
      && (motion !== 'system' || !reduce.matches) && typeof track.animate === 'function';
  }
  function playNext() {
    if (disposed || incoming || !pending.length) return;
    if (!canAnimate()) { settleLatest(); return; }
    const next = pending.shift();
    if (!current) { show(next); playNext(); return; }
    const request = ++generation;
    incoming = next;
    outgoingNode = nodeFor(current); incomingNode = nodeFor(next);
    viewport.scrollTop = 0;
    track.replaceChildren(outgoingNode, incomingNode);
    track.classList.add('is-transitioning');
    feed.dataset.activityTransitioning = 'true';
    mark(current);
    const easing = getComputedStyle(feed).getPropertyValue('--ease').trim() || 'cubic-bezier(.23, 1, .32, 1)';
    const options = { duration: 220, easing, fill: 'both' };
    try {
      animations = [];
      animations.push(outgoingNode.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-100%)', opacity: 0 }], options));
      animations.push(incomingNode.animate([{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], options));
      Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => {
        if (disposed || request !== generation) return;
        const committed = incoming;
        stopTransition();
        show(committed);
        playNext();
      });
    } catch { settleLatest(); }
  }
  function update(value = {}) {
    if (disposed) return;
    const nextSession = String(value.sessionId || '');
    const changedSession = nextSession !== sessionId;
    const events = (Array.isArray(value.events) ? value.events : []).slice(-32)
      .map(normalize).filter(Boolean).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.index - b.index);
    if (changedSession) {
      stopTransition(); pending = []; seen.clear(); current = latest = null; sessionId = nextSession;
    }
    const newlySeen = [];
    for (const event of events) {
      const previous = seen.get(event.key);
      if (previous) {
        Object.assign(previous, event);
        if (current?.key === event.key) {
          const node = outgoingNode || track.firstElementChild;
          if (node) node.textContent = previous.text;
        }
        if (incoming?.key === event.key && incomingNode) incomingNode.textContent = previous.text;
      } else { seen.set(event.key, event); newlySeen.push(event); }
    }
    while (seen.size > maximumSeen) seen.delete(seen.keys().next().value);
    if (events.length) latest = seen.get(events.at(-1).key) || events.at(-1);
    if (!latest || latest.type === 'placeholder') {
      latest = { key: 'placeholder', text: value.loading ? '正在读取本地会话记录…' : nextSession ? '等待这个会话的下一次活动。' : '等待 Codex 或 Claude Code 的活动。', type: 'placeholder' };
    }
    if (changedSession || !current || current.type === 'placeholder' || !canAnimate()) { settleLatest(); return; }
    if (!newlySeen.length) return;
    pending.push(...newlySeen.filter(event => event.key !== current?.key && event.key !== incoming?.key));
    if (pending.length > maximumQueue) pending = pending.slice(-maximumQueue);
    mark(current);
    playNext();
  }
  function setExpanded(value) {
    expanded = value === true;
    if (!expanded) settleLatest();
  }
  function setMotion(value) {
    motion = ['scroll', 'system', 'still'].includes(value) ? value : 'scroll';
    feed.dataset.activityMotion = motion;
    if (!canAnimate()) settleLatest();
  }
  function showError(value) {
    if (disposed) return;
    const text = clean(value);
    if (!text) return;
    stopTransition(); pending = [];
    show({ key: 'temporary-error', type: 'error', text: `操作未完成：${text}` });
  }
  function visibilityChanged() { if (document.hidden) settleLatest(); }
  function preferenceChanged() { if (motion === 'system' && reduce.matches) settleLatest(); }
  function dispose() {
    if (disposed) return;
    disposed = true; stopTransition(); pending = []; seen.clear(); current = latest = null;
    document.removeEventListener('visibilitychange', visibilityChanged);
    reduce.removeEventListener('change', preferenceChanged);
    window.removeEventListener('pagehide', dispose);
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  reduce.addEventListener('change', preferenceChanged);
  window.addEventListener('pagehide', dispose, { once: true });
  window.PulseActivityFeed = Object.freeze({ update, setExpanded, setMotion, showError, dispose });
})();
