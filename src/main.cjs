const electron = require('electron');
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, nativeTheme, screen, dialog, shell, session, protocol } = electron;
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { attachSurfaceRecovery } = require('./surface-recovery.cjs');
const { createSettings } = require('./settings.cjs');
const { createDashboardState } = require('./dashboard-state.cjs');
const { detectProcesses } = require('./processes.cjs');
const { createMonitor } = require('./monitor.cjs');
const { loadProjects } = require('./projects.cjs');
// The migrated Veyra engine owns optical material; keep Electron's per-pixel canvas.
const useNativeGlass=()=>false,applyMaterial=()=> 'css',getMaterialDiagnostics=()=>({backend:'veyra-d3d11'});
const { createAudioMonitor } = require('./audio/index.cjs');
const { createMediaMonitor } = require('./media/index.cjs');
const { createMediaSelection } = require('./media-selection.cjs');
const { createMediaLyrics } = require('./media-lyrics.cjs');
const { createIslandAutoHide } = require('./island-autohide.cjs');
const { createLiquidGlass } = require('./liquid-glass.cjs');
const { forIsland } = require('./snapshots.cjs');
const { ISLAND_COMPACT, ISLAND_EXPANDED } = require('./window-layout.cjs');

const ROOT = path.join(__dirname, '..');
const smoke = process.argv.includes('--smoke-test');
protocol.registerSchemesAsPrivileged(['pulse-anime-image','pulse-movie-image','pulse-music-image','pulse-music-audio','pulse-visual-media'].map(scheme=>({scheme,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:scheme.startsWith('pulse-music-')||scheme==='pulse-visual-media',stream:scheme==='pulse-music-audio'||scheme==='pulse-visual-media'}})));
// Keep the established encrypted sessions and preferences across the rename.
const profileDirectory=smoke?path.join(os.tmpdir(),'agent-pulse-smoke-profile'):path.join(app.getPath('appData'),'Agent Pulse');
fs.mkdirSync(profileDirectory,{recursive:true});
app.setPath('userData',profileDirectory);
const accountLocation = require('./music/account-location.cjs').createAccountLocation(profileDirectory);
const appUpdates = require('./app-updates.cjs').createAppUpdates({app,profileDirectory,fetchImpl:(...args)=>electron.net.fetch(...args)});
app.setName('Sonara');
app.setAppUserModelId('local.agentpulse.desktop');
let dashboard, island, tray, monitor, store, dashboardStore, processTimer, processScanPromise;
let dashboardReadiness = null, dashboardRequested = false;
let dashboardDrag = null;
let processes = [], quitting = false, expanded = false, moveTimer, lastError = null;
const rendererErrors = [];
const allowedPages = new Set(['dashboard.html', 'island.html'].map((name) => pathToFileURL(path.join(ROOT, 'ui', name)).href));
const allowedExternal = new Set(['learn.chatgpt.com', 'developers.openai.com', 'platform.openai.com', 'docs.anthropic.com', 'platform.claude.com', 'github.com']);
let pricing = null, material = 'css';
let islandUsesNative = false;
let audio, media, mediaSelection, mediaLyrics, islandAutoHide, refraction, trayKey = '';
const emptyMediaLines=Object.freeze([]);
let mediaLinesReference=null,mediaTrackKey='';
let animeBridge,moviesBridge,musicBridge,playback;
let animeShutdownPending=false,animeShutdownComplete=false;
function logError(error) {
  lastError = String(error?.message || error);
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'errors.log'), `${new Date().toISOString()} ${lastError}\n`); } catch {}
  console.error(lastError);
}
process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

