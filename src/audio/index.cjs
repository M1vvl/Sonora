'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Audio frames have their own bounded channel. They never rebuild usage snapshots.
function createAudioMonitor(options = {}) {
  let child = null, enabled = false, mode = 'auto', retry = null, attempts = 0, generation = 0;
  let status = { enabled: false, state: 'disabled', scope: 'default-output', mode };
  const executable = options.executablePath || path.join(__dirname, '../../native/audio/bin/AgentPulse.AudioProbe.exe');
  const launch = options.spawn || spawn;
  function publish(value) {
    status = { ...status, ...value, mode, enabled };
    options.onFrame?.(status);
  }
  function quiet(state, message = '') { publish({ state, message, active: false, levels: [0, 0, 0], audioSources: [] }); }
  function stopChild() {
    clearTimeout(retry); retry = null; generation++;
    if (child) { const current = child; child = null; current.stdin?.end(); current.kill(); }
  }
  function startChild() {
    if (!enabled || child) return;
    if (process.platform !== 'win32' && !options.spawn) { quiet('unavailable', '音频律动目前支持 Windows'); return; }
    if (!options.spawn && !fs.existsSync(executable)) { quiet('unavailable', '缺少音频分析组件'); return; }
    const token = ++generation;
    let buffer = '', stderr = '';
    quiet('starting');
    const instance = launch(executable, mode === 'music' ? ['--music-only'] : [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = instance;
    instance.stdin?.on('error', () => {}); // A crashed helper can close its pipe before shutdown.
    instance.stdout.setEncoding('utf8');
    instance.stdout.on('data', chunk => {
      if (token !== generation) return;
      buffer += chunk;
      if (buffer.length > 65536) { buffer = ''; return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.type === 'frame' && Array.isArray(value.levels) && value.levels.length === 3 && value.levels.every(Number.isFinite)) {
          publish({ state: 'listening', active: value.active === true, levels: value.levels.map(n => Math.max(0, Math.min(1, n))),
            audioSources: (value.audioSources || []).filter(n => typeof n === 'string').slice(0, 16), message: '' });
        } else if (value.type === 'status') {
          quiet(['listening', 'idle', 'unavailable'].includes(value.state) ? value.state : 'unavailable', String(value.message || '').slice(0, 300));
        }
      }
    });
    instance.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-1000); });
    let ended = false;
    function failed(error) {
      if (ended || token !== generation) return;
      ended = true; child = null;
      quiet('unavailable', String(error?.message || stderr || '音频组件退出').slice(0, 300));
      if (enabled && attempts < 3) { const delay = 1000 * 2 ** attempts++; retry = setTimeout(startChild, delay); retry.unref?.(); }
    }
    instance.on('error', failed);
    instance.on('exit', () => failed());
  }
  function configure(value = {}) {
    const nextEnabled = value.enabled === true, nextMode = value.mode === 'music' ? 'music' : 'auto';
    if (nextEnabled === enabled && nextMode === mode) return;
    stopChild(); enabled = nextEnabled; mode = nextMode; attempts = 0;
    if (enabled) startChild(); else quiet('disabled');
  }
  return { configure, stop: () => { enabled = false; stopChild(); quiet('disabled'); },
    getStatus: () => structuredClone(status), getPid: () => child?.pid || null };
}
module.exports = { createAudioMonitor };
