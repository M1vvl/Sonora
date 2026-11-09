'use strict';

// Dashboard navigation is intentionally separate from product preferences and
// usage records. Only a bounded description of the last panel is persisted.
const fs = require('node:fs');
const path = require('node:path');

const MAX_STATE_BYTES = 256 * 1024;
const MAX_IDS = 1000;
const MAX_ID_LENGTH = 512;
const ID_LIST_BYTES = 96 * 1024;
const DEFAULT_DASHBOARD_STATE = Object.freeze({
  version: 1,
  view: 'overview', selected: null, filter: 'all', query: '',
  range: 'today', date: null,
  closedProjects: Object.freeze([]), openSubagents: Object.freeze([]),
  compositionOpen: false, activityMode: 'daily',
  scroll: Object.freeze({ sessions: 0, events: 0, meta: 0, content: 0, activity: 0 })
});
let temporarySequence = 0;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function string(value, maximum) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}
function identifiers(value) {
  if (!Array.isArray(value)) return [];
  const result = [], seen = new Set();
  let bytes = 2;
  // The count and byte budgets prevent large project lists from producing a
  // file that the bounded reader could not subsequently restore.
  for (let index = 0; index < Math.min(value.length, MAX_IDS); index++) {
    const id = string(value[index], MAX_ID_LENGTH);
    if (!id || seen.has(id)) continue;
    const cost = Buffer.byteLength(JSON.stringify(id), 'utf8') + (result.length ? 1 : 0);
    if (bytes + cost > ID_LIST_BYTES) break;
    seen.add(id); result.push(id); bytes += cost;
  }
  return result;
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function normalizeDashboardState(value) {
  const result = structuredClone(DEFAULT_DASHBOARD_STATE);
  if (!record(value) || (value.version !== undefined && value.version !== 1)) return result;
  if (['overview', 'settings', 'anime', 'movies', 'music'].includes(value.view)) result.view = value.view;
  result.selected = string(value.selected, MAX_ID_LENGTH) || null;
  if (['all', 'Codex', 'Claude'].includes(value.filter)) result.filter = value.filter;
  result.query = string(value.query, 300);
  if (['today', 'history'].includes(value.range)) result.range = value.range;
  result.date = day(value.date);
  result.closedProjects = identifiers(value.closedProjects);
  result.openSubagents = identifiers(value.openSubagents);
  result.compositionOpen = value.compositionOpen === true;
  if (['daily', 'weekly', 'cumulative'].includes(value.activityMode)) result.activityMode = value.activityMode;
  if (record(value.scroll)) {
    for (const key of Object.keys(result.scroll)) {
      const position = value.scroll[key];
      if (typeof position === 'number' && Number.isFinite(position)) result.scroll[key] = Math.max(0, Math.min(1e7, position));
    }
  }
  return result;
}
function readBounded(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    if (fs.fstatSync(descriptor).size > MAX_STATE_BYTES) throw new RangeError('Dashboard state exceeds its size limit');
    const bytes = Buffer.alloc(MAX_STATE_BYTES + 1);
    const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    if (length > MAX_STATE_BYTES) throw new RangeError('Dashboard state exceeds its size limit');
    return JSON.parse(bytes.subarray(0, length).toString('utf8').replace(/^\uFEFF/, ''));
  } finally { fs.closeSync(descriptor); }
}
function createDashboardState(file, { onError } = {}) {
  let current = structuredClone(DEFAULT_DASHBOARD_STATE), persisted = false;
  const report = error => { try { onError?.(error); } catch {} };
  try {
    const saved = readBounded(file);
    if (record(saved) && saved.version === 1) {
      current = normalizeDashboardState(saved); persisted = true;
    }
  } catch (error) { if (error.code !== 'ENOENT') report(error); }
  let signature = JSON.stringify(current);
  return {
    get: () => structuredClone(current),
    save(value) {
      const next = normalizeDashboardState(value), payload = JSON.stringify(next);
      if (persisted && payload === signature) return structuredClone(current);
      if (Buffer.byteLength(payload, 'utf8') > MAX_STATE_BYTES) throw new RangeError('Dashboard state exceeds its size limit');
      const temporary = `${file}.tmp-${process.pid}-${++temporarySequence}`;
      let descriptor;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        descriptor = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(descriptor, payload, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor); descriptor = undefined;
        fs.renameSync(temporary, file);
        current = next; signature = payload; persisted = true;
        return structuredClone(current);
      } catch (error) { report(error); throw error; }
      finally {
        if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
        try { fs.unlinkSync(temporary); } catch {}
      }
    }
  };
}

module.exports = { DEFAULT_DASHBOARD_STATE, MAX_STATE_BYTES, normalizeDashboardState, createDashboardState };
