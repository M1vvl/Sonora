'use strict';
const crypto = require('node:crypto');
const {createNeteaseClient, authError} = require('./netease.cjs');
const {createAuthStore} = require('./auth-store.cjs');
const QR_LIFETIME = 3 * 60 * 1000;
const CHECK_INTERVAL = 1500;
const RESTORE_RETRY_DELAY = 30000;
function createMusicService(options = {}) {
  const {dataDir, fetchImpl, encryptString, decryptString, isEncryptionAvailable, toDataURL, onStatus, now = Date.now} = options;
  const client = createNeteaseClient({fetchImpl, now});
  const store = createAuthStore({dataDir, encryptString, decryptString, isEncryptionAvailable});
  let state = 'signedOut', profile = null, cookie = {}, persistence = store.available(), offline = false, verification = 'none', initialized = false, retryAt = 0;
  let generation = 0, pending = null, beginning = null, bootstrapPromise = null, disposed = false, mutations = Promise.resolve();
  const controllers = new Set();
  let player = null;
  let localPreferences = null,visuals=null;
  function content() {
    if (disposed) throw authError('CANCELLED', '音乐模块已关闭');
    if (!player) player = require('./player-service.cjs').createPlayerService({client, dataDir, now, random: options.random, getAuth: () => ({state, profile, cookie})});
    return player;
  }
  const snapshot = () => ({state, profile: profile ? {...profile} : null, selected: 'netease', persistence, verification, ...(localPreferences ? {preferences: {...localPreferences}} : {}), ...(offline ? {offline: true} : {})});
  function emit() { try { onStatus?.(snapshot()); } catch {} }
  function valid(ticket) { if (disposed || generation !== ticket) throw authError('CANCELLED', '登录操作已取消'); }
  function controller() { const value = new AbortController(); controllers.add(value); return value; }
  function enqueue(job) { const result = mutations.then(job); mutations = result.catch(() => {}); return result; }
  function invalidate() { generation++; pending = null; beginning = null; for (const value of controllers) value.abort(); controllers.clear(); }
  async function bootstrap() {
    if (disposed) throw authError('CANCELLED', '音乐模块已关闭');
    if (!localPreferences) localPreferences = content().preferences().preferences;
    if (bootstrapPromise) return bootstrapPromise.then(() => snapshot());
    if (initialized && (verification !== 'pending' || now() < retryAt)) return snapshot();
    const ticket = generation;
    const task = (async () => {
      const saved = await store.load(); valid(ticket); initialized = true;
      if (!saved?.cookie?.MUSIC_U) return snapshot();
      // A saved, encrypted account survives startup validation outages. Public
      // state distinguishes this from a freshly server-verified session.
      cookie = saved.cookie; profile = saved.profile; state = 'signedIn';
      offline = true; verification = 'pending'; retryAt = now() + RESTORE_RETRY_DELAY; emit();
      const operation = controller();
      try {
        const account = await client.account(saved.cookie, {signal: operation.signal}); valid(ticket);
        const code = Number(account.body.code);
        if (code === 200 && account.profile && account.cookie.MUSIC_U) {
          // Persist a server-rotated token/profile, not only the first QR token.
          // Queue with logout/QR writes so an older verification cannot revive
          // a session after a newer logout has cleared it.
          if (JSON.stringify(account.cookie) !== JSON.stringify(saved.cookie) || JSON.stringify(account.profile) !== JSON.stringify(saved.profile)) {
            await enqueue(async () => { valid(ticket); persistence = await store.save(account.cookie, account.profile); });
            valid(ticket);
          }
          cookie = account.cookie; profile = account.profile; state = 'signedIn'; offline = false; verification = 'verified'; retryAt = 0;
        } else if ([301, 302, 401].includes(code)) {
          await enqueue(async () => { valid(ticket); await store.clear(); }); valid(ticket);
          cookie = {}; profile = null; state = 'signedOut'; offline = false; verification = 'invalid'; retryAt = 0; player?.authChanged();
        }
        // A successful transport with a missing profile is inconclusive. It
        // cannot erase the only saved login and is retried only on later use.
      } catch (error) {
        valid(ticket);
        if (!['NETWORK_UNAVAILABLE', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE'].includes(error.code)) throw error;
      } finally { controllers.delete(operation); }
      emit(); return snapshot();
    })();
    bootstrapPromise = task;
    const finish = () => { if (bootstrapPromise === task) bootstrapPromise = null; };
    task.then(finish, finish);
    return task;
  }
  function beginQR() {
    if (disposed) return Promise.reject(authError('CANCELLED', '音乐模块已关闭'));
    if (beginning) return beginning;
    invalidate(); const ticket = generation, operation = controller();
    const task = Promise.resolve().then(async () => {
      try {
        if (typeof toDataURL !== 'function') throw authError('QR_UNAVAILABLE', '二维码组件暂不可用，请重新打开音乐页面');
        const key = await client.key({signal: operation.signal}); valid(ticket);
        const qrImage = await toDataURL(`https://music.163.com/login?codekey=${encodeURIComponent(key)}`, {errorCorrectionLevel: 'M', margin: 2, width: 256}); valid(ticket);
        if (typeof qrImage !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(qrImage) || qrImage.length > 200000) throw authError('QR_UNAVAILABLE', '二维码生成失败，请重试');
        pending = {requestId: crypto.randomBytes(18).toString('hex'), key, expiresAt: now() + QR_LIFETIME, status: 'waiting', lastCheckAt: -Infinity, inflight: null, ticket};
        return {requestId: pending.requestId, qrImage, status: pending.status, expiresAt: pending.expiresAt};
      } catch (error) {
        valid(ticket);
        if (['QR_UNAVAILABLE', 'NETWORK_UNAVAILABLE', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'RESPONSE_TOO_LARGE', 'INVALID_RESPONSE'].includes(error.code)) throw error;
        throw authError('QR_UNAVAILABLE', '二维码生成失败，请重试');
      } finally { controllers.delete(operation); if (beginning === task) beginning = null; }
    });
    beginning = task; return task;
  }
  function checkQR({requestId} = {}) {
    if (disposed) return Promise.reject(authError('CANCELLED', '音乐模块已关闭'));
    const qr = pending;
    if (!qr || typeof requestId !== 'string' || requestId !== qr.requestId) return Promise.resolve({status: 'expired'});
    if (now() >= qr.expiresAt) { qr.status = 'expired'; qr.operation?.abort(); return Promise.resolve({status: 'expired'}); }
    if (qr.status === 'confirmed') return Promise.resolve({status: 'confirmed', profile: profile ? {...profile} : null, persistence});
    if (qr.status === 'expired') return Promise.resolve({status: 'expired'});
    if (qr.inflight) return qr.inflight;
    if (now() - qr.lastCheckAt < CHECK_INTERVAL) return Promise.resolve({status: qr.status});
    qr.lastCheckAt = now(); const operation = controller(); qr.operation = operation;
    const task = (async () => {
      try {
        const result = await client.check(qr.key, {signal: operation.signal}); valid(qr.ticket);
        if (now() >= qr.expiresAt) { qr.status = 'expired'; return {status: 'expired'}; }
        switch (Number(result.body.code)) {
          case 800: qr.status = 'expired'; break;
          case 801: qr.status = 'waiting'; break;
          case 802: qr.status = 'scanned'; break;
          case 803: {
            if (!result.cookie.MUSIC_U) throw authError('LOGIN_INCOMPLETE', '扫码已确认，但登录凭据尚未就绪，请刷新二维码重试');
            const account = await client.account(result.cookie, {signal: operation.signal}); valid(qr.ticket);
            if (now() >= qr.expiresAt) { qr.status = 'expired'; return {status: 'expired'}; }
            if (Number(account.body.code) !== 200 || !account.profile) throw authError('LOGIN_INCOMPLETE', '扫码已确认，但暂时无法核实账号资料，请重试');
            const committed = await enqueue(async () => {
              valid(qr.ticket);
              if (now() >= qr.expiresAt || qr.status === 'expired') { qr.status = 'expired'; return false; }
              const previous = await store.load(); valid(qr.ticket);
              const rollback = () => previous?.cookie?.MUSIC_U && previous.profile ? store.save(previous.cookie, previous.profile) : store.clear();
              const persisted = await store.save(account.cookie, account.profile);
              // Cancellation/logout can occur while an async atomic write is in
              // progress. Roll that uncommitted session back before a newer save.
              if (disposed || generation !== qr.ticket) { await rollback(); valid(qr.ticket); }
              if (now() >= qr.expiresAt || qr.status === 'expired') { await rollback(); qr.status = 'expired'; return false; }
              cookie = account.cookie; profile = account.profile; persistence = persisted; state = 'signedIn'; offline = false; verification = 'verified'; initialized = true; retryAt = 0;
              player?.authChanged();
              bootstrapPromise = null;
              qr.status = 'confirmed'; qr.key = null; emit(); return true;
            });
            if (!committed) return {status: 'expired'};
            return {status: 'confirmed', profile: {...profile}, persistence};
          }
          default: throw authError('QR_UNAVAILABLE', '暂时无法查询扫码状态，请稍后重试');
        }
        return {status: qr.status};
      } catch (error) {
        valid(qr.ticket);
        if (now() >= qr.expiresAt || qr.status === 'expired') { qr.status = 'expired'; return {status: 'expired'}; }
        throw error;
      } finally { controllers.delete(operation); if (qr.inflight === task) { qr.inflight = null; qr.operation = null; } }
    })();
    qr.inflight = task; return task;
  }
  async function cancelQR({requestId} = {}) {
    if (requestId && pending && requestId !== pending.requestId) return {cancelled: false};
    invalidate(); return {cancelled: true};
  }
  async function logout() {
    invalidate(); const ticket = generation;
    await enqueue(async () => { await store.clear(); valid(ticket); cookie = {}; profile = null; state = 'signedOut'; offline = false; verification = 'none'; initialized = true; retryAt = 0; persistence = store.available(); });
    player?.authChanged();
    bootstrapPromise = null; emit(); return snapshot();
  }
  const action = name => async payload => { await bootstrap(); return content()[name](payload); };
  const actions = {bootstrap, beginQR, checkQR, cancelQR, logout,
    home: action('home'), deck:action('deck'), discovery:action('discovery'), search: action('search'), play: action('play'), playlist: action('playlist'),userPlaylists:action('userPlaylists'),playlistAdd:action('playlistAdd'), like: action('like'), comments: action('comments'),lyrics:action('lyrics'),playbackOptions:action('playbackOptions'),listening:payload=>content().listening(payload),
    async visualSettings(payload={}){if(disposed)throw authError('CANCELLED','音乐模块已关闭');visuals||=require('./visual-settings.cjs').createVisualSettings(dataDir);return {settings:payload.settings!==undefined?await visuals.save(payload.settings):await visuals.read()};},
    historyProgress: payload => content().historyProgress(payload), preferences(payload) { const result = content().preferences(payload); localPreferences = result.preferences; return result; },
    inactive() { player?.inactive(); return {inactive: true, canceled: true}; },
    deactivate() { player?.inactive(); return {canceled: true}; }};
  return {
    ...actions,
    registerExternalPlayback:value=>content().registerExternal(value),
    request(action, payload) { if (!Object.hasOwn(actions, action)) return Promise.reject(authError('UNSUPPORTED_ACTION', '不支持的音乐操作')); return actions[action](payload); },
    getState: snapshot,
    async dispose() {
      if (!disposed) { disposed = true; invalidate(); }
      await player?.dispose();
      // Let an already-entered atomic save finish its cancellation rollback
      // before Electron exits; no new network or storage job is created here.
      await mutations;
      cookie = {}; profile = null; state = 'signedOut'; offline = false; verification = 'none';
    },
  };
}
module.exports = {createMusicService, QR_LIFETIME, CHECK_INTERVAL, RESTORE_RETRY_DELAY};
