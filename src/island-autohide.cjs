'use strict';

const EDGE_BAND = 2;
const REVEAL_DELAY_MS = 160;
const HIDE_DELAY_MS = 450;
const PULL_DISTANCE = 48;

function insideRoundedBounds(point, bounds, radius) {
  if (!point || !bounds) return false;
  const x = point.x - bounds.x;
  const y = point.y - bounds.y;
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return false;
  const r = Math.max(0, Math.min(radius, bounds.width / 2, bounds.height / 2));
  const nearestX = Math.max(r, Math.min(bounds.width - r, x));
  const nearestY = Math.max(r, Math.min(bounds.height - r, y));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= r ** 2;
}

function isDownwardPull({ dx = 0, dy = 0, cancelled = false } = {}) {
  return cancelled !== true && Number.isFinite(dx) && Number.isFinite(dy) &&
    dy >= PULL_DISTANCE && dy >= Math.abs(dx) * 1.5;
}

function createIslandAutoHide({
  getWindow,
  getSettings,
  saveSettings,
  screen,
  isExpanded = () => false,
  onSettingsChanged = () => {},
  onVisibilityChanged = () => {},
  isSmoke = false,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (!getWindow || !getSettings || !saveSettings || !screen) {
    throw new TypeError('Island auto hide needs window, settings and screen adapters');
  }

  let timer = null;
  let disposed = false;
  let dragging = false;
  let held = false;
  let enabled = false;
  let autoHide = false;
  let modeInitialized = false;
  let feedbackUntil = 0;
  let leaveAt = null;
  let edgeAt = null;
  let ignoredWindow = null;
  let ignoreMouse = null;

  const currentWindow = () => {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function setInputIgnored(win, value) {
    if (!win) return;
    if (ignoredWindow === win && ignoreMouse === value) return;
    win.setIgnoreMouseEvents(value, { forward: true });
    ignoredWindow = win;
    ignoreMouse = value;
  }

  function displayFor(point) {
    const displays = screen.getAllDisplays?.() || [];
    return displays.find(display => {
      const b = display.bounds;
      return point.x >= b.x && point.x < b.x + b.width &&
        point.y >= b.y && point.y < b.y + b.height;
    }) || screen.getDisplayNearestPoint(point);
  }

  function dock(win, display) {
    const bounds = win.getBounds();
    const area = display.workArea || display.bounds;
    const screenBounds = display.bounds || area;
    const x = Math.round(screenBounds.x + (screenBounds.width - bounds.width) / 2);
    const y = Math.round(Math.max(area.y, screenBounds.y) + 10);
    if (bounds.x !== x || bounds.y !== y) win.setPosition(x, y);
  }

  function show(win, display) {
    if (display) dock(win, display);
    leaveAt = null;
    edgeAt = null;
    setInputIgnored(win, false);
    if (!win.isVisible()) {
      win.showInactive();
      onVisibilityChanged(true);
    }
  }

  function hide(win) {
    leaveAt = null;
    edgeAt = null;
    setInputIgnored(win, false);
    if (win.isVisible()) {
      win.hide();
      onVisibilityChanged(false);
    }
  }

  function schedule() {
    if (timer !== null || disposed || !enabled || isSmoke || !currentWindow()) return;
    const delay = currentWindow()?.isVisible() ? 125 : 200;
    timer = setTimer(() => {
      timer = null;
      tick();
      schedule();
    }, delay);
    timer?.unref?.();
  }

  function tick() {
    const win = currentWindow();
    if (disposed || !enabled || !win) return;
    const point = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const inside = insideRoundedBounds(point, bounds, isExpanded() ? 26 : 22);
    const busy = dragging || held || isExpanded();

    if (win.isVisible()) {
      // Only transparent pixels outside the actual rounded surface pass through.
      // The solid island retains input so a double click can reach Chromium.
      setInputIgnored(win, !busy && !inside);
      if (!autoHide || busy || inside || now() < feedbackUntil) {
        leaveAt = null;
        return;
      }
      if (leaveAt === null) leaveAt = now();
      if (now() - leaveAt >= HIDE_DELAY_MS) hide(win);
      return;
    }

    if (!autoHide || busy) {
      show(win);
      return;
    }
    const display = displayFor(point);
    const atTop = point.y >= display.bounds.y && point.y <= display.bounds.y + EDGE_BAND;
    if (!atTop) {
      edgeAt = null;
      return;
    }
    if (edgeAt === null) edgeAt = now();
    if (now() - edgeAt >= REVEAL_DELAY_MS) show(win, display);
  }

  function configure() {
    if (disposed) return;
    const settings = getSettings();
    enabled = settings.islandEnabled === true;
    const nextMode = settings.islandAutoHide === true;
    if (modeInitialized && nextMode !== autoHide) feedbackUntil = now() + 1600;
    modeInitialized = true;
    autoHide = nextMode;
    const win = currentWindow();
    leaveAt = null;
    edgeAt = null;
    cancelTimer();
    if (!enabled || !win || isSmoke) {
      setInputIgnored(win, false);
      return;
    }
    if (!dragging) {
      const b = win.getBounds();
      dock(win, displayFor({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    }
    if (!autoHide || dragging || held || isExpanded()) show(win);
    tick();
    schedule();
  }

  return {
    configure,
    beginDrag() {
      if (disposed) return;
      dragging = true;
      leaveAt = null;
      setInputIgnored(currentWindow(), false);
    },
    endDrag(offset) {
      if (disposed) return false;
      dragging = false;
      const changed = isDownwardPull(offset);
      if (changed) {
        saveSettings({ islandAutoHide: getSettings().islandAutoHide !== true });
        onSettingsChanged();
      }
      configure();
      return changed;
    },
    hold(value) {
      held = value === true;
      configure();
    },
    getState: () => ({ enabled, autoHide, dragging, held, pendingTimer: timer !== null, ignored: ignoreMouse === true }),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelTimer();
      setInputIgnored(currentWindow(), false);
      ignoredWindow = null;
    }
  };
}

module.exports = { createIslandAutoHide, insideRoundedBounds, isDownwardPull };
