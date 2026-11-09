'use strict';

if (!process.versions.electron) {
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename, ...process.argv.slice(2)],
    {env, windowsHide: true, stdio: 'inherit'});
  const timer = setTimeout(() => {child.kill(); process.exitCode = 1;}, 30000);
  child.on('exit', code => {clearTimeout(timer); process.exitCode = code ?? 1;});
} else {
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const argument = key => process.argv[process.argv.indexOf(key) + 1];
const root = path.resolve(process.argv.includes('--root') ? argument('--root') : path.join(__dirname, '..'));
const reportFile = path.resolve(argument('--report'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sonara-sonic-check-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('no-proxy-server');
const report = {checks: [], errors: [], source: root};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;

app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({show: false, width: 960, height: 540,
      webPreferences: {backgroundThrottling: false, nodeIntegration: false, contextIsolation: true}});
    window.webContents.on('console-message', event => {
      const message = event.message || '';
      if (/Shader Error|VALIDATE_STATUS.*false|Error compiling|ReferenceError|TypeError/.test(message)) report.errors.push(message);
    });
    await window.loadFile(path.join(root, 'assets/music/source-presets/standard.html'), {query: {token: 'sonic-check'}});
    await window.webContents.executeJavaScript(`renderer.info.autoReset = false;
      window.sonicTestErrors=[];addEventListener('error',event=>sonicTestErrors.push(event.message));
      addEventListener('message',event=>{if(event.data?.type==='pulse-preset-error')sonicTestErrors.push(event.data.error)});
      window.sonicTestSwitches=[];const change=MineradioSonicTopography.onPresetChange;
      MineradioSonicTopography.onPresetChange=(prev,next,ctx)=>{sonicTestSwitches.push([prev,next]);return change(prev,next,ctx)};void 0;`);
    const defaults = require(path.join(root, 'ui/music/visual-settings.js')).normalize({preset: 'topography'});
    async function frame(settings) {
      await window.webContents.executeJavaScript(`postMessage({type:'pulse-preset-frame',token:'sonic-check',
        settings:${JSON.stringify(settings)},playing:true,seeking:true,position:1,duration:180,time:performance.now(),
        width:960,height:540,audio:{bins:new Uint8Array(1024).fill(90),rms:.2,energy:.2,
        sampleRate:44100,fftSize:2048}},'*')`);
      await wait(220);
    }
    const inspect = () => window.webContents.executeJavaScript(`(() => {
      const meshes=[];scene.traverse(node=>{if(node.isInstancedMesh)meshes.push(node)});
      const terrain=meshes.find(node=>node.count>=96*96);
      return {meshCount:meshes.length,counts:meshes.map(node=>node.count),
        time:terrain?.material.uniforms.uTime.value,rotation:terrain?.parent.rotation.y,
        stars:particles.visible,preset:uniforms.uPreset.value,alpha:uniforms.uAlpha.value,
        calls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,
        programs:renderer.info.programs.map(program=>({runnable:program.diagnostics?.runnable})),
        contextLost:renderer.getContext().isContextLost(),errors:sonicTestErrors,switches:sonicTestSwitches};
    })()`);
    await frame(defaults);
    const first = await inspect();
    report.state = first;
    assert.equal(first.meshCount, 4);
    assert.equal(first.preset, 7);
    assert.equal(first.stars, true);
    assert(first.calls >= 3 && !first.contextLost);
    assert(first.programs.every(program => program.runnable !== false));
    report.checks.push('original terrain, floating blocks, meteors, trails and star shader compile and submit GPU draws');
    await wait(1250);
    const next = await inspect();
    assert(next.time > first.time);
    assert.notEqual(next.rotation, first.rotation);
    report.checks.push('source scene clock advances terrain and rotation without pointer input');
    await frame({...defaults, preset: 'cover'});
    report.afterSwitch = await inspect();
    assert.equal(report.afterSwitch.meshCount, 0);
    report.checks.push('switching to Emily releases all Sonic instanced meshes');
    await frame(defaults);
    assert.equal((await inspect()).meshCount, 4);
    await frame({...defaults, visualEnabled: false});
    const disabled = await inspect();
    assert.equal(disabled.meshCount, 0);
    assert.equal(disabled.stars, false);
    report.checks.push('preset toggle releases Sonic and hides the source star layers');
    await frame(defaults);
    const restored = await inspect();
    assert.equal(restored.meshCount, 4);
    assert(restored.geometries <= next.geometries, 'reopening accumulates GPU geometries');
    assert.deepEqual(report.errors, []);
    report.checks.push('reopening recreates the source layer with a stable geometry count');
    report.state = restored;
    await window.webContents.executeJavaScript("postMessage({type:'pulse-preset-dispose',token:'sonic-check'},'*')");
    await wait(50);
  } catch (error) {
    report.errors.push(error.stack || String(error));
  } finally {
    window?.destroy();
    fs.mkdirSync(path.dirname(reportFile), {recursive: true});
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({checks: report.checks.length, errors: report.errors, report: reportFile}));
    app.exit(report.errors.length ? 1 : 0);
  }
});
}
