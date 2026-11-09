'use strict';
// Minimal adaptation of NeteaseCloudMusicApi 4.32.0's MIT-licensed QR login
// modules and public weapi/eapi transport (Copyright 2013-2022 Binaryify).
// No installed MineRadio runtime, anonymous tokens or anti-cheat credentials.
const crypto = require('node:crypto');
const MAX_BYTES = 128 * 1024;
const IV = Buffer.from('0102030405060708');
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;
const COOKIE_NAMES = new Set(['MUSIC_U', '__csrf']);
const ANDROID_UA = 'NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
function authError(code, message) { return Object.assign(new Error(message), {code}); }
function aes(text, key, mode, iv, encoding) {
  const cipher = crypto.createCipheriv(`aes-128-${mode}`, Buffer.from(key), iv);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString(encoding);
}
function weapi(data) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const secret = Array.from({length: 16}, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  const rsaInput = Buffer.alloc(128);
  Buffer.from(secret.split('').reverse().join('')).copy(rsaInput, 112);
  return {
    params: aes(aes(JSON.stringify(data), '0CoJUm6Qyw8W8jud', 'cbc', IV, 'base64'), secret, 'cbc', IV, 'base64'),
    encSecKey: crypto.publicEncrypt({key: PUBLIC_KEY, padding: crypto.constants.RSA_NO_PADDING}, rsaInput).toString('hex')
  };
}
function eapi(uri, data) {
  const text = JSON.stringify(data);
  const digest = crypto.createHash('md5').update(`nobody${uri}use${text}md5forencrypt`).digest('hex');
  return {params: aes(`${uri}-36cd479b6b5-${text}-36cd479b6b5-${digest}`, 'e82ckenh8dichen8', 'ecb', null, 'hex').toUpperCase()};
}
function cleanCookies(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const name of COOKIE_NAMES) {
    const cookie = value[name];
    if (typeof cookie === 'string' && cookie.length <= 16384 && /^[\x21-\x7e]*$/.test(cookie) && !/[;,\\]/.test(cookie)) result[name] = cookie;
  }
  return result;
}
function cookiesFromHeaders(headers, previous = {}) {
  const cookies = cleanCookies(previous);
  // A comma in Expires must not split a cookie. Only split at a new name=.
  const values = typeof headers?.getSetCookie === 'function' ? headers.getSetCookie() : (headers?.get?.('set-cookie') || '').split(/,(?=\s*[^;,=\s]+\s*=)/);
  for (const raw of values.slice(0, 40)) {
    if (typeof raw !== 'string' || raw.length > 18000) continue;
    const parts = raw.split(';'), pair = parts.shift(), equals = pair.indexOf('=');
    if (equals < 1) continue;
    const name = pair.slice(0, equals).trim(), value = pair.slice(equals + 1).trim();
    const domain = parts.find(part => /^\s*domain\s*=/i.test(part));
    if (domain && !/^\s*domain\s*=\s*\.?music\.163\.com\s*$/i.test(domain)) continue;
    if (!COOKIE_NAMES.has(name)) continue;
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch { continue; }
    const validated = cleanCookies({[name]: decoded});
    if (Object.hasOwn(validated, name)) cookies[name] = validated[name];
  }
  return cookies;
}
function publicProfile(value) {
  if (!value || typeof value !== 'object') return null;
  const id = Number(value.userId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const nickname = typeof value.nickname === 'string' ? value.nickname.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80).trim() : '';
  if (!nickname) return null;
  const result = {nickname, userId: id, vip: Number(value.vipType) > 0 || value.vip === true};
  try {
    const url = new URL(value.avatarUrl || value.avatarURL);
    if (url.protocol === 'https:' && !url.username && !url.password && /^(?:p\d+|p\d+c)\.music\.126\.net$/.test(url.hostname) && url.href.length <= 2048) result.avatarURL = url.href;
  } catch {}
  return result;
}
async function limitedJSON(response, maxBytes = MAX_BYTES) {
  if (Number(response.headers?.get?.('content-length')) > maxBytes) throw authError('RESPONSE_TOO_LARGE', '网易云响应过大，请稍后重试');
  let buffer;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel().catch(() => {}); throw authError('RESPONSE_TOO_LARGE', '网易云响应过大，请稍后重试'); }
        chunks.push(Buffer.from(value));
      }
      buffer = Buffer.concat(chunks, size);
    } finally { reader.releaseLock(); }
  } else {
    // Production Node/Electron fetch exposes a byte stream. Refuse unbounded
    // text()/json() adapters rather than allocate before enforcing the limit.
    throw authError('INVALID_RESPONSE', '网易云返回了无效响应，请稍后重试');
  }
  try {
    const data = JSON.parse(buffer.toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw authError('INVALID_RESPONSE', '网易云返回了无效响应，请稍后重试'); }
}
function createNeteaseClient({fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  // Content consumes at most two of three slots, leaving an auth slot even
  // while home/search requests are queued. Queues are bounded and cancellable.
  let active = 0, contentActive = 0;
  const queue = [];
  function drain() {
    for (let index = 0; index < queue.length && active < 3;) {
      const item = queue[index];
      if (!item.auth && contentActive >= 2) { index++; continue; }
      queue.splice(index, 1); item.signal.removeEventListener('abort', item.abort);
      if (item.signal.aborted) { item.reject(authError('CANCELLED', '音乐操作已取消')); continue; }
      active++; if (!item.auth) contentActive++;
      let released = false;
      item.resolve(() => { if (released) return; released = true; active--; if (!item.auth) contentActive--; drain(); });
    }
  }
  function acquire(signal, auth) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(authError('CANCELLED', '音乐操作已取消'));
      if (queue.length >= 32) return reject(authError('BUSY', '音乐请求较多，请稍后重试'));
      const item = {signal, auth, resolve, reject};
      item.abort = () => { const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1); reject(authError('CANCELLED', '音乐操作已取消')); };
      signal.addEventListener('abort', item.abort, {once: true});
      if (auth) queue.unshift(item); else queue.push(item);
      drain();
    });
  }
  async function request(uri, data, {cookie = {}, signal, transport = 'eapi', maxBytes = MAX_BYTES, timeoutMs = 10000, clientProfile} = {}) {
    const cookies = cleanCookies(cookie), controller = new AbortController();
    const externalAbort = () => controller.abort();
    signal?.addEventListener('abort', externalAbort, {once: true});
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), Math.max(250, Math.min(10000, Number(timeoutMs) || 10000))); timeout.unref?.();
    let release;
    try {
      release = await acquire(controller.signal, /\/login\/|\/nuser\/account\//.test(uri));
      if (controller.signal.aborted) throw authError('CANCELLED', '音乐操作已取消');
      const fields = {os: 'pc', appver: '3.1.17.204416', osver: 'Microsoft-Windows-10-Professional-build-19045-64bit', channel: 'netease', ...(clientProfile==='android'?{os:'android',appver:'9.5.61',osver:'12',channel:'xiaomi'}:{}), requestId: `${now()}_${crypto.randomInt(10000)}`, ...cookies};
      const body = transport === 'weapi' ? weapi({...data, e_r: false, csrf_token: cookies.__csrf || ''}) : eapi(uri, {...data, e_r: false, header: fields});
      const endpoint = transport === 'weapi' ? `https://music.163.com/weapi/${uri.slice(5)}` : `https://interface.music.163.com/eapi/${uri.slice(5)}`;
      const response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', referer: 'https://music.163.com/', 'user-agent': clientProfile==='android'?ANDROID_UA:UA,
          cookie: Object.entries(transport === 'weapi' ? cookies : fields).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ')},
        body: new URLSearchParams(body).toString()
      });
      if (response.status < 200 || response.status >= 300) throw authError('UPSTREAM_UNAVAILABLE', '网易云服务暂不可用，请稍后重试');
      const json = await limitedJSON(response, Math.max(MAX_BYTES, Math.min(512 * 1024, Number(maxBytes) || MAX_BYTES)));
      return {body: json, cookie: cookiesFromHeaders(response.headers, cookies)};
    } catch (error) {
      if (signal?.aborted) throw authError('CANCELLED', '音乐操作已取消');
      if (controller.signal.aborted) throw authError('TIMEOUT', '连接网易云超时，请重试');
      if (['UPSTREAM_UNAVAILABLE', 'RESPONSE_TOO_LARGE', 'INVALID_RESPONSE'].includes(error.code)) throw error;
      // Never forward a fetch/axios config, request headers or raw response.
      throw authError('NETWORK_UNAVAILABLE', '暂时无法连接网易云，请检查网络后重试');
    } finally { release?.(); clearTimeout(timeout); signal?.removeEventListener('abort', externalAbort); }
  }
  return {
    async key(options) {
      const result = await request('/api/login/qrcode/unikey', {type: 3}, options);
      const key = result.body.unikey;
      if (Number(result.body.code) !== 200 || typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,256}$/.test(key)) throw authError('QR_UNAVAILABLE', '暂时无法生成网易云登录二维码，请重试');
      return key;
    },
    check(key, options) { return request('/api/login/qrcode/client/login', {key, type: 3}, options); },
    async account(cookie, options = {}) {
      const result = await request('/api/nuser/account/get', {}, {...options, cookie, transport: 'weapi'});
      if (![200, 301, 302, 401].includes(Number(result.body.code))) throw authError('UPSTREAM_UNAVAILABLE', '网易云账号服务暂不可用，请稍后重试');
      return {...result, profile: publicProfile(result.body.profile)};
    },
    // Public module paths match the installed MIT NodeAPI adapters. Limits are
    // intentionally smaller than MineRadio's full-library/search responses.
    dailySongs(options) { return request('/api/v3/discovery/recommend/songs', {}, {...options, transport: 'weapi', maxBytes: 512 * 1024}); },
    dailyPlaylists(options) { return request('/api/v1/discovery/recommend/resource', {}, {...options, transport: 'weapi', maxBytes: 256 * 1024}); },
    personalFM(options) { return request('/api/v1/radio/get', {}, {...options,transport:'weapi',maxBytes:256*1024}); },
    similarSongs(id,options) { return request('/api/v1/discovery/simiSong', {songid:id,limit:30,offset:0}, {...options,transport:'weapi',maxBytes:256*1024}); },
    intelligence(id,playlistId,options) { return request('/api/playmode/intelligence/list', {songId:id,type:'fromPlayOne',playlistId,startMusicId:id,count:30}, {...options,maxBytes:512*1024}); },
    userPlaylists(userId,options={}) { return request('/api/user/playlist', {uid:userId,limit:Math.min(30,Math.max(1,Math.floor(Number(options.limit)||30))),offset:Math.min(10000,Math.max(0,Math.floor(Number(options.offset)||0))),includeVideo:false}, {...options,transport:'weapi',maxBytes:256*1024}); },
    publicSongs(options) { return request('/api/personalized/newsong', {type: 'recommend', limit: 16, areaId: 0}, {...options, transport: 'weapi', maxBytes: 256 * 1024}); },
    topPlaylists(options={}) { return request('/api/playlist/list', {cat:'全部',order:'hot',limit:Math.min(50,Math.max(1,Math.floor(Number(options.limit)||50))),offset:Math.min(100,Math.max(0,Math.floor(Number(options.offset)||0))),total:true}, {...options,transport:'weapi',maxBytes:512*1024}); },
    publicPlaylists(options) { return request('/api/personalized/playlist', {limit: 8, total: true, n: 1000}, {...options, transport: 'weapi', maxBytes: 256 * 1024}); },
    search(query, type, options) { return request('/api/cloudsearch/pc', {s: query, type, limit: type === 1000 ? 6 : 30, offset: 0, total: true}, {...options, maxBytes: 512 * 1024}); },
    songs(ids, options) { return request('/api/v3/song/detail', {c: JSON.stringify(ids.slice(0, 30).map(id => ({id: Number(id)})))}, {...options, transport: 'weapi', maxBytes: 512 * 1024}); },
    songURL(id, options={}) {
      const level=require('./quality.cjs').normalizeQuality(options.quality||'jyeffect');
      const spatial=level==='vivid';
      return request('/api/song/enhance/player/url/v1', {ids:JSON.stringify([Number(id)]),level,encodeType:spatial?'mp3':'flac',...(level==='sky'?{immerseType:'c51'}:{})}, {...options,...(spatial?{clientProfile:'android'}:{})});
    },
    songURLLegacy(id,options={}) { return request('/api/song/enhance/player/url', {ids:JSON.stringify([String(id)]),br:Number(options.bitrate)||320000},options); },
    lyrics(id, options) { return request('/api/song/lyric/v1', {id:Number(id),cp:false,tv:0,lv:0,rv:0,kv:0,yv:0,ytv:0,yrv:0}, {...options,maxBytes:512*1024}); },
    playlist(id, options) { return request('/api/v6/playlist/detail', {id, n: 30, s: 0}, {...options, maxBytes: 2 * 1024 * 1024}); },
    playlistAdd(playlistId,id,options) { return request('/api/playlist/manipulate/tracks', {op:'add',pid:playlistId,trackIds:JSON.stringify([id]),imme:'true'}, options); },
    like(id, liked, options) { return request('/api/radio/like', {alg: 'itembased', trackId: id, like: liked, time: '3'}, options); },
    likes(ids, options) { return request('/api/song/like/check', {trackIds: JSON.stringify(ids.slice(0, 30).map(Number))}, options); },
    comments(id, offset, options) { return request(`/api/v1/resource/comments/R_SO_4_${id}`, {rid: id, limit: 20, offset, beforeTime: 0}, {...options, transport: 'weapi', maxBytes: 256 * 1024}); }
  };
}
module.exports = {createNeteaseClient, cleanCookies, cookiesFromHeaders, publicProfile, authError, eapi, weapi};
