'use strict';
// Native backdrop and Chromium per-pixel transparency are separate presentation
// paths. Never combine a full-window native backdrop with a layered alpha HWND.
const os = require('node:os');
const diagnostics = new WeakMap();
let bindings;
let nativeFailure = null;
function nativeBindings() {
  if (bindings) return bindings;
  const koffi = require('koffi');
  const user = koffi.load('user32.dll'), gdi = koffi.load('gdi32.dll'), registry = koffi.load('advapi32.dll');
  koffi.struct('PulseCompositionData', { attribute: 'uint32_t', data: 'void *', size: 'size_t' });
  koffi.struct('PulseRect', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  bindings = {
    readPreference: registry.func('int32_t __stdcall RegGetValueW(void *key, str16 subkey, str16 value, uint32_t flags, _Out_ uint32_t *type, _Out_ void *data, _Inout_ uint32_t *size)'),
    setAccent: user.func('int __stdcall SetWindowCompositionAttribute(void *hwnd, PulseCompositionData *data)'),
    dpi: user.func('uint32_t __stdcall GetDpiForWindow(void *hwnd)'),
    setRegion: user.func('int __stdcall SetWindowRgn(void *hwnd, void *region, int redraw)'),
    getRegion: user.func('int __stdcall GetWindowRgn(void *hwnd, void *region)'),
    roundRegion: gdi.func('void * __stdcall CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height)'),
    regionBox: gdi.func('int __stdcall GetRgnBox(void *region, _Out_ PulseRect *rect)'),
    deleteObject: gdi.func('int __stdcall DeleteObject(void *object)')
  };
  return bindings;
}
function supportsAcrylic() { return process.platform === 'win32' && Number(os.release().split('.')[2]) >= 17763; }
let preferenceCache;
function transparencyEnabled() {
  if (process.platform !== 'win32') return true;
  if (preferenceCache && Date.now() - preferenceCache.at < 1000) return preferenceCache.enabled;
  let enabled = true;
  try {
    const value = Buffer.alloc(4), size = [4], type = [0];
    const result = nativeBindings().readPreference(0xffffffff80000001n,
      'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 0x10, type, value, size);
    if (result === 0) enabled = value.readUInt32LE() !== 0;
  } catch {}
  preferenceCache = { at: Date.now(), enabled };
  return enabled;
}
function useNativeGlass(settings) {
  return supportsAcrylic() && transparencyEnabled() && settings.islandMaterial !== 'css' && !nativeFailure;
}
function hwndFor(win) {
  const value = win.getNativeWindowHandle();
  return value.length >= 8 ? value.readBigUInt64LE() : BigInt(value.readUInt32LE());
}
function applyMaterial(win, settings, expanded = false) {
  if (!win || win.isDestroyed()) return 'css';
  const details = { backend: 'per-pixel-transparent', nativeClip: false, material: 'css', systemTransparencyEnabled: transparencyEnabled() };
  if (settings.islandMaterial !== 'css' && !details.systemTransparencyEnabled) details.fallbackReason = 'system-transparency-disabled';
  else if (nativeFailure) { details.fallbackReason = 'native-material-unavailable'; details.error = nativeFailure; }
  if (useNativeGlass(settings)) {
    try {
      const api = nativeBindings(), hwnd = hwndFor(win), [width, height] = win.getSize();
      const dpi = api.dpi(hwnd) || 96, scale = dpi / 96, radius = Math.round((expanded ? 26 : 22) * scale);
      const policy = Buffer.alloc(16);
      policy.writeUInt32LE(4, 0); policy.writeUInt32LE(2, 4);
      policy.writeUInt32LE(0x01000000, 8);
      if (!api.setAccent(hwnd, { attribute: 19, data: policy, size: policy.length })) throw Error('Native desktop blur was rejected');
      // The clip starts at the HWND origin, with no rectangular outer padding.
      const region = api.roundRegion(0, 0, Math.round(width * scale), Math.round(height * scale), radius * 2, radius * 2);
      if (!region) throw Error('Could not allocate capsule region');
      if (!api.setRegion(hwnd, region, 1)) { api.deleteObject(region); throw Error('Could not clip capsule region'); }
      details.nativeClip = true; details.dpi = dpi;
      details.nativeAccentAccepted = true; details.requestedAccentState = 4;
      details.material = 'blur'; details.backend = 'native-hwnd-blur';
    } catch (error) { nativeFailure = String(error.message || error); details.error = nativeFailure; details.fallbackReason = 'native-material-unavailable'; }
  }
  diagnostics.set(win, details);
  return details.material;
}
function getMaterialDiagnostics(win) {
  if (!win || win.isDestroyed()) return null;
  const details = { ...diagnostics.get(win), windowBounds: win.getBounds() };
  if (details.nativeClip) {
    const api = nativeBindings(), probe = api.roundRegion(0, 0, 1, 1, 0, 0);
    if (probe) {
      try { const type = api.getRegion(hwndFor(win), probe); details.regionType = type; if (type > 0) { const rect = {}; api.regionBox(probe, rect); details.region = rect; } }
      finally { api.deleteObject(probe); }
    }
  }
  return details;
}
module.exports = { supportsAcrylic, transparencyEnabled, useNativeGlass, applyMaterial, getMaterialDiagnostics };
