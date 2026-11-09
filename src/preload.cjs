const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = (channel) => (listener) => {
  if (typeof listener !== 'function') return () => {};
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('pulse', Object.freeze({
  getSnapshot: invoke('pulse:snapshot'),
  refresh: invoke('pulse:refresh'),
  getSettings: invoke('pulse:settings'),
  accountLocation: invoke('pulse:account-location'),
  appUpdate: invoke('pulse:app-update'),
  saveSettings: invoke('pulse:save-settings'),
  getDashboardState: invoke('pulse:dashboard-state'),
  saveDashboardState: invoke('pulse:save-dashboard-state'),
  flushDashboardState: value => ipcRenderer.sendSync('pulse:flush-dashboard-state',value),
  toggleIsland: invoke('pulse:toggle-island'),
  setIslandExpanded: invoke('pulse:expand-island'),
  moveIsland: invoke('pulse:move-island'),
  islandInteraction: invoke('pulse:island-interaction'),
  islandMusicCommand: invoke('pulse:island-music-command'),
  onMusicControl: subscribe('pulse:music-control'),
  completeMusicControl: invoke('pulse:music-control-result'),
  moveDashboard: invoke('pulse:move-dashboard'),
  openDashboard: invoke('pulse:dashboard'),
  windowAction: invoke('pulse:window-action'),
  exportSession: invoke('pulse:export'),
  openExternal: invoke('pulse:external'),
  animeRequest: invoke('pulse:anime'),
  moviesRequest: invoke('pulse:movies'),
  musicRequest: invoke('pulse:music'),
  flushMusicPlayback: value => ipcRenderer.sendSync('pulse:flush-music-playback',value),
  onMusicStatus: subscribe('pulse:music-update'),
  onDashboardVisibility: subscribe('pulse:dashboard-visibility'),
  onDashboardFullscreen: subscribe('pulse:dashboard-fullscreen'),
  dashboardReady: invoke('pulse:dashboard-ready'),
  onDashboardMaterial: subscribe('pulse:dashboard-material'),
  onDashboardShape: subscribe('pulse:dashboard-shape'),
  onMoviesHistory: subscribe('pulse:movies-history-update'),
  onAnimeHistory: subscribe('pulse:anime-history-update'),
  onSnapshot: subscribe('pulse:snapshot-update'),
  onSettings: subscribe('pulse:settings-update'),
  onAudioFrame: subscribe('pulse:audio-frame'),
  onMediaUpdate: subscribe('pulse:media-update'),
  onRefractionFrame: subscribe('pulse:refraction-frame')
}));
