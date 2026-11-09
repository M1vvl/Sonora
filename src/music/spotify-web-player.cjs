'use strict';

const {trustedURL, panelBounds} = require('./platform-login.cjs');
const ORIGIN = 'https://open.spotify.com';
const PARTITION = 'persist:agent-pulse-spotify-official';

function playerURL(path = '/') {
  if (typeof path !== 'string' || path.length > 800) throw new Error('无效的 Spotify 页面');
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash ||
      !/^\/(?:collection\/(?:tracks|playlists|albums)|search(?:\/[^/]+)?)?\/?$/.test(url.pathname)) {
    throw new Error('无效的 Spotify 页面');
  }
  return url.href;
}

// Keep official website data in its own browser session. The native view renders
// Spotify's recommendations/library; protected audio uses the supported system
// browser, because the shipped Electron runtime has no Widevine CDM.
function createSpotifyWebPlayer({electron, getHostWindow, getOfficialSession, observeProfile = () => () => {}}) {
  let owner = null, records = [], visible = false, bounds = null, disposed = false, requestedPath = null;
  function detach(record) {try {owner?.contentView.removeChildView(record.view);} catch {}}
  function attach() {
    for (const record of records) detach(record);
    const last = records.at(-1);
    if (visible && owner && !owner.isDestroyed() && last && !last.view.webContents.isDestroyed()) {
      owner.contentView.addChildView(last.view);
      last.view.setBounds(bounds);
    }
  }
  function hide() {visible = false; attach();}
  function release() {
    visible = false;
    const previous = records; records = [];
    for (const record of previous) {
      detach(record); record.unobserve?.();
      if (!record.view.webContents.isDestroyed()) record.view.webContents.close();
    }
    if (owner) {
      owner.removeListener('closed', release);
      owner.removeListener('hide', hide);
      owner.removeListener('resize', resized);
    }
    owner = null; requestedPath = null;
  }
  function resized() {
    if (!owner || owner.isDestroyed() || !bounds) return;
    try {bounds = panelBounds(bounds, owner); attach();} catch {hide();}
  }
  function makeView(preferences = {}) {
    const view = new electron.WebContentsView({webPreferences: {
      ...preferences,
      session: getOfficialSession ? getOfficialSession('spotify') : electron.session.fromPartition(PARTITION, {cache: false}),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false, preload: undefined,
      backgroundThrottling: true, autoplayPolicy: 'user-gesture-required'
    }});
    view.setBackgroundColor('#121212');
    const web = view.webContents, record = {view, unobserve: null};
    records.push(record);
    const navigate = (event, url) => {if (!trustedURL('spotify', url)) event.preventDefault();};
    web.on('will-navigate', navigate); web.on('will-redirect', navigate);
    web.on('will-attach-webview', event => event.preventDefault());
    web.setWindowOpenHandler(({url}) => {
      const blank = (url === '' || url === 'about:blank') && trustedURL('spotify', web.getURL());
      if ((!blank && !trustedURL('spotify', url)) || records.length >= 3 || disposed) return {action: 'deny'};
      return {action: 'allow', outlivesOpener: true, createWindow(options) {
        if (disposed || !owner || owner.isDestroyed()) return undefined;
        const child = makeView(options.webPreferences); attach();
        return child.webContents;
      }};
    });
    web.on('destroyed', () => {
      record.unobserve?.(); detach(record);
      records = records.filter(item => item !== record); attach();
    });
    record.unobserve = observeProfile(web);
    return view;
  }
  async function request(payload = {}) {
    if (disposed) throw new Error('Spotify 播放器已关闭');
    if (payload.provider !== 'spotify') throw new Error('无效的官方播放器');
    if (payload.action === 'browser') {
      let url = playerURL(payload.path);
      // Preserve a playlist/album the listener chose inside the official page.
      // Drop query parameters; only public Spotify content IDs may leave here.
      try {
        const current = new URL(records[0]?.view.webContents.getURL());
        if (current.origin === ORIGIN) {
          if (/^\/(?:playlist|album|artist|track)\/[a-zA-Z0-9]{22}\/?$/.test(current.pathname)) url = current.origin + current.pathname;
          else try {url = playerURL(current.pathname);} catch {}
        }
      } catch {}
      await electron.shell.openExternal(url);
      return {opened: true, playback: 'official-browser'};
    }
    if (payload.visible !== true) {hide(); return {visible: false};}
    const nextOwner = getHostWindow?.();
    if (!nextOwner || nextOwner.isDestroyed()) throw new Error('音乐面板尚未打开');
    const nextBounds = panelBounds(payload.bounds, nextOwner);
    const target = payload.path === undefined ? null : playerURL(payload.path);
    if (owner !== nextOwner) {
      release(); owner = nextOwner;
      owner.on('closed', release); owner.on('hide', hide); owner.on('resize', resized);
    }
    bounds = nextBounds; visible = true;
    const initial = records.length === 0;
    const view = records[0]?.view || makeView();
    attach();
    // Visibility is committed before navigation. A later hide must always win
    // when an earlier load finishes (switching pages or opening the account).
    if (initial || target && (target !== requestedPath || payload.navigate === true)) {
      requestedPath = target || ORIGIN + '/';
      view.webContents.loadURL(target || ORIGIN + '/').catch(() => {});
    }
    return {visible: true, officialWeb: true, playback: 'official-browser', embeddedAudio: false};
  }
  return {request, hide, release, dispose() {if (disposed) return; disposed = true; release();}};
}

module.exports = {createSpotifyWebPlayer, playerURL, PARTITION};
