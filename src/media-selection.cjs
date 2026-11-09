'use strict';

const crypto = require('node:crypto');
const { isLyricText } = require('./music/lyrics.cjs');

function createMediaSelection({ loadCover, onUpdate = () => {} } = {}) {
  let enabled = false;
  let disposed = false;
  let appState = null;
  let nativeState = null;
  let artwork = null;
  let coverKey = '';
  let pendingKey = '';
  let revision = 0;
  let lastSource = '';
  let signature = '';
  const unavailable = { available: false, playing: false, reason: 'no-playing-artwork' };

  function selected() {
    if (!enabled) return unavailable;
    const appAvailable=appState&&artwork&&coverKey===appState.coverURL;
    if (appState?.playing || (appState&&lastSource==='agentpulse'&&!nativeState?.playing)) {
      lastSource='agentpulse';
      return { ...appState, coverURL: undefined, cover: appAvailable?artwork:null, available: true, source: 'agentpulse' };
    }
    if (nativeState?.available) { lastSource=nativeState.source; return nativeState; }
    if (appState) { lastSource='agentpulse'; return {...appState,coverURL:undefined,cover:appAvailable?artwork:null,available:true,source:'agentpulse'}; }
    return unavailable;
  }

  function publish() {
    if (disposed) return;
    const value = selected();
    const key = JSON.stringify(value);
    if (key === signature) return;
    signature = key;
    onUpdate(value);
  }

  function fetchArtwork() {
    const url = appState?.coverURL;
    if (!enabled || !appState || (!appState.playing&&nativeState?.playing) || !url || url === coverKey || url === pendingKey) return;
    const ticket = ++revision;
    pendingKey = url;
    Promise.resolve().then(() => loadCover(url)).then(value => {
      if (disposed || ticket !== revision) return;
      pendingKey = '';
      artwork = value || null;
      coverKey = url;
      publish();
    }).catch(() => {
      if (ticket === revision) { pendingKey = ''; coverKey = url; artwork = null; publish(); }
    });
  }

  return {
    configure(value) {
      enabled = value === true;
      if (!enabled) { revision++; pendingKey = ''; artwork = null; coverKey = ''; }
      else fetchArtwork();
      publish();
    },
    setNative(value) { nativeState = value; publish(); },
    setApp(value) {
      if (!value?.id) { appState = artwork = null; revision++; pendingKey = coverKey = ''; publish(); return; }
      const id = String(value.id).slice(0, 128);
      const coverURL = typeof value.coverURL === 'string' ? value.coverURL.slice(0, 4096) : '';
      const changed=appState?.id!==id;
      const oldLines=changed?[]:appState?.lines||[];
      if (appState?.coverURL !== coverURL) { revision++; pendingKey = ''; }
      appState = {
        id,
        title: String(value.title || '').slice(0, 300), artist: String(value.artist || '').slice(0, 300),
        coverURL, playing: value.playing === true,
        position:Math.max(0,Math.min(86400,Number(value.position)||0)),duration:Math.max(0,Math.min(86400,Number(value.duration)||0)),
        timelineKnown:Number(value.duration)>0 || Number(value.position)>0,
        canControl:true,
        lines:Array.isArray(value.lines)?value.lines.filter(line=>line&&Number.isFinite(line.time)&&isLyricText(line.text)).slice(0,1000).map(line=>({time:Math.max(0,line.time),text:String(line.text).slice(0,500),...(Array.isArray(line.words)?{words:line.words.slice(0,200).map(word=>({time:Math.max(0,Number(word.time)||0),duration:Math.max(0,Number(word.duration)||0),c0:Math.max(0,Number(word.c0)||0),c1:Math.max(0,Number(word.c1)||0),text:String(word.text||'').slice(0,500)}))}:{})})):oldLines,
        trackKey: crypto.createHash('sha256').update(id + '\n' + coverURL).digest('hex')
      };
      fetchArtwork();
      publish();
    },
    getStatus: selected,
    dispose() { disposed = true; revision++; appState = nativeState = artwork = null; pendingKey = coverKey = ''; }
  };
}

module.exports = { createMediaSelection };
