'use strict';
// One-line Harness state presentation. It never receives logs or tool arguments.
(() => {
  const host = document.getElementById('island-title');
  if (!host) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let sessionId = null, current = null, latest = null, incoming = null, pending = null;
  let outgoingNode = null, incomingNode = null, animations = [], generation = 0, disposed = false;
  let motion = 'scroll';
  host.classList.add('header-status');

  function normalize(value = {}) {
    const raw = typeof value.text === 'string' ? value.text : '';
    const cleaned = window.PulseTextPreview?.clean ? window.PulseTextPreview.clean(raw, 240) : raw;
    const text = String(cleaned || '').replace(/\s+/g, ' ').trim() || '等待活动';
    const points = Array.from(text);
    return { key: String(value.key || text).slice(0, 256), text: points.length > 28 ? points.slice(0, 27).join('') + '…' : text };
  }
  function nodeFor(item) {
    const node = document.createElement('span');
    node.className = 'header-status-entry';
    node.textContent = item.text;
    return node;
  }
  function mark() {
    host.dataset.headerStatusKey = current?.key || '';
    host.dataset.headerStatusTransitioning = String(Boolean(incoming));
    host.dataset.headerStatusQueued = String(pending ? 1 : 0);
  }
  function cancelTransition() {
    generation++;
    const previous = animations; animations = [];
    previous.forEach(animation => { try { animation.cancel(); } catch {} });
    incoming = null; outgoingNode = incomingNode = null;
    host.classList.remove('is-transitioning');
    mark();
  }
  function show(item) {
    current = item;
    host.replaceChildren(nodeFor(item));
    mark();
  }
  function canAnimate() {
    return !document.hidden && motion !== 'still' && (motion !== 'system' || !reduced.matches)
      && typeof host.animate === 'function';
  }
  function settleLatest() {
    cancelTransition(); pending = null;
    if (latest) show(latest);
    else mark();
  }
  function animateTo(next) {
    if (disposed) return;
    if (!current || !canAnimate() || current.text === next.text) { show(next); return; }
    const request = ++generation;
    incoming = next;
    outgoingNode = nodeFor(current); incomingNode = nodeFor(next);
    host.replaceChildren(outgoingNode, incomingNode);
    host.classList.add('is-transitioning');
    mark();
    const easing = getComputedStyle(host).getPropertyValue('--ease').trim() || 'cubic-bezier(.23, 1, .32, 1)';
    const timing = { duration: 240, easing, fill: 'both' };
    try {
      animations = [];
      animations.push(outgoingNode.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-100%)', opacity: 0 }], timing));
      animations.push(incomingNode.animate([{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], timing));
      Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => {
        if (disposed || request !== generation) return;
        const committed = incoming, nextPending = pending;
        pending = null;
        cancelTransition(); show(committed);
        if (nextPending) animateTo(nextPending);
      });
    } catch { settleLatest(); }
  }
  function update(value = {}) {
    if (disposed) return;
    const nextSession = String(value.sessionId || '').slice(0, 256), next = normalize(value);
    if (nextSession !== sessionId) {
      sessionId = nextSession; latest = next; settleLatest(); return;
    }
    // A stream edit changes the text already on screen, rather than replaying
    // another slide for each token. A newer pending state remains the latest.
    if (incoming && current?.key === next.key) {
      current = next; if (outgoingNode) outgoingNode.textContent = next.text; return;
    }
    if (incoming?.key === next.key) {
      incoming = next; if (incomingNode) incomingNode.textContent = next.text;
      if (!pending) latest = next;
      return;
    }
    if (!incoming && current?.key === next.key) {
      latest = current = next;
      if (host.firstElementChild) host.firstElementChild.textContent = next.text;
      else show(next);
      mark(); return;
    }
    latest = next;
    if (!canAnimate()) { settleLatest(); return; }
    if (incoming) { pending = next; mark(); return; }
    animateTo(next);
  }
  function setMotion(value) {
    motion = ['scroll', 'system', 'still'].includes(value) ? value : 'scroll';
    host.dataset.headerStatusMotion = motion;
    if (!canAnimate()) settleLatest();
  }
  function visibilityChanged() { if (document.hidden) settleLatest(); }
  function preferenceChanged() { if (motion === 'system' && reduced.matches) settleLatest(); }
  function dispose() {
    if (disposed) return;
    disposed = true; settleLatest();
    document.removeEventListener('visibilitychange', visibilityChanged);
    reduced.removeEventListener('change', preferenceChanged);
    window.removeEventListener('pagehide', dispose);
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  reduced.addEventListener('change', preferenceChanged);
  window.addEventListener('pagehide', dispose, { once: true });
  window.PulseHeaderStatus = Object.freeze({ update, setMotion, dispose });
})();
