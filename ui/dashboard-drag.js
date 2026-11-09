(function (host, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    host.PulseDashboardDrag = api;
    const start = () => {
      const root = host.document?.querySelector('main');
      if (!root || typeof host.pulse?.moveDashboard !== 'function') return;
      const controller = api.createController({ root, moveWindow: value => host.pulse.moveDashboard(value) });
      host.addEventListener('pagehide', () => controller.dispose(), { once: true });
    };
    if (host.document?.readyState === 'loading') host.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const HOVER_MS = 320, DRAG_THRESHOLD = 5;
  const INTERACTIVE = 'button,a,input,select,textarea,summary,label,iframe,video,audio,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="slider"],[role="textbox"],[role="combobox"],[role="menuitem"],[role="checkbox"],[role="radio"],[data-no-window-drag]';
  function isReading(surface) {
    if (!surface?.ownerDocument) return false;
    const selection = surface.ownerDocument.getSelection();
    return Boolean(surface.querySelector('[data-pulse-drag-text-armed],[data-pulse-drag-text-pending]') || selection && !selection.isCollapsed && surface.contains(selection.anchorNode) && surface.contains(selection.focusNode));
  }
  function createController(options) {
    const { root, moveWindow } = options || {};
    if (!root?.ownerDocument || typeof moveWindow !== 'function') throw new TypeError('A dashboard root and moveWindow callback are required');
    const document = root.ownerDocument, view = document.defaultView;
    const now = options.now || (() => view.performance.now());
    const requestFrame = options.requestFrame || (callback => view.requestAnimationFrame(callback));
    const cancelFrame = options.cancelFrame || (id => view.cancelAnimationFrame(id));
    const schedule = options.schedule || ((callback, delay) => view.setTimeout(callback, delay));
    const cancelScheduled = options.cancelScheduled || (id => view.clearTimeout(id));
    const listeners = [], packets = [];
    let disposed = false, hover = null, hoverTimer = null, gesture = null, frame = null, busy = false, suppressedClick = null;
    root.classList.add('dashboard-drag-enabled');
    function listen(target, name, callback, capture = false) {
      target.addEventListener(name, callback, capture);
      listeners.push(() => target.removeEventListener(name, callback, capture));
    }
    function interactive(node) {
      const element = node?.nodeType === 3 ? node.parentElement : node;
      return Boolean(element?.closest?.(INTERACTIVE));
    }
    function caretAt(x, y, exact) {
      let node, offset;
      try {
        const position = document.caretPositionFromPoint?.(x, y);
        if (position) { node = position.offsetNode; offset = position.offset; }
        else {
          const range = document.caretRangeFromPoint?.(x, y);
          node = range?.startContainer; offset = range?.startOffset;
        }
        if (node?.nodeType !== 3 || !root.contains(node) || interactive(node)) return null;
        const text = node.nodeValue || '';
        if (!text.trim()) return null;
        offset = Math.max(0, Math.min(text.length, Number(offset) || 0));
        if (exact) {
          let hit = false;
          for (const index of new Set([offset, offset - 1])) {
            if (index < 0 || index >= text.length || !text[index].trim()) continue;
            const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1);
            hit = [...range.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom && rect.width > 0 && rect.height > 0);
            if (hit) break;
          }
          if (!hit) return null;
        }
        return { node, offset };
      } catch { return null; }
    }
    function clearHover() {
      if (hoverTimer !== null) cancelScheduled(hoverTimer);
      hoverTimer = null;
      hover?.element?.removeAttribute('data-pulse-drag-text-armed'); hover = null;
    }
    function armHover() {
      if (hoverTimer !== null) cancelScheduled(hoverTimer);
      hoverTimer = null;
      if (!hover || gesture || disposed || document.hidden) return;
      const hit = caretAt(hover.x, hover.y, true);
      if (!hit || hit.node !== hover.node) { clearHover(); return; }
      if (now() - hover.since >= HOVER_MS) {
        hover.armed = true; hover.element.setAttribute('data-pulse-drag-text-armed', 'true');
      }
    }
    function updateHover(event) {
      if (!root.contains(event.target) || interactive(event.target) || document.hidden) { clearHover(); return; }
      const hit = caretAt(event.clientX, event.clientY, true);
      if (!hit) { clearHover(); return; }
      if (hover?.node === hit.node) { hover.x = event.clientX; hover.y = event.clientY; if (now() - hover.since >= HOVER_MS) armHover(); return; }
      clearHover();
      hover = { node: hit.node, element: hit.node.parentElement, since: now(), x: event.clientX, y: event.clientY, armed: false };
      hoverTimer = schedule(armHover, HOVER_MS);
    }
    // Serialize IPC; consecutive queued moves for one gesture are overwritten.
    // A slow bridge therefore retains only its latest position, never every frame.
    function pump() {
      if (busy || !packets.length) return;
      const packet = packets.shift(); busy = true;
      if (packet.payload.phase === 'move') packet.gesture.sent = { x: packet.payload.deltaX, y: packet.payload.deltaY };
      Promise.resolve().then(() => moveWindow(packet.payload)).catch(() => {}).finally(() => { busy = false; pump(); });
    }
    function send(active, phase, point) {
      if (phase === 'move' && active.queuedDelta?.x === point.x && active.queuedDelta?.y === point.y) return;
      if (phase === 'move') active.queuedDelta = { ...point };
      const payload = { deltaX: point.x, deltaY: point.y, phase };
      const previous = packets[packets.length - 1];
      if (phase === 'move' && previous?.gesture === active && previous.payload.phase === 'move') previous.payload = payload;
      else packets.push({ gesture: active, payload });
      pump();
    }
    function flushMove() {
      frame = null;
      if (gesture?.mode === 'drag') send(gesture, 'move', gesture.delta);
    }
    function queueMove() { if (frame === null) frame = requestFrame(flushMove); }
    function point(event) {
      return { x: Number.isFinite(event.screenX) ? event.screenX : event.clientX, y: Number.isFinite(event.screenY) ? event.screenY : event.clientY };
    }
    function clearSelection() {
      try { document.getSelection()?.removeAllRanges(); } catch {}
      root.classList.remove('dashboard-selection-readable');
    }
    function selectTo(active, event) {
      const end = caretAt(event.clientX, event.clientY, false), selection = document.getSelection();
      if (!end || !selection) return false;
      try {
        if (typeof selection.setBaseAndExtent === 'function') selection.setBaseAndExtent(active.anchor.node, active.anchor.offset, end.node, end.offset);
        else {
          const range = document.createRange(); range.setStart(active.anchor.node, active.anchor.offset); range.collapse(true);
          selection.removeAllRanges(); selection.addRange(range);
          if (typeof selection.extend === 'function') selection.extend(end.node, end.offset);
          else { range.setEnd(end.node, end.offset); }
        }
        root.classList.add('dashboard-selection-readable');
        return true;
      } catch { return false; }
    }
    function down(event) {
      // A fresh pointer sequence and keyboard clicks must never inherit suppression.
      suppressedClick = null;
      if (disposed || event.button !== 0 || event.isPrimary === false || event.pointerType && event.pointerType !== 'mouse' || gesture || event.defaultPrevented || interactive(event.target)) return;
      const anchor = caretAt(event.clientX, event.clientY, true);
      if (hover && now() - hover.since >= HOVER_MS) armHover();
      const canSelect = Boolean(anchor && hover?.armed && hover.node === anchor.node);
      const start = point(event);
      gesture = { pointerId: event.pointerId, start, anchor, canSelect, mode: 'pending', delta: { x: 0, y: 0 }, sent: { x: 0, y: 0 } };
      clearHover();
      if (canSelect) anchor.node.parentElement?.setAttribute('data-pulse-drag-text-pending', 'true');
      event.preventDefault();
      try { root.setPointerCapture?.(event.pointerId); } catch {}
    }
    function move(event) {
      if (disposed) return;
      if (event.isPrimary === false || event.pointerType && event.pointerType !== 'mouse') { if (!gesture) clearHover(); return; }
      if (!gesture) { updateHover(event); return; }
      const active = gesture;
      if (event.pointerId !== active.pointerId) return;
      const current = point(event);
      active.delta = { x: current.x - active.start.x, y: current.y - active.start.y };
      const dx = Math.abs(active.delta.x), dy = Math.abs(active.delta.y);
      if (active.mode === 'pending') {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        const horizontal = dx >= DRAG_THRESHOLD && dx > dy * 1.5;
        if (active.canSelect && horizontal) {
          active.mode = 'selection'; root.classList.add('dashboard-text-selecting');
          selectTo(active, event);
        } else {
          active.mode = 'drag'; clearSelection(); root.classList.add('dashboard-window-dragging');
          send(active, 'begin', { x: 0, y: 0 }); queueMove();
        }
      } else if (active.mode === 'drag') queueMove();
      else selectTo(active, event);
      event.preventDefault();
    }
    function finish(event, cancelled = false) {
      if (!gesture || event && event.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
      const active = gesture;
      active.anchor?.node?.parentElement?.removeAttribute('data-pulse-drag-text-pending');
      if (frame !== null) cancelFrame(frame); frame = null;
      if (active.mode === 'drag') {
        if (cancelled) {
          for (let index = packets.length - 1; index >= 0; index--) if (packets[index].gesture === active && packets[index].payload.phase === 'move') packets.splice(index, 1);
        } else {
          if (event) { const current = point(event); active.delta = { x: current.x - active.start.x, y: current.y - active.start.y }; }
          send(active, 'move', active.delta);
        }
        send(active, 'end', cancelled ? active.sent : active.delta);
      } else if (active.mode === 'pending' && !cancelled) clearSelection();
      if (!cancelled && active.mode !== 'pending') suppressedClick = { pointerId: active.pointerId, at: now() };
      gesture = null;
      root.classList.remove('dashboard-window-dragging', 'dashboard-text-selecting');
      clearHover();
      try { if (root.hasPointerCapture?.(active.pointerId)) root.releasePointerCapture(active.pointerId); } catch {}
    }
    function click(event) {
      if (!suppressedClick || event.detail === 0 || now() - suppressedClick.at > 500) return;
      if (event.pointerId !== undefined && event.pointerId !== suppressedClick.pointerId) return;
      suppressedClick = null; event.preventDefault(); event.stopImmediatePropagation();
    }
    function selectionChanged() {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) root.classList.remove('dashboard-selection-readable');
    }
    const cancel = () => { finish(null, true); clearHover(); };
    const leave = () => { if (!gesture) clearHover(); };
    const visibility = () => { if (document.hidden) cancel(); };
    listen(root, 'pointerdown', down, true);
    listen(document, 'pointermove', move);
    listen(document, 'pointerup', event => finish(event));
    listen(document, 'pointercancel', event => finish(event, true));
    listen(root, 'lostpointercapture', event => finish(event, true));
    listen(root, 'pointerleave', leave);
    listen(root, 'click', click, true);
    listen(document, 'selectionchange', selectionChanged);
    listen(document, 'visibilitychange', visibility);
    listen(view, 'blur', cancel);
    listen(view, 'resize', cancel);
    return Object.freeze({
      get state() { return { mode: gesture?.mode || 'idle', armed: Boolean(hover?.armed), queued: packets.length, disposed }; },
      dispose() {
        if (disposed) return;
        cancel(); disposed = true; suppressedClick = null;
        listeners.forEach(remove => remove());
        root.classList.remove('dashboard-drag-enabled', 'dashboard-selection-readable');
      }
    });
  }
  return Object.freeze({ HOVER_MS, DRAG_THRESHOLD, createController, isReading });
});
