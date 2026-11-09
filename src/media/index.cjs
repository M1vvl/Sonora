'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const SOURCES = new Set(['cloudmusic', 'qqmusic', 'applemusic', 'mineradio', 'spotify', 'kugou', 'kuwo', 'yesplaymusic', 'qishui']);
function validateMedia(value) {
  if (value?.type !== 'media') return null;
  const unavailable = { available: false, playing: false, reason: String(value.reason || 'no-artwork').slice(0, 100) };
  if (!value.available || !SOURCES.has(value.source)) return unavailable;
  if (value.cover != null && (typeof value.cover !== 'string' || value.cover.length > 512000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value.cover))) return unavailable;
  if (typeof value.trackKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.trackKey)) return unavailable;
  const duration = Number.isFinite(value.duration) ? Math.max(0, Math.min(86400, value.duration)) : 0;
  const position = Number.isFinite(value.position) ? Math.max(0, Math.min(duration || 86400, value.position)) : 0;
  const timelineKnown = value.timelineKnown !== false && (duration > 0 || position > 0);
  return { available: true, source: value.source, title: String(value.title || '').slice(0, 300), artist: String(value.artist || '').slice(0, 300), trackKey: value.trackKey, cover: value.cover || null, playing: value.playing === true,
    position, duration, timelineKnown, timelineSource:timelineKnown?(value.timelineSource==='uia'?'uia':'smtc'):'none',canControl: value.canControl === true, canToggle:value.canToggle===true,canSeek:timelineKnown&&duration>0&&value.canSeek===true,canPrevious:value.canPrevious===true,canNext:value.canNext===true };
}
function createMediaMonitor(options = {}) {
  const executable = options.executablePath || path.join(__dirname, '../../native/media/bin/AgentPulse.MediaProbe.exe');
  const launch = options.spawn || spawn;
  let child, enabled = false, generation = 0, restart, attempts = 0;
  let requestId = 0;
  const pending = new Map();
  let current = { available: false, playing: false, reason: 'disabled' }, signature = '';
  function publish(value) { const next = JSON.stringify(value); if (next !== signature) { signature = next; current = value; options.onUpdate?.(value); } }
  function start() {
    if (!enabled || child) return;
    if (!options.spawn && (process.platform !== 'win32' || !fs.existsSync(executable))) { publish({ available: false, playing: false, reason: 'media-helper-unavailable' }); return; }
    const token = ++generation; let buffer = '', ended = false;
    const instance = launch(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); child = instance;
    instance.stdin?.on('error', () => {}); instance.stderr?.resume(); instance.stdout.setEncoding('utf8');
    instance.stdout.on('data', chunk => {
      if (token !== generation) return;
      buffer += chunk;
      if (buffer.length > 1048576) { buffer = ''; publish({ available: false, playing: false, reason: 'oversized-media-message' }); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message?.type === 'command' && Number.isSafeInteger(message.requestId)) {
            const request = pending.get(message.requestId);
            if (request) { clearTimeout(request.timer);pending.delete(message.requestId);request.resolve(message.ok===true?{ok:true}:{error:'播放器未能执行此操作'}); }
          } else { const value = validateMedia(message); if (value) publish(value); }
        } catch {}
      }
    });
    function closed() {
      if (ended || token !== generation) return;
      ended = true; child = null; publish({ available: false, playing: false, reason: 'media-helper-exited' });
      cancelCommands();
      if (enabled && attempts < 3) { restart = setTimeout(start, 1000 * 2 ** attempts++); restart.unref?.(); }
    }
    instance.on('exit', closed); instance.on('error', closed);
  }
  function cancelCommands(){for(const request of pending.values()){clearTimeout(request.timer);request.resolve({error:'播放器连接已关闭'});}pending.clear();}
  function stopChild() { generation++; clearTimeout(restart);cancelCommands(); if (child) { const instance = child; child = null; instance.stdin?.end(); instance.kill(); } }
  return {
    control(action, target = {}) {
      if(!enabled||!child||!current.available||!current.canControl)return Promise.resolve({error:'当前播放器不可控制'});
      if(!['toggle','previous','next','seek'].includes(action)||target.source!==current.source||target.trackKey!==current.trackKey)return Promise.resolve({error:'歌曲已改变，请重试'});
      const capability={toggle:'canToggle',previous:'canPrevious',next:'canNext',seek:'canSeek'}[action];
      if(current[capability]!==true)return Promise.resolve({error:'此播放器未提供该操作'});
      const position=action==='seek'?target.position:0;
      if(!Number.isFinite(position)||position<0||position>86400)return Promise.resolve({error:'播放位置无效'});
      if(pending.size>=8)return Promise.resolve({error:'播放操作繁忙'});
      const id=++requestId,stream=child.stdin;
      return new Promise(resolve=>{
        const timer=setTimeout(()=>{pending.delete(id);resolve({error:'播放器响应超时'});},10000);timer.unref?.();pending.set(id,{resolve,timer});
        stream.write(['control',id,action,current.source,current.trackKey,Math.min(current.duration,position)].join('\t')+'\n',error=>{if(error){const request=pending.get(id);if(request){clearTimeout(request.timer);pending.delete(id);resolve({error:'播放器连接已关闭'});}}});
      });
    },
    configure(value) { const next = value?.enabled === true; if (next === enabled) return; enabled = next; attempts = 0; stopChild(); if (enabled) start(); else publish({ available: false, playing: false, reason: 'disabled' }); },
    stop() { enabled = false; stopChild(); publish({ available: false, playing: false, reason: 'disabled' }); },
    getStatus: () => ({ ...current }), getPid: () => child?.pid || null
  };
}
module.exports = { createMediaMonitor, validateMedia };
