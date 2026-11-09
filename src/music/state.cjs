'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {song} = require('./catalog.cjs');
const {authError} = require('./netease.cjs');
const {validQuality,normalizeQuality}=require('./quality.cjs');
const {providerKey}=require('./provider-song.cjs');
const MAX_BYTES = 512 * 1024;
const workspaceProvider = value => ['netease','qq','kugou','qishui','spotify'].includes(value);
const dayKey=timestamp=>new Date(timestamp+8*3600000).toISOString().slice(0,10);
function createMusicState(dataDir) {
  const file = dataDir ? path.join(dataDir, 'music-state.json') : null;
  let loaded = false, current = {version: 2, preferences: {}, listening: [], recent: []};
  const normalize = input => ({version: 2, preferences: {...(workspaceProvider(input?.preferences?.activeProvider)?{activeProvider:input.preferences.activeProvider}:{}),...(validQuality(input?.preferences?.quality)?{quality:normalizeQuality(input.preferences.quality)}:{})}, listening:(Array.isArray(input?.listening)?input.listening:[]).slice(-366).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row?.date)).map((row,index,rows)=>({date:row.date,seconds:Math.max(0,Math.min(86400,Number(row.seconds)||0)),ids:index>=rows.length-7?[...new Set(Array.isArray(row.ids)?row.ids.map(String).filter(id=>/^[1-9]\d{0,15}$/.test(id)||providerKey(id)):[])].slice(0,300):[]})),recent: (Array.isArray(input?.recent) ? input.recent : []).slice(0, 100).map(entry => {
    const value = song(entry); if (!value) return null;
    return {...value, position: Math.max(0, Math.min(value.duration || 86400, Number(entry.position) || 0)), playedAt: Number(entry.playedAt) || 0};
  }).filter(Boolean)});
  function load() {
    if (loaded) return; loaded = true;
    if (!file) return;
    let handle, rewritePreferences = false;
    try {
      handle = fs.openSync(file, 'r');
      const bytes = Buffer.alloc(MAX_BYTES + 1), read = fs.readSync(handle, bytes, 0, bytes.length, 0);
      if (read <= MAX_BYTES) {
        const input = JSON.parse(bytes.subarray(0, read).toString('utf8'));
        current = normalize(input);
        rewritePreferences = JSON.stringify(input?.preferences || {}) !== JSON.stringify(current.preferences);
      }
    } catch {} finally { if (handle !== undefined) fs.closeSync(handle); }
    // Remove obsolete preference keys on the next read without touching auth
    // storage. A failed migration still leaves a sanitized in-memory state.
    if (rewritePreferences) { try { save(current); } catch {} }
  }
  function get() { load(); return structuredClone(current); }
  function save(next) {
    load(); const value = normalize(next); if (!file) { current = value; return get(); }
    const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`; let handle;
    try {
      const serialized = JSON.stringify(value); if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error();
      fs.mkdirSync(path.dirname(file), {recursive: true}); handle = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(handle, serialized); fs.fsyncSync(handle); fs.closeSync(handle); handle = undefined;
      fs.renameSync(temporary, file); current = value; return get();
    } catch { throw authError('STORAGE_FAILED', '无法保存音乐偏好或播放历史，请检查数据目录权限'); }
    finally { if (handle !== undefined) fs.closeSync(handle); try { fs.unlinkSync(temporary); } catch {} }
  }
  function listening(now){const state=get(),today=dayKey(now),row=state.listening?.find(row=>row.date===today),days=new Set((state.listening||[]).filter(row=>row.seconds>0).map(row=>row.date));let streakDays=0,at=Date.parse(today+'T00:00:00+08:00');if(!days.has(today))at-=86400000;for(let n=0;n<366&&days.has(dayKey(at));n++,at-=86400000)streakDays++;return {todaySeconds:row?.seconds||0,todaySongs:row?.ids.length||0,streakDays};}
  return {get,listening, preferences(payload = {}) { const state = get(); let changed=false;if(workspaceProvider(payload.activeProvider)){state.preferences.activeProvider=payload.activeProvider;changed=true;}if(validQuality(payload.quality)){state.preferences.quality=normalizeQuality(payload.quality);changed=true;}return changed?save(state).preferences:state.preferences; },
    progress(value, position, duration, now,seconds=0) { const state = get(), recent = {...value, duration: duration || value.duration, position, playedAt: now}; state.recent = [recent, ...state.recent.filter(entry => entry.id !== value.id)].slice(0, 100);if(seconds>0){
        state.listening||=[];let at=now-Math.min(30,seconds)*1000;
        while(at<now){const date=dayKey(at),nextMidnight=Date.parse(date+'T00:00:00+08:00')+86400000,end=Math.min(now,nextMidnight);let day=state.listening.find(row=>row.date===date);if(!day){day={date,seconds:0,ids:[]};state.listening.push(day);}day.seconds+=(end-at)/1000;if(!day.ids.includes(value.id))day.ids.push(value.id);at=end;}
      }return save(state).recent; }};
}
module.exports = {createMusicState};
