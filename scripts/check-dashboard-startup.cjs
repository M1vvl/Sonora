'use strict';

// Exercise the actual local renderer behind a never-shown native window.
// Every IPC response is synthetic. No installed profile, account, media,
// desktop pixels or remote service participates in this check.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');
const workspace = path.resolve(__dirname, '..');
const argument = name => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? null : process.argv[index + 1];
};
const root = path.resolve(argument('root') || workspace);
const output = path.resolve(argument('output') || path.join(workspace, 'artifacts/dashboard-startup'));

async function child() {
  const {app, BrowserWindow, ipcMain, session, screen} = require('electron');
  fs.mkdirSync(output, {recursive: true});
  const profile = fs.mkdtempSync(path.join(output, 'profile-'));
  app.setPath('userData', profile);
  app.disableHardwareAcceleration();
  // Multiple isolated windows are exercised sequentially in one process.
  // Keep the harness alive while the previous native owner is destroyed.
  app.on('window-all-closed', () => {});
  const report = {
    root,
    syntheticOnly: true,
    windowShown: false,
    screenshotTaken: false,
    hardwareAcceleration: false,
    networkRequests: 0,
    checks: {},
    scenarios: [],
    errors: []
  };
  let current = null;
  const channels = [];
  const flushState = (event) => {trusted(event);event.returnValue={ok:true};};
  const flushMusic = (event) => {trusted(event);event.returnValue={saved:true};};
  const check = (name, passed) => {
    report.checks[name] = passed === true;
    if (!passed) throw new Error('Dashboard startup check failed: ' + name);
  };
  async function waitFor(predicate, label, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Dashboard startup check timed out: ' + label);
  }
  const dashboardURL = pathToFileURL(path.join(root, 'ui/dashboard.html')).href;
  function trusted(event) {
    if (event.sender !== current?.window.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== dashboardURL) {
      throw new Error('Dashboard readiness requires its local main frame');
    }
  }
  function register(channel, callback) {
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      trusted(event);
      return callback(event, ...args);
    });
  }
  try {
    await app.whenReady();
    session.defaultSession.setPermissionRequestHandler((_web, _permission, reply) => reply(false));
    session.defaultSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']}, (_details, reply) => {
      report.networkRequests++;
      reply({cancel: true});
    });
    const settings = require(path.join(root, 'src/settings.cjs')).sanitize({
      interfaceTheme: 'electric-purple', dashboardGlass: true, dashboardOpacity: .76
    });
    const emptySnapshot = {
      sessions: [], projects: [], dailyUsage: [], totals: {}, today: {},
      diagnostics: {loading: false, progress: 1}, settings, processes: []
    };
    register('pulse:settings', () => settings);
    register('pulse:dashboard-state', () => {
      current.stateReads++;
      if (current.rejectFirstState && current.stateReads === 1) throw new Error('Synthetic workspace read failure');
      return null;
    });
    register('pulse:snapshot', () => emptySnapshot);
    register('pulse:save-dashboard-state', () => ({ok: true}));
    ipcMain.on('pulse:flush-dashboard-state', flushState);
    ipcMain.on('pulse:flush-music-playback', flushMusic);
    register('pulse:anime', () => ({ok: true}));
    register('pulse:movies', () => ({ok: true}));
    register('pulse:music', (_event, action) => {
      current.musicActions.push(action);
      if (action === 'bootstrap') return {state: 'signedOut', profile: null, selected: 'netease', verification: 'none'};
      if (action === 'home') return {songs: [], playlists: [], cards: [], recent: [], recommendationMode: 'public'};
      if (action === 'deck') return {cards: []};
      if (action === 'discovery') return {songs: []};
      if (action === 'playbackState') return {state: null};
      if (action === 'providerState') return {provider: 'netease', profile: null, apiConnected: false};
      if (action === 'visualSettings') return {settings: {}};
      if (action === 'sourceOptions') return {sources: []};
      if (['nowPlaying', 'deactivate', 'cancelQR', 'stopAudio'].includes(action)) return {ok: true};
      throw new Error('Unexpected synthetic music action: ' + action);
    });
    register('pulse:dashboard-ready', () => {
      current.handshakes++;
      return current.readiness.markRendererReady() === true;
    });
    const {attachDashboardReadiness} = require(path.join(root, 'src/dashboard-readiness.cjs'));
    const {attachDashboardShape} = require(path.join(root, 'src/dashboard-shape.cjs'));
    const {attachSurfaceRecovery} = require(path.join(root, 'src/surface-recovery.cjs'));

    async function scenario(name, rejectFirstState) {
      const state = {name, rejectFirstState, stateReads: 0, handshakes: 0, readyCount: 0, reloads: 0, navigationCount: 0, musicActions: [], consoleErrors: []};
      const window = new BrowserWindow({
        title: 'Sonara hidden synthetic startup check', width: 1260, height: 850,
        frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000', show: false,
        webPreferences: {
          preload: path.join(root, 'src/preload.cjs'), contextIsolation: true,
          nodeIntegration: false, sandbox: true, webSecurity: true,
          spellcheck: false, backgroundThrottling: true
        }
      });
      state.window = window;
      current = state;
      const web = window.webContents;
      web.setWindowOpenHandler(() => ({action: 'deny'}));
      web.on('will-navigate', (event, url) => { if (url !== dashboardURL) event.preventDefault(); });
      web.on('will-attach-webview', event => event.preventDefault());
      web.on('console-message', details => {
        if (details.level === 'error' || details.level === 3) state.consoleErrors.push(String(details.message).slice(0, 300));
      });
      web.on('did-start-navigation', (_event, _url, sameDocument, mainFrame) => {
        if (mainFrame && !sameDocument) state.navigationCount++;
      });
      const shape = attachDashboardShape({window, screen});
      const recovery = attachSurfaceRecovery({window, onReload: () => state.reloads++, onError: error => report.errors.push(String(error.message))});
      const readiness = attachDashboardReadiness({
        window,
        onReady: () => { state.readyCount++; shape.update(true); },
        onLoading: () => window.hide(),
        onTimeout: () => recovery.recover('synthetic-startup-timeout'),
        onError: error => report.errors.push(String(error.message))
      });
      state.readiness = readiness;
      try {
        await window.loadFile(path.join(root, 'ui/dashboard.html'));
        web.invalidate();
        await waitFor(() => readiness.isReady(), name + ' first renderer handshake');
        check(name + '_actualRendererHandshake', state.handshakes === 1 && state.readyCount === 1);
        check(name + '_neverShown', !window.isVisible());
        const dom = await web.executeJavaScript(`({
          musicVisible: !document.getElementById('music-view').hidden && document.getElementById('monitor-view').hidden,
          navigationCount: document.querySelectorAll('.rail-navigation button').length,
          shellPresent: document.querySelector('.app-shell').children.length > 0,
          audioOwners: document.querySelectorAll('.music-player-root audio').length,
          musicPlayerCreated: !!document.querySelector('.music-player-root'),
          theme: document.documentElement.dataset.interfaceTheme
        })`);
        check(name + '_musicIsDefaultView', dom.musicVisible && dom.navigationCount === 5 && dom.shellPresent);
        check(name + '_syntheticThemeApplied', dom.theme === 'electric-purple');
        check(name + '_oneMusicPlayerOwner', dom.musicPlayerCreated && dom.audioOwners === 1);
        check(name + '_syntheticMusicBootstrap', state.musicActions.includes('bootstrap') && state.musicActions.includes('home'));
        check(name + '_nativeRoundedRegion', shape.getStatus().nativeRegion === true && shape.getStatus().borderSuppressed === true);
        const beforeNavigation = state.navigationCount;
        const beforeProcess = web.getOSProcessId();
        await web.executeJavaScript('window.__startupAudioOwner = document.querySelector(".music-player-root audio")');
        web.send('pulse:dashboard-visibility', {visible: false});
        web.send('pulse:dashboard-visibility', {visible: true});
        readiness.repaint();
        await new Promise(resolve => setTimeout(resolve, 150));
        check(name + '_visibilityDoesNotReload', state.navigationCount === beforeNavigation && web.getOSProcessId() === beforeProcess && readiness.isReady());
        check(name + '_visibilityRetainsAudioOwner', await web.executeJavaScript('window.__startupAudioOwner === document.querySelector(".music-player-root audio") && document.querySelectorAll(".music-player-root audio").length === 1'));
        if (!rejectFirstState) {
          web.forcefullyCrashRenderer();
          await waitFor(() => state.readyCount === 2 && readiness.isReady(), name + ' crashed renderer recovery');
          check(name + '_crashRequiresFreshHandshake', state.handshakes === 2 && state.navigationCount > beforeNavigation);
          check(name + '_singleBoundedReload', state.reloads === 1 && recovery.getStatus().attempts === 1);
          check(name + '_recoveryStaysHidden', !window.isVisible());
        } else {
          check(name + '_stateFailureFallsBackWithoutReload', state.reloads === 0 && state.stateReads === 1);
        }
      } finally {
        report.scenarios.push({
          name, handshakes: state.handshakes, readyCount: state.readyCount,
          reloads: state.reloads, navigationCount: state.navigationCount, stateReads:state.stateReads,
          musicActions: state.musicActions,
          url:web.isDestroyed()?null:web.getURL(),
          shape: shape.getStatus(), readiness: readiness.getStatus(),
          consoleErrors: state.consoleErrors
        });
        readiness.dispose();
        recovery.dispose();
        shape.dispose();
        if (!window.isDestroyed()) window.destroy();
        current = null;
      }
    }
    await scenario('normal', false);
    await scenario('workspaceFailure', true);
    check('noRemoteNetwork', report.networkRequests === 0);
    check('noLeakedWindows', BrowserWindow.getAllWindows().length === 0);
    check('noControllerErrors', report.errors.length === 0);
  } catch (error) {
    report.errors.push(String(error.stack || error));
    process.exitCode = 1;
  } finally {
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.removeListener('pulse:flush-dashboard-state', flushState);
    ipcMain.removeListener('pulse:flush-music-playback', flushMusic);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    fs.writeFileSync(path.join(output, 'startup-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({checks: Object.keys(report.checks).length, failed: Object.keys(report.checks).filter(key => !report.checks[key]), errors: report.errors, output}));
    app.exit(process.exitCode || 0);
  }
}

if (process.argv.includes('--startup-child')) {
  child().catch(error => { console.error(error.stack); require('electron').app.exit(1); });
} else {
  const environment = {...process.env};
  delete environment.ELECTRON_RUN_AS_NODE;
  const processChild = spawn(require('electron'), [__filename, '--startup-child', '--root', root, '--output', output], {
    cwd: workspace, env: environment, windowsHide: true, stdio: 'inherit'
  });
  const timeout = setTimeout(() => { processChild.kill(); process.exitCode = 1; }, 60000);
  processChild.on('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
  processChild.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1; });
}
