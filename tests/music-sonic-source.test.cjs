'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {JSDOM} = require('jsdom');
const base = path.resolve(__dirname, '../assets/music/source-presets');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('Sonic modules retain their recorded source bytes and original instanced geometry', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'source-manifest.json')));
  for (const row of manifest.sonicPorts) {
    const bytes = fs.readFileSync(path.join(base, row.path));
    assert.equal(hash(bytes), row.sha256);
    assert.equal(row.adaptation, 'unchanged');
  }
  const shaders = fs.readFileSync(path.join(base, 'cover-particles-source.js'), 'utf8');
  const starStart = shaders.indexOf('else {\nfloat bassGlow') + 'else '.length;
  const starCode = Buffer.from(shaders.slice(starStart)).subarray(0, manifest.sonicShader.starBranchBytes);
  assert.equal(hash(starCode), manifest.sonicShader.starBranchSHA256);
  const dom = new JSDOM('<!doctype html>', {runScripts: 'outside-only'});
  const window = dom.window;
  const context = dom.getInternalVMContext();
  const run = name => vm.runInContext(fs.readFileSync(path.join(base, name), 'utf8'), context);
  try {
    run('three.r128.min.js');
    window.fx = {...require('../ui/music/visual-settings.js').normalize(), preset: 7};
    window.scene = new window.THREE.Scene();
    window.stageLyrics = {coverPalette: {primary: '#778899', secondary: '#ffeedd', highlight: '#abcdef'}};
    window.orbit = {rotating: false};
    run('sonic-audio-monitor.js');
    run('sonic-topography-preset.js');
    const bins = new window.Uint8Array(1024).fill(100);
    const sonic = window.MineradioSonicTopography;
    sonic.onPresetChange(0, 7, {scene: window.scene, fx: window.fx});
    for (let index = 0; index < 60; index++) {
      const audio = window.stepSonicAudioMonitor(bins, 1 / 60, {
        fx: window.fx, playing: true, sampleRate: 44100, fftSize: 2048, currentTime: index / 60
      });
      assert.equal(audio.sonicDetailed, true);
      sonic.update(1 / 60, {scene: window.scene, fx: window.fx, audio, visualRotation: {x: 0, y: 0}});
    }
    const meshes = [];
    window.scene.traverse(node => {if (node.isInstancedMesh) meshes.push(node);});
    assert.equal(meshes.length, 4, 'source terrain, floating blocks, meteors and trails');
    const terrain = meshes.find(mesh => mesh.count >= 96 * 96);
    assert(terrain, 'retain original dense terrain geometry');
    assert(terrain.material.vertexShader.includes('uTime'));
    assert(terrain.material.uniforms.uTime.value > 0);
    let released = 0;
    for (const mesh of meshes) mesh.geometry.addEventListener('dispose', () => released++);
    sonic.onPresetChange(7, 0, {scene: window.scene, fx: {preset: 0}});
    assert.equal(window.scene.children.length, 0);
    assert.equal(released, 4);
  } finally {
    window.close();
  }
});