function snapshot(usage) {
  const data = usage || monitor?.getSnapshot() || { sessions: [], totals: {}, today: {}, diagnostics: { scanning: true } };
  return { ...data, processes, settings: store.get(), material, materialDiagnostics: getMaterialDiagnostics(island), refraction: refraction?.getStatus(), audio: audio?.getStatus(), pricing, version: app.getVersion(), lastError };
}
function broadcast(usage) {
  if (!store) return;
  const data = snapshot(usage);
  if (dashboard && !dashboard.isDestroyed() && (smoke || dashboard.isVisible()) && !dashboard.webContents.isLoading()) dashboard.webContents.send('pulse:snapshot-update', data);
  if (island && !island.isDestroyed() && (smoke || island.isVisible()) && !island.webContents.isLoading()) island.webContents.send('pulse:snapshot-update', forIsland(data));
  updateTray(data);
}
function syncDesktopEffects() {
  const settings = store?.get();
  audio?.configure({ enabled: !smoke && settings?.musicReactive !== false && settings?.islandEnabled === true && Boolean(island && !island.isDestroyed() && island.isVisible()), mode: settings?.audioSourceMode });
  media?.configure({ enabled: !smoke && settings?.musicCover !== false && settings?.islandEnabled === true && Boolean(island && !island.isDestroyed() && island.isVisible()) });
  mediaSelection?.configure(!smoke && settings?.musicCover !== false && settings?.islandEnabled === true && Boolean(island && !island.isDestroyed() && island.isVisible()));
  refraction?.sync();
}
function sendMediaUpdate(value) {
  if (island && !island.isDestroyed() && island.isVisible() && !island.webContents.isLoading()) {
    mediaLyrics?.update(value);
    const lines=value?.source==='agentpulse'?value.lines||emptyMediaLines:mediaLyrics?.getLines(value?.trackKey)||emptyMediaLines;
    const changed=mediaLinesReference!==lines||mediaTrackKey!==value?.trackKey;
    mediaLinesReference=lines;mediaTrackKey=value?.trackKey;
    const packet={...value,rotationMode:store.get().musicCoverMotion};delete packet.lines;
    if(changed)packet.lines=lines;
    island.webContents.send('pulse:media-update',packet);
  }
}
function sendAudioFrame(frame) {
  if (island && !island.isDestroyed() && island.isVisible() && !island.webContents.isLoading()) island.webContents.send('pulse:audio-frame', frame);
}
function secureWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!allowedPages.has(url)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 3) rendererErrors.push(String(details.message).slice(0, 500));
  });
  win.webContents.on('render-process-gone', (_event, details) => logError(`Renderer stopped: ${details.reason}`));
  win.webContents.on('did-finish-load', () => { broadcast(); if (win === island && audio) sendAudioFrame(audio.getStatus()); if (win === island && mediaSelection) {mediaLinesReference=null;sendMediaUpdate(mediaSelection.getStatus());} });
}
function webPreferences() {
  return { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, backgroundThrottling: !smoke, devTools: !app.isPackaged || smoke };
}
function createDashboard() {
  dashboard = new BrowserWindow({
    title: 'Sonara', width: 1260, height: 850, minWidth: 960, minHeight: 660,
    frame: false, transparent:true, hasShadow:false, backgroundColor: '#00000000', show: false, autoHideMenuBar: true,
    icon: path.join(ROOT, 'assets', 'icon.png'), webPreferences: webPreferences()
  });
  secureWindow(dashboard);
  require('./dashboard-fullscreen.cjs').attachDashboardFullscreen(dashboard);
  const ownedDashboard=dashboard;
  const sendShape=status=>{if(!ownedDashboard.isDestroyed()&&!ownedDashboard.webContents.isLoading())ownedDashboard.webContents.send('pulse:dashboard-shape',status);};
  const shape=require('./dashboard-shape.cjs').attachDashboardShape({window:ownedDashboard,screen,onGeometry:sendShape});
  const recovery=attachSurfaceRecovery({window:ownedDashboard,isEnabled:()=>!quitting&&dashboard===ownedDashboard,onError:logError});
  dashboardReadiness=require('./dashboard-readiness.cjs').attachDashboardReadiness({
    window:ownedDashboard,onError:logError,
    onLoading:()=>{
      if(dashboard!==ownedDashboard)return;
      if(ownedDashboard.isVisible())dashboardRequested=true;
      ownedDashboard.hide();
    },
    onTimeout:()=>recovery.recover('dashboard-initialization-timeout'),
    onReady:()=>{
      if(dashboard!==ownedDashboard)return;
      shape.update(true);
      applyDashboardMaterial();
      if(!smoke&&(dashboardRequested||!process.argv.includes('--island-only')))revealDashboard();
    }
  });
  ownedDashboard.webContents.on('did-finish-load',()=>{sendShape(shape.getStatus());applyDashboardMaterial();});
  ownedDashboard.on('closed', () => { if(dashboard===ownedDashboard){dashboard=null;dashboardReadiness=null;dashboardDrag=null;} });
  require('./dashboard-lifecycle.cjs').attachDashboardLifecycle({
    window:dashboard,isQuitting:()=>quitting,hasPlayback:()=>musicBridge?.hasPlayback()===true,
    onBackground:()=>musicBridge?.background(),onClose:()=>musicBridge?.cancel(),
    onVideoClose:()=>playback?.close().catch(logError),
    onVisibility:visible=>{if(!ownedDashboard.isDestroyed())ownedDashboard.webContents.send('pulse:dashboard-visibility',{visible});}
  });
  dashboard.on('blur', () => { dashboardDrag = null; });
  dashboard.on('resize', () => { dashboardDrag = null; });
  dashboard.on('show', () => broadcast());
  applyDashboardMaterial();
  // All readiness and recovery listeners must exist before navigation starts.
  ownedDashboard.loadFile(path.join(ROOT,'ui','dashboard.html')).catch(error=>{logError(error);recovery.recover('dashboard-load-file');});
  return dashboard;
}
function applyDashboardMaterial() {
  if(!dashboard||dashboard.isDestroyed())return;
  const status={requested:store.get().dashboardGlass===true,backend:'veyra-d3d11',nativeConfigured:true};
  refraction?.sync();
  if(!dashboard.webContents.isLoading())dashboard.webContents.send('pulse:dashboard-material',status);
}
function openDashboard() {
  // A second shortcut launch can arrive before settings and IPC are ready.
  dashboardRequested = true;
  if (!store) return;
  if (!dashboard || dashboard.isDestroyed()) createDashboard();
  if (dashboardReadiness?.isReady()) revealDashboard();
}
function revealDashboard() {
  if(!dashboard||dashboard.isDestroyed()||!dashboardReadiness?.isReady())return;
  if (dashboard.isMinimized()) dashboard.restore();
  dashboard.show(); dashboardReadiness.repaint(); dashboard.focus();
  dashboardRequested = false;
}
function clampPosition(x, y, width, height) {
  const area = screen.getDisplayNearestPoint({ x: Math.round(x + width / 2), y: Math.round(y + height / 2) }).workArea;
  return { x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))) };
}
function islandBounds() {
  const { width, height } = expanded ? ISLAND_EXPANDED : ISLAND_COMPACT;
  const saved = store.get().islandPosition;
  const area = screen.getPrimaryDisplay().workArea;
  const position = saved || { x: area.x + (area.width - width) / 2, y: area.y + 10 };
  const display = screen.getDisplayNearestPoint({ x: Math.round(position.x + width / 2), y: Math.round(position.y + height / 2) });
  return { ...clampPosition(display.bounds.x + (display.bounds.width - width) / 2, display.workArea.y + 10, width, height), width, height };
}
function createIsland() {
  if (island && !island.isDestroyed()) return;
  islandUsesNative = useNativeGlass(store.get());
  island = new BrowserWindow({
    title: 'Sonara Island', ...islandBounds(), transparent: !islandUsesNative, frame: false, thickFrame: false,
    resizable: false, maximizable: false, minimizable: false, skipTaskbar: true,
    alwaysOnTop: store.get().alwaysOnTop, hasShadow: false, backgroundColor: '#00000000',
    show: false, webPreferences: webPreferences()
  });
  secureWindow(island);
  const ownedIsland=island;
  const recovery=attachSurfaceRecovery({window:ownedIsland,isEnabled:()=>!quitting&&island===ownedIsland&&store.get().islandEnabled,onError:logError,onReload:()=>{if(!ownedIsland.isDestroyed()){material=applyMaterial(ownedIsland,store.get(),expanded);if(!smoke)ownedIsland.showInactive();islandAutoHide?.configure();syncDesktopEffects();}}});
  ownedIsland.on('hide',()=>{if(!store.get().islandEnabled)recovery.cancel();});
  material = applyMaterial(island, store.get(), expanded);
  if (islandUsesNative && material !== 'blur') { island.destroy(); island = null; createIsland(); return; }
  island.setAlwaysOnTop(store.get().alwaysOnTop, 'floating');
  island.loadFile(path.join(ROOT, 'ui', 'island.html'));
  island.once('ready-to-show', () => { material = applyMaterial(island, store.get(), expanded); if (!smoke && store.get().islandEnabled) island.showInactive(); islandAutoHide?.configure(); });
  island.on('show', () => { material = applyMaterial(island, store.get(), expanded); syncDesktopEffects(); if (mediaSelection) sendMediaUpdate(mediaSelection.getStatus()); });
  island.on('hide', syncDesktopEffects);
  island.on('move', () => {
    if (quitting || store.get().islandAutoHide) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (island && !island.isDestroyed() && !store.get().islandAutoHide) { const [x, y] = island.getPosition(); const [width] = island.getSize(); store.save({ islandPosition: { x: x + (width - ISLAND_COMPACT.width) / 2, y } }); }
    }, 400);
  });
  island.on('closed', () => { island = null; expanded = false; syncDesktopEffects(); });
}
function reconcileMaterial() {
  if (!store || !island || island.isDestroyed()) return;
  if (islandUsesNative !== useNativeGlass(store.get())) { island.destroy(); createIsland(); }
}
function setExpanded(value) {
  expanded = !!value;
  if (!island || island.isDestroyed()) return;
  const previous = island.getBounds();
  const { width, height } = expanded ? ISLAND_EXPANDED : ISLAND_COMPACT;
  const next = clampPosition(previous.x + (previous.width - width) / 2, previous.y, width, height);
  island.setBounds({ ...next, width, height });
  material = applyMaterial(island, store.get(), expanded);
  islandAutoHide?.configure();
}
function setIsland(enabled) {
  store.save({ islandEnabled: !!enabled });
  if (enabled) { createIsland(); if (!smoke) island.showInactive(); }
  else if (island && !island.isDestroyed()) island.hide();
  settingsChanged();
  return store.get();
}
function settingsChanged() {
  const settings = store.get();
  islandAutoHide?.configure();
  for (const win of [dashboard, island]) if (win && !win.isDestroyed()) win.webContents.send('pulse:settings-update', settings);
  syncDesktopEffects();
  if (mediaSelection) sendMediaUpdate(mediaSelection.getStatus());
  broadcast();
}
function updateTray(usage) {
  if (!tray || !store) return;
  const data = usage || monitor?.getSnapshot();
  const count = data?.sessions?.filter((s) => s.status === 'working').length || 0;
  const key = `${count}:${store.get().islandEnabled}`;
  if (key === trayKey) return;
  trayKey = key;
  tray.setToolTip(`Sonara · ${count} 个工作会话 · 本地监控`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开软件界面', click: openDashboard },
    { label: '显示灵动岛', type: 'checkbox', checked: store.get().islandEnabled, click: (item) => setIsland(item.checked) },
    { label: '重置灵动岛位置', click: () => { store.save({ islandPosition: null }); expanded = false; if (island) { island.setBounds(islandBounds()); material = applyMaterial(island, store.get(), expanded); island.webContents.reload(); } } },
    { type: 'separator' },
    { label: '退出 Sonara', click: () => { quitting = true; app.quit(); } }
  ]));
}
function trusted(event) {
  const url = event.senderFrame?.url;
  if (!allowedPages.has(url)) throw new Error('Untrusted caller');
}
function register(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => { trusted(event); return callback(event, ...args); });
}
function startMonitor() {
  monitor?.stop();
  const localProjects = loadProjects();
  monitor = createMonitor({ pollIntervalMs: store.get().pollIntervalMs, projects: localProjects.projects,
    projectAssignments: localProjects.assignments, cachePath: path.join(app.getPath('userData'), 'history-cache.json'), onUpdate: broadcast });
  monitor.start().catch(logError);
}
function scanProcesses() {
  reconcileMaterial();
  if (processScanPromise) return processScanPromise;
  processScanPromise = detectProcesses().then((result) => { processes = result; broadcast(); }).finally(() => { processScanPromise = null; });
  return processScanPromise;
}
function registerIPC() {
  ipcMain.on('pulse:liquid-glass-presented',(event,value)=>{if(allowedPages.has(event.senderFrame?.url))refraction?.presented(event.sender,value);});
  register('pulse:dashboard-ready',event=>{
    if(event.sender!==dashboard?.webContents||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==pathToFileURL(path.join(ROOT,'ui/dashboard.html')).href)throw new Error('Dashboard readiness requires its local main frame');
    return dashboardReadiness?.markRendererReady()===true;
  });
  register('pulse:snapshot', event => { const data = snapshot(); return event.sender === island?.webContents ? forIsland(data) : data; });
  register('pulse:settings', () => store.get());
  register('pulse:app-update', (event, action) => {
    if (event.sender !== dashboard?.webContents) throw new Error('Untrusted updater caller');
    return action === 'install' ? appUpdates.install() : appUpdates.check();
  });
  register('pulse:account-location', async (event, action) => {
    if (event.sender !== dashboard?.webContents) throw new Error('Untrusted account storage caller');
    if (action !== 'choose') return accountLocation.status();
    const result = await dialog.showOpenDialog(dashboard, {title: '选择私人账号保存文件夹', properties: ['openDirectory', 'createDirectory']});
    if (result.canceled || !result.filePaths[0]) return accountLocation.status();
    return accountLocation.select(result.filePaths[0], process.env.PORTABLE_EXECUTABLE_DIR || ROOT);
  });
  const dashboardState = (event, input, save=false) => {
    if(event.sender!==dashboard?.webContents||event.senderFrame?.url!==pathToFileURL(path.join(ROOT,'ui/dashboard.html')).href)throw new Error('Dashboard state requires the local panel');
    return save?dashboardStore.save(input):dashboardStore.get();
  };
  register('pulse:dashboard-state', event=>dashboardState(event));
  register('pulse:save-dashboard-state', (event,input)=>dashboardState(event,input,true));
  // Only the local panel uses this on beforeunload, so its final pending
  // changes reach disk before Electron destroys the renderer.
  ipcMain.on('pulse:flush-dashboard-state',(event,input)=>{
    try{trusted(event);event.returnValue=dashboardState(event,input,true);}
    catch(error){logError(error);event.returnValue={error:'面板状态保存失败'};}
  });
  register('pulse:refresh', async () => { const localProjects = loadProjects(); monitor.setProjects?.(localProjects.projects, localProjects.assignments); await Promise.all([monitor.refresh(), scanProcesses()]); broadcast(); return snapshot(); });
  register('pulse:save-settings', (_event, input) => {
    const previous = store.get();
    const next = store.save(input);
    if (previous.islandMaterial !== next.islandMaterial && island) { island.destroy(); createIsland(); }
    if (previous.launchAtLogin !== next.launchAtLogin && app.isPackaged && !smoke) app.setLoginItemSettings({ name:'Agent Pulse', openAtLogin: next.launchAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe') });
    if (island) { island.setAlwaysOnTop(next.alwaysOnTop, 'floating'); material = applyMaterial(island, next, expanded); }
    if (next.islandEnabled) { createIsland(); if (!smoke && (!next.islandAutoHide || !previous.islandEnabled)) island.showInactive(); } else island?.hide();
    if (previous.pollIntervalMs !== next.pollIntervalMs) startMonitor();
    applyDashboardMaterial();
    settingsChanged(); return next;
  });
  register('pulse:toggle-island', (_event, value) => setIsland(typeof value === 'boolean' ? value : !store.get().islandEnabled));
  register('pulse:expand-island', (_event, value) => setExpanded(value));
  register('pulse:island-interaction', (event, gesture) => {
    if(event.sender!==island?.webContents)return {accepted:false};
    if(gesture?.type==='drag-start')islandAutoHide?.beginDrag();
    else if(gesture?.type==='drag-end')return {changed:islandAutoHide?.endDrag(gesture)};
    else if(gesture?.type==='hold')islandAutoHide?.hold(gesture.value);
    return {accepted:true};
  });
  register('pulse:island-music-command', async(event,action,position)=>{
    if(event.sender!==island?.webContents||!['toggle','previous','next','seek'].includes(action))return {error:'无效的播放控制'};
    const selected=mediaSelection?.getStatus();
    if(!selected?.available)return {error:'当前没有可控制的音乐'};
    if(selected.source==='agentpulse')return musicBridge.control(action,{songId:selected.id,position});
    return media.control(action,{source:selected.source,trackKey:selected.trackKey,position});
  });
  register('pulse:move-island', () => ({ accepted: false, reason: 'top-edge-fixed' }));
  register('pulse:move-dashboard', (event, gesture) => {
    if (!dashboard || dashboard.isDestroyed() || event.sender !== dashboard.webContents) return { accepted: false };
    if (gesture?.phase === 'end') { dashboardDrag = null; return { accepted: true }; }
    if (gesture?.phase === 'begin') {
      dashboardDrag = dashboard.isMaximized() ? null : dashboard.getBounds();
      return { accepted: Boolean(dashboardDrag) };
    }
    if (gesture?.phase !== 'move' || !dashboardDrag || !Number.isFinite(gesture.deltaX) || !Number.isFinite(gesture.deltaY)) return { accepted: false };
    const bounds = dashboardDrag;
    const x = bounds.x + Math.round(Math.max(-10000, Math.min(10000, gesture.deltaX)));
    const y = bounds.y + Math.round(Math.max(-10000, Math.min(10000, gesture.deltaY)));
    // Keep enough of the window on the nearest work area to grab it again.
    const area = screen.getDisplayNearestPoint({x: x + Math.round(bounds.width / 2), y: y + 32}).workArea;
    dashboard.setPosition(Math.max(area.x - bounds.width + 96, Math.min(x, area.x + area.width - 96)), Math.max(area.y, Math.min(y, area.y + area.height - 48)));
    return { accepted: true };
  });
  register('pulse:dashboard', openDashboard);
  register('pulse:window-action', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (action === 'minimize') win?.minimize();
    else if (action === 'hide' || action === 'close') { if (win === island) setIsland(false); else win?.close(); }
    else if (action === 'fullscreen' && win === dashboard) { const target=!win.isFullScreen();win.setFullScreen(target);return {fullscreen:target}; }
    else if (action === 'exit-fullscreen' && win === dashboard) { win.setFullScreen(false);return {fullscreen:false}; }
    else if (action === 'is-fullscreen' && win === dashboard) return {fullscreen:win.isFullScreen()};
    else if (action === 'maximize' && win === dashboard) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  });
  register('pulse:external', async (_event, value) => {
    if (typeof value !== 'string') return false;
    let url; try { url = new URL(value); } catch { return false; }
    if (url.protocol !== 'https:' || !allowedExternal.has(url.hostname) || url.username || url.password) return false;
    await shell.openExternal(url.href); return true;
  });
  register('pulse:export', async (_event, id) => {
    const selected = typeof id === 'string' ? monitor.getSession(id) : null;
    const payload = selected || snapshot();
    const result = await dialog.showSaveDialog(dashboard, { title: '导出本地会话用量', defaultPath: `agent-pulse-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), billingNote: 'API-equivalent estimate only; not a Plus invoice. Text previews can contain project information.', data: payload }, null, 2), 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
}


if (!smoke && !app.requestSingleInstanceLock()) app.quit();
else if (process.argv.includes('--quit-for-update')) app.quit();
else {
  app.on('second-instance', (_event, argv) => { if (argv.includes('--quit-for-update')) app.quit(); else openDashboard(); });
  app.whenReady().then(async () => {
    await accountLocation.initialize();
    nativeTheme.themeSource = 'dark';
    nativeTheme.on('updated', () => { reconcileMaterial(); applyDashboardMaterial(); if (store) broadcast(); });
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    store = createSettings(path.join(app.getPath('userData'), 'settings.json'));
    dashboardStore = createDashboardState(path.join(app.getPath('userData'),'dashboard-state.json'));
    if (smoke) store.save({ islandEnabled: true, islandMaterial: 'acrylic' });
    try { pricing = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'pricing.json'), 'utf8')); } catch {}
    // A short-lived Wallpaper Engine lease can expose only our verified preview
    // HWND to the dashboard's main frame. All unrelated permissions stay denied.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(()=>false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file:|devtools:|data:|blob:|pulse-anime-image:|pulse-movie-image:|pulse-music-image:|pulse-music-audio:|pulse-visual-media:)/.test(details.url) }));
    Menu.setApplicationMenu(null);
    audio = createAudioMonitor({ executablePath: app.isPackaged ? path.join(process.resourcesPath, 'native/audio/AgentPulse.AudioProbe.exe') : path.join(ROOT, 'native/audio/bin/AgentPulse.AudioProbe.exe'), onFrame: sendAudioFrame });
    mediaSelection=createMediaSelection({loadCover:url=>musicBridge?.getArtwork(url),onUpdate:sendMediaUpdate});
    mediaLyrics=createMediaLyrics({lookup:value=>musicBridge.findMediaLyrics(value),onChange:()=>sendMediaUpdate(mediaSelection.getStatus())});
    media = createMediaMonitor({ executablePath: app.isPackaged ? path.join(process.resourcesPath, 'native/media/AgentPulse.MediaProbe.exe') : path.join(ROOT, 'native/media/bin/AgentPulse.MediaProbe.exe'), onUpdate:value=>mediaSelection.setNative(value) });
    refraction = createLiquidGlass({app,screen,getIsland:()=>island,getDashboard:()=>dashboard,getSettings:()=>store.get(),isExpanded:()=>expanded,onError:logError});
    if(!smoke)refraction.start();
    const playerDir=app.isPackaged?path.join(process.resourcesPath,'native/player'):path.join(ROOT,'native/player/resources');
    playback=require('./playback-coordinator.cjs').createPlaybackCoordinator({electron,root:ROOT,dataDir:path.join(app.getPath('userData'),'anime'),getTheme:()=>store.get().interfaceTheme,getHostWindow:()=>dashboard,
      nativeOptions:{executablePath:app.isPackaged?path.join(playerDir,'AgentPulse.Player.exe'):path.join(ROOT,'native/player/bin/AgentPulse.Player.exe'),libraryPath:path.join(playerDir,'libmpv-2.dll'),shaderDirectory:path.join(playerDir,'shaders')}});
    animeBridge = require('./anime-bridge.cjs').installAnimeBridge({ electron, root: ROOT, dataDir: path.join(app.getPath('userData'), 'anime'),playback,
      isDashboard: event => event.sender === dashboard?.webContents && event.senderFrame?.url === pathToFileURL(path.join(ROOT, 'ui/dashboard.html')).href,
      getTheme: () => store.get().interfaceTheme, getHostWindow:()=>dashboard, packaged: app.isPackaged, resourcesPath: process.resourcesPath });
    moviesBridge=require('./movies-bridge.cjs').installMoviesBridge({electron,root:ROOT,dataDir:path.join(app.getPath('userData'),'movies'),playback,getHostWindow:()=>dashboard,
      isDashboard:event=>event.sender===dashboard?.webContents&&event.senderFrame?.url===pathToFileURL(path.join(ROOT,'ui/dashboard.html')).href});
    musicBridge=require('./music-bridge.cjs').installMusicBridge({electron,dataDir:accountLocation.musicDirectory(),getOfficialSession:provider=>accountLocation.officialSession(session,provider),getHostWindow:()=>dashboard,onMediaState:value=>mediaSelection.setApp(value),
      isDashboard:event=>event.sender===dashboard?.webContents&&event.senderFrame?.url===pathToFileURL(path.join(ROOT,'ui/dashboard.html')).href});
    islandAutoHide=createIslandAutoHide({getWindow:()=>island,getSettings:()=>store.get(),saveSettings:value=>store.save(value),screen,isExpanded:()=>expanded,onSettingsChanged:settingsChanged,onVisibilityChanged:syncDesktopEffects,isSmoke:smoke});
    registerIPC(); if (smoke || dashboardRequested || !process.argv.includes('--island-only')) createDashboard(); createIsland();
    if (!smoke) {
      const image = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')).resize({ width: 20, height: 20 });
      tray = new Tray(image); tray.on('click', openDashboard); tray.on('double-click', openDashboard); updateTray();
    }
    startMonitor(); scanProcesses();
    const updateId=process.argv.find(value=>/^--update-id=[a-f0-9]{32}$/.test(value))?.slice(12);
    if(updateId){fs.mkdirSync(path.join(profileDirectory,'updates'),{recursive:true});fs.writeFileSync(path.join(profileDirectory,'updates','receipt-'+updateId+'.json'),JSON.stringify({version:app.getVersion()}));}
    processTimer = setInterval(scanProcesses, 10000);
    screen.on('display-removed', () => { if (island) { store.save({ islandPosition: null }); island.setBounds(islandBounds()); material = applyMaterial(island, store.get(), expanded);islandAutoHide?.configure(); } });
    screen.on('display-metrics-changed',()=>islandAutoHide?.configure());
    if(process.argv.includes('--runtime-check')){
      const proofWindow=island;
      const check=async()=>{try{
        const mounted=await proofWindow.webContents.executeJavaScript("Boolean(document.getElementById('island')?.getBoundingClientRect().width && document.getElementById('island-toggle'))");
        const pixels=(await proofWindow.webContents.capturePage()).toBitmap();let paintedPixels=0;
        for(let offset=3;offset<pixels.length;offset+=4)if(pixels[offset]>180)paintedPixels++;
        fs.writeFileSync(path.join(process.resourcesPath,'runtime-proof.json'),JSON.stringify({version:app.getVersion(),pid:process.pid,islandVisible:proofWindow.isVisible(),islandMounted:mounted,paintedPixels,bounds:proofWindow.getBounds(),checkedAt:new Date().toISOString()}));
      }catch(error){logError(error);}};
      proofWindow.webContents.once('did-finish-load',()=>setTimeout(check,500));
      if(!proofWindow.webContents.isLoading())setTimeout(check,500);
    }
    if (smoke) require('./diagnostics/smoke.cjs').runSmoke({app,ROOT,monitor,dashboard,island,animeBridge,scanProcesses,broadcast,rendererErrors,snapshot,getExpanded:()=>expanded,quit:code=>{quitting=true;app.exit(code);}}).catch((error) => { logError(error); app.exit(1); });
  }).catch((error) => { logError(error); app.exit(1); });
}
app.on('activate', () => { if (store) openDashboard(); });
app.on('before-quit', event => {
  quitting = true; islandAutoHide?.dispose(); refraction?.stop(); media?.stop(); mediaLyrics?.dispose(); mediaSelection?.dispose(); audio?.stop(); monitor?.stop(); clearInterval(processTimer); clearTimeout(moveTimer);
  if(animeBridge&&!animeShutdownComplete){event.preventDefault();if(!animeShutdownPending){animeShutdownPending=true;(async()=>{if(dashboard&&!dashboard.isDestroyed())await Promise.race([dashboard.webContents.executeJavaScript("typeof musicUI!=='undefined'&&musicUI?.flushPlayback?.()").catch(()=>{}),new Promise(resolve=>setTimeout(resolve,800))]);await playback?.dispose();await Promise.all([animeBridge.dispose(),moviesBridge?.dispose(),musicBridge?.dispose()]);})().catch(logError).finally(()=>{animeShutdownComplete=true;app.quit();});}}
});
app.on('window-all-closed', () => { if (!tray) app.quit(); });
