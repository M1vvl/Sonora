'use strict';
// Bounded, read-only live probe; reports numeric envelopes, never raw audio.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createAudioMonitor } = require('../src/audio/index.cjs');
const started = performance.now(), frames = [], states = new Set();
const audio = createAudioMonitor({ onFrame(frame) {
  states.add(frame.state);
  if (Array.isArray(frame.levels) && frame.active) frames.push({ at: performance.now(), levels: frame.levels, sources: frame.audioSources });
} });
audio.configure({ enabled: true });
setTimeout(() => {
  const report = { measuredAt: new Date().toISOString(), durationMs: performance.now() - started,
    activeFrames: frames.length, states: [...states], sources: [...new Set(frames.flatMap(frame => frame.sources))],
    observedFPS: frames.length > 1 ? (frames.length - 1) * 1000 / (frames.at(-1).at - frames[0].at) : 0,
    min: [0, 1, 2].map(i => frames.length ? Math.min(...frames.map(frame => frame.levels[i])) : null),
    max: [0, 1, 2].map(i => frames.length ? Math.max(...frames.map(frame => frame.levels[i])) : null) };
  audio.stop(); report.helperStopped = audio.getPid() === null;
  const output = path.join(__dirname, '../artifacts/v0.3.0'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'audio-live-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}, 4000);
