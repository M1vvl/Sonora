'use strict';

const crypto = require('node:crypto');
const LIFETIME_MS = 180000;
const IMAGE_LIMIT = 350000;

// The platform's own isolated page creates the challenge and processes its
// confirmation. Only its QR image crosses into our account panel. Credentials
// and the OAuth redirect remain in the app-owned, encrypted browser session.
const QR_IMAGE_SCRIPT = String.raw`(() => {
  const selectors = ['#qrlogin_img', 'img[id^="qrcodeImgEle_"]', 'img.qrcode', '.qrcode img', '#qrcode img'];
  for (const selector of selectors) {
    const image = document.querySelector(selector);
    if (!image || !image.complete || image.naturalWidth < 80 || image.naturalHeight < 80) continue;
    const rect = image.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 60) continue;
    if (/^data:image\/png;base64,/.test(image.src) && image.src.length < ${IMAGE_LIMIT}) return image.src;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(512, image.naturalWidth);
    canvas.height = Math.min(512, image.naturalHeight);
    try {
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const value = canvas.toDataURL('image/png');
      if (value.length < ${IMAGE_LIMIT}) return value;
    } catch {}
  }
  return null;
})()`;

function createPlatformQR({electron, network, provider, entryURL, trustedURL, activateLogin, hasCredentials, hasSession = async () => false, verify, onConfirmed = () => {}, now = Date.now}) {
  let challenge = null;
  let generation = 0;
  let disposed = false;

  function cancel() {
    generation++;
    const previous = challenge;
    challenge = null;
    if (previous) {
      clearTimeout(previous.expiry);
      if (previous.warmup && !previous.warmup.isDestroyed()) previous.warmup.destroy();
      if (!previous.window.isDestroyed()) previous.window.destroy();
    }
    return {provider, cancelled: true};
  }

  function current(ticket, value) {
    return !disposed && generation === ticket && challenge === value && !value.window.isDestroyed();
  }

  async function image(web) {
    const main = web.mainFrame;
    const frames = main?.framesInSubtree || (main ? [main] : []);
    for (const frame of frames.slice(0, 8)) {
      if (frame.isDestroyed?.() || !trustedURL(provider, frame.url)) continue;
      const value = await frame.executeJavaScript(QR_IMAGE_SCRIPT).catch(() => null);
      if (typeof value === 'string' && value.length < IMAGE_LIMIT && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
    }
    return null;
  }

  async function create({method = 'qq'} = {}) {
    if (disposed) throw new Error('账号扫码模块已关闭');
    cancel();
    const ticket = generation;
    const window = new electron.BrowserWindow({
      show: false, width: 800, height: 700, skipTaskbar: true,
      webPreferences: {session: network, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, preload: undefined, offscreen: true, backgroundThrottling: false}
    });
    const value = {window, requestId: crypto.randomBytes(20).toString('hex'), expiresAt: now() + LIFETIME_MS, expiry: null, checking: null, warmup: null, warmupStarted: false};
    challenge = value;
    value.expiry = setTimeout(cancel, LIFETIME_MS);
    value.expiry.unref?.();
    const web = window.webContents;
    web.setFrameRate?.(5);
    web.setWindowOpenHandler(() => ({action: 'deny'}));
    const navigation = (event, url) => {if (!trustedURL(provider, url)) event.preventDefault();};
    web.on('will-navigate', navigation);
    web.on('will-redirect', navigation);
    web.on('will-attach-webview', event => event.preventDefault());
    try {
      let loadTimer;
      try {
        await Promise.race([
          web.loadURL(entryURL),
          new Promise((_, reject) => {loadTimer = setTimeout(() => reject(new Error('官方扫码页面加载超时')), 12000);})
        ]);
      } finally {clearTimeout(loadTimer);}
      const deadline = now() + 10000;
      let lastActivation = 0;
      while (current(ticket, value) && now() < deadline) {
        if (now() - lastActivation >= 1600) {
          await activateLogin(web, provider, method);
          lastActivation = now();
        }
        const qrImage = await image(web);
        if (!current(ticket, value)) break;
        if (qrImage) {
          web.stopPainting?.();
          return {provider, requestId: value.requestId, qrImage, expiresAt: value.expiresAt, status: 'waiting'};
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error('官方页面暂未返回二维码，请刷新或使用面板内登录');
    } catch (error) {
      if (current(ticket, value)) cancel();
      throw error;
    }
  }

  async function check({requestId} = {}) {
    const value = challenge;
    if (disposed || !value || requestId !== value.requestId || now() >= value.expiresAt) return {provider, status: 'expired'};
    if (value.checking) return value.checking;
    const ticket = generation;
    const pending = (async () => {
      if (!await hasCredentials()) {
        // QQ's official callback can establish a web session before the
        // separate player ticket is written. Run the official player once in
        // the same isolated partition, as MineRadio does, without exporting
        // any cookies or playing a song.
        if (provider === 'qq' && !value.warmupStarted && await hasSession() && current(ticket, value)) {
          value.warmupStarted = true;
          try {
            const warmup = new electron.BrowserWindow({
              show: false, width: 720, height: 520, skipTaskbar: true,
              webPreferences: {session: network, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, preload: undefined, offscreen: true, backgroundThrottling: false}
            });
            value.warmup = warmup;
            warmup.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
            const navigation = (event, url) => {if (!trustedURL(provider, url)) event.preventDefault();};
            warmup.webContents.on('will-navigate', navigation);
            warmup.webContents.on('will-redirect', navigation);
            warmup.loadURL('https://y.qq.com/n/ryqq/player').catch(() => {});
          } catch {}
        }
        return {provider, status: 'waiting'};
      }
      const result = await verify();
      if (!current(ticket, value)) return {provider, status: 'expired'};
      if (!result?.apiConnected || !result.profile) return {provider, status: 'waiting'};
      await network.flushStorageData?.();
      if (!current(ticket, value)) return {provider, status: 'expired'};
      onConfirmed(result);
      cancel();
      return {...result, provider, status: 'confirmed'};
    })();
    value.checking = pending;
    try {return await pending;} finally {if (value.checking === pending) value.checking = null;}
  }

  return {create, check, cancel, dispose() {cancel(); disposed = true;}};
}

module.exports = {createPlatformQR};
