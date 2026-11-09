const fs = require('node:fs');
const path = require('node:path');
const { normalize: normalizeTheme } = require('../ui/themes.js');
const DEFAULTS = Object.freeze({
  islandEnabled: true, alwaysOnTop: true, islandAutoHide: false, islandMaterial: 'acrylic', islandOpacity: 0.55,
  musicReactive: true, audioSourceMode: 'auto', musicCover: true, musicCoverMotion: 'rotate',
  dashboardGlass: false, dashboardOpacity: .6,
  activityMotion: 'scroll', interfaceTheme: 'carbon-lime', islandEdge: 'refract',
  pollIntervalMs: 1500,
  launchAtLogin: false, islandPosition: null
});
function sanitize(value, base = DEFAULTS) {
  const result = { ...base };
  if (!value || typeof value !== 'object') return result;
  for (const key of ['islandEnabled', 'alwaysOnTop', 'islandAutoHide', 'launchAtLogin', 'musicReactive', 'musicCover', 'dashboardGlass']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (['acrylic', 'css'].includes(value.islandMaterial)) result.islandMaterial = value.islandMaterial;
  if (['auto', 'music'].includes(value.audioSourceMode)) result.audioSourceMode = value.audioSourceMode;
  if (['rotate', 'system', 'still'].includes(value.musicCoverMotion)) result.musicCoverMotion = value.musicCoverMotion;
  if (['scroll', 'system', 'still'].includes(value.activityMotion)) result.activityMotion = value.activityMotion;
  if (Object.hasOwn(value, 'interfaceTheme')) result.interfaceTheme = normalizeTheme(value.interfaceTheme);
  if (['off', 'light', 'refract'].includes(value.islandEdge)) result.islandEdge = value.islandEdge;
  if (Number.isFinite(value.dashboardOpacity)) result.dashboardOpacity = Math.max(.18, Math.min(.9, value.dashboardOpacity));
  if (Number.isFinite(value.islandOpacity)) result.islandOpacity = Math.max(.25, Math.min(.9, value.islandOpacity));
  if (Number.isFinite(value.pollIntervalMs)) result.pollIntervalMs = Math.max(1000, Math.min(30000, Math.round(value.pollIntervalMs)));
  if (value.islandPosition === null) result.islandPosition = null;
  else if (value.islandPosition && Number.isFinite(value.islandPosition.x) && Number.isFinite(value.islandPosition.y)) {
    result.islandPosition = { x: Math.round(value.islandPosition.x), y: Math.round(value.islandPosition.y) };
  }
  return result;
}
function createSettings(file) {
  let current = { ...DEFAULTS };
  try { current = sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {}
  return {
    get: () => structuredClone(current),
    save: (value) => {
      current = sanitize(value, current);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(current, null, 2));
      fs.renameSync(temporary, file);
      return structuredClone(current);
    }
  };
}
module.exports = { DEFAULTS, sanitize, createSettings };
