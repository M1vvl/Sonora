'use strict';

// Render only a synthetic local surface in a never-shown offscreen window.
// Compare Chromium's actual edge alpha with Win32's integer clipping region.
// No desktop pixels, user profile or remote network participates in this check.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const vm = require('node:vm');
const workspace = path.resolve(__dirname, '..');
const output = path.join(workspace, 'artifacts/dashboard-edge-report.json');

if (!process.versions.electron) {
  const environment = {...process.env};
  delete environment.ELECTRON_RUN_AS_NODE;
  const reports = [];
  for (const dpi of [96, 120, 144, 192]) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sonara-edge-check-'));
    let child;
    try {
      child = spawnSync(require('electron'), [__filename, '--edge-child', '--profile', profile, '--force-device-scale-factor=' + dpi / 96], {
        env: environment, windowsHide: true, encoding: 'utf8', timeout: 30000
      });
    } finally {
      const target = path.resolve(profile);
      if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('sonara-edge-check-')) {
        fs.rmSync(target, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
      }
    }
    const result = (child.stdout || '').split(/\r?\n/).find(line => line.startsWith('EDGE_REPORT '));
    if (!result || child.status !== 0) {
      process.stderr.write(child.stderr || '');
      throw new Error('Synthetic edge check failed at ' + dpi + ' DPI. ' + (child.stdout || '').slice(-1000));
    }
    reports.push(JSON.parse(result.slice('EDGE_REPORT '.length)));
  }
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify({syntheticOnly: true, windowShown: false, desktopCaptured: false, reports}, null, 2));
  console.log(JSON.stringify({output, reports}));
} else {
  run().then(() => require('electron').app.exit(0), error => {
    console.error(error.stack);
    require('electron').app.exit(1);
  });
}

async function run() {
  const {app, BrowserWindow, session, screen} = require('electron');
  const profile = process.argv[process.argv.indexOf('--profile') + 1];
  if (!profile || path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('sonara-edge-check-')) {
    throw new Error('Synthetic edge profile must be an isolated temporary directory');
  }
  app.setPath('userData', profile);
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (_details, reply) => reply({cancel: true}));
  const koffi = require('koffi');
  const gdi = koffi.load('gdi32.dll');
  const roundRegion = gdi.func('void * __stdcall CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height)');
  const inRegion = gdi.func('int __stdcall PtInRegion(void *region, int x, int y)');
  const deleteRegion = gdi.func('int __stdcall DeleteObject(void *region)');
  const nativeModule = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(workspace, 'src/dashboard-shape.cjs'), 'utf8') +
    '\nmodule.exports.createCheckedRegion = bindings().createRegion;', {module: nativeModule, require, Buffer, process});
  const createCheckedRegion = nativeModule.exports.createCheckedRegion;
  const css = fs.readFileSync(path.join(workspace, 'ui/dashboard-material.css'), 'utf8');
  const scale = screen.getPrimaryDisplay().scaleFactor;
  const report = {dpi: Math.round(scale * 96), scale, modes: []};
  const window = new BrowserWindow({
    width: 600, height: 300, frame: false, transparent: true, hasShadow: false,
    backgroundColor: '#00000000', show: false,
    webPreferences: {offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false}
  });
  try {
    const web = window.webContents;
    // Offscreen output has a 1x backing store even when Windows display scale
    // is forced. Browser zoom reproduces the requested DIP-to-pixel transform.
    web.setFrameRate(10);
    let lastImage = null;
    let paintSerial = 0;
    web.on('paint', (_event, _rect, image) => {lastImage = image;paintSerial++;});
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><style>html,body{margin:0;--bg:#002fa7;--surface:#13245f;--border:#466189}*{box-sizing:border-box}.app-shell{height:100vh;width:100vw}' + css + '</style></head><body><div class="app-shell"></div></body></html>'));
    web.setZoomFactor(scale);
    for (const glass of [false, true]) {
      const before = paintSerial;
      const computed = await web.executeJavaScript(`(() => {
        document.documentElement.dataset.dashboardGlass = ${JSON.stringify(String(glass))};
        const shell = document.querySelector('.app-shell');
        const after = getComputedStyle(shell, '::after');
        return {clipPath:getComputedStyle(shell).clipPath,afterContent:after.content,afterShadow:after.boxShadow,devicePixelRatio,
          bodyBackground:getComputedStyle(document.body).backgroundColor,glass:${glass}};
      })()`);
      web.invalidate();
      await new Promise(resolve => setTimeout(resolve, 250));
      const deadline = Date.now() + 5000;
      while (paintSerial <= before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (paintSerial <= before || !lastImage) throw new Error('No synthetic offscreen paint');
      const size = lastImage.getSize(scale);
      const pixels = lastImage.toBitmap({scaleFactor: scale});
      const centerAlpha = pixels[(Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4 + 3];
      if (pixels.length !== size.width * size.height * 4 || !centerAlpha || pixels[3] !== 0) {
        throw new Error('Synthetic surface did not paint a clear corner and visible center');
      }
      const radius = Math.round(24 * scale);
      const coverage = [];
      for (const implementation of ['legacy', 'production']) {
        const region = implementation === 'production'
          ? createCheckedRegion(size.width, size.height, radius * 2)
          : roundRegion(0, 0, size.width, size.height, radius * 2, radius * 2);
        if (!region) throw new Error('No GDI region');
        let clippedPixels = 0, maxClippedAlpha = 0;
        try {
          for (let y = 0; y < size.height; y++) {
            for (let x = 0; x < size.width; x++) {
              if (x > radius + 3 && x < size.width - radius - 4 && y > 1 && y < size.height - 2) continue;
              if (y > radius + 3 && y < size.height - radius - 4 && x > 1 && x < size.width - 2) continue;
              const alpha = pixels[(y * size.width + x) * 4 + 3];
              if (alpha && !inRegion(region, x, y)) {
                clippedPixels++;
                maxClippedAlpha = Math.max(maxClippedAlpha, alpha);
              }
            }
          }
        } finally { deleteRegion(region); }
        coverage.push({implementation, clippedPixels, maxClippedAlpha});
      }
      report.modes.push({...computed, width: size.width, height: size.height, centerAlpha, coverage});
      if (!glass && (computed.afterContent !== 'none' || computed.afterShadow !== 'none')) throw new Error('Glass depth leaks into the flat theme');
      if (Math.abs(computed.devicePixelRatio - scale) > .01) throw new Error('Synthetic raster scale does not match requested DPI');
      if (coverage.find(row => row.implementation === 'production').clippedPixels !== 0) throw new Error('Native region cuts the Chromium edge alpha');
    }
    if (window.isVisible()) throw new Error('Synthetic edge window became visible');
    console.log('EDGE_REPORT ' + JSON.stringify(report));
  } finally {
    window.destroy();
  }
}
