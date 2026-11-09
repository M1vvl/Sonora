'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createMusicService, QR_LIFETIME, CHECK_INTERVAL} = require('../src/music/index.cjs');
const {createAuthStore} = require('../src/music/auth-store.cjs');
const {createNeteaseClient, cleanCookies, cookiesFromHeaders, publicProfile, eapi, weapi} = require('../src/music/netease.cjs');
const QR_IMAGE = 'data:image/png;base64,YW5vbnltb3Vz';
const PROFILE = {userId: 12345, nickname: '测试用户', vipType: 11, avatarUrl: 'https://p1.music.126.net/fixture/avatar.jpg'};
const COOKIE = {MUSIC_U: 'unit-test-only-session', __csrf: 'unit-test-only-csrf'};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const response = (body, cookies = [], status = 200) => new Response(JSON.stringify(body), {status, headers: cookies.map(value => ['set-cookie', value])});
function eapiData(body) {
  const cipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null);
  const text = Buffer.concat([cipher.update(Buffer.from(new URLSearchParams(body).get('params'), 'hex')), cipher.final()]).toString();
  const [uri, value, digest] = text.split('-36cd479b6b5-');
  assert.equal(digest, crypto.createHash('md5').update(`nobody${uri}use${value}md5forencrypt`).digest('hex'));
  return {uri, data: JSON.parse(value)};
}
async function fixture(t, overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-pulse-music-test-'));
  t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  const key = crypto.randomBytes(32), calls = [], events = []; let clock = 1700000000000;
  const options = {
    dataDir, now: () => clock,
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(data) { const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(); },
    toDataURL: async () => QR_IMAGE, onStatus: value => events.push(value),
    fetchImpl: async (url, init) => {
      calls.push({url, init});
      if (url.endsWith('/unikey')) return response({code: 200, unikey: 'test-qr-key-1234'});
      if (url.endsWith('/client/login')) return response({code: 803}, [`MUSIC_U=${COOKIE.MUSIC_U}; Domain=.music.163.com; Path=/; Secure; HttpOnly`, `__csrf=${COOKIE.__csrf}; Domain=.music.163.com; Path=/; Secure`]);
      if (url.endsWith('/account/get')) return response({code: 200, profile: PROFILE});
      throw new Error('Unexpected fixture endpoint');
    }, ...overrides
  };
  return {dataDir, options, calls, events, advance: ms => {clock += ms;}, create: more => createMusicService({...options, ...more})};
}

test('music service construction and signed-out bootstrap are lazy and create no auth file', async t => {
  const f = await fixture(t), service = f.create();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await fs.readdir(f.dataDir), []);
  assert.equal((await service.bootstrap()).state, 'signedOut');
  await service.bootstrap(); assert.equal(f.calls.length, 0);
  assert.deepEqual(await fs.readdir(f.dataDir), []);
  await assert.rejects(service.request('loginCookie', {cookie: 'not allowed'}), {code: 'UNSUPPORTED_ACTION'});
  service.dispose(); await assert.rejects(service.beginQR(), {code: 'CANCELLED'});
});

test('public protocol uses encrypted POST to official hosts with bounded normal client fields', async t => {
  const f = await fixture(t), service = f.create();
  await service.beginQR();
  const {url, init} = f.calls[0], decoded = eapiData(init.body);
  assert.equal(url, 'https://interface.music.163.com/eapi/login/qrcode/unikey');
  assert.equal(decoded.uri, '/api/login/qrcode/unikey');
  assert.equal(decoded.data.type, 3); assert.equal(decoded.data.e_r, false);
  assert.equal(init.redirect, 'error'); assert.equal(init.headers.referer, 'https://music.163.com/');
  assert.ok(!JSON.stringify(decoded).includes('antiCheat')); assert.ok(!JSON.stringify(decoded).includes('clientSign'));
  assert.equal(weapi({a: 1}).encSecKey.length, 256);
  assert.match(eapi('/api/unit', {a: 1}).params, /^[A-F0-9]+$/);
});

test('QR generation deduplicates, hides its raw key, and propagates no render failure details', async t => {
  const gate = deferred(), f = await fixture(t, {toDataURL: async () => { await gate.promise; return QR_IMAGE; }}), service = f.create();
  const a = service.beginQR(), b = service.beginQR(); assert.equal(a, b);
  gate.resolve(); const qr = await a;
  assert.equal(f.calls.length, 1); assert.equal(qr.expiresAt, f.options.now() + QR_LIFETIME);
  assert.deepEqual(Object.keys(qr).sort(), ['expiresAt', 'qrImage', 'requestId', 'status']);
  assert.ok(!JSON.stringify(qr).includes('test-qr-key'));
  const broken = f.create({toDataURL: async url => { throw new Error(`secret ${url}`); }});
  await assert.rejects(broken.beginQR(), error => error.code === 'QR_UNAVAILABLE' && !error.message.includes('secret'));
  await assert.rejects(f.create({toDataURL: undefined}).beginQR(), {code: 'QR_UNAVAILABLE'});
});

test('confirmed QR verifies profile and persists only encrypted session; restart verifies once', async t => {
  const f = await fixture(t), service = f.create();
  await service.bootstrap(); const qr = await service.beginQR(), result = await service.checkQR(qr);
  assert.equal(result.status, 'confirmed'); assert.equal(result.profile.nickname, PROFILE.nickname); assert.equal(result.persistence, true);
  assert.equal((await service.bootstrap()).state, 'signedIn');
  assert.equal(f.calls.length, 3); await service.checkQR(qr); assert.equal(f.calls.length, 3);
  const stored = await fs.readFile(path.join(f.dataDir, 'music-auth.json'), 'utf8');
  assert.ok(!stored.includes(COOKIE.MUSIC_U)); assert.ok(!stored.includes(PROFILE.nickname));
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ['encrypted', 'version']);
  assert.ok(!JSON.stringify([result, service.getState(), f.events]).includes(COOKIE.MUSIC_U));
  assert.equal(f.calls[2].url, 'https://music.163.com/weapi/nuser/account/get');
  assert.match(f.calls[2].init.headers.cookie, /MUSIC_U=unit-test-only-session/);
  const second = f.create();
  const before = f.calls.length; const restored = await second.bootstrap();
  await second.bootstrap(); assert.equal(f.calls.length, before + 1);
  assert.equal(restored.state, 'signedIn'); assert.equal(restored.profile.avatarURL, PROFILE.avatarUrl);
  restored.profile.nickname = 'mutated'; assert.equal(second.getState().profile.nickname, PROFILE.nickname);
  await second.logout(); assert.equal(second.getState().state, 'signedOut');
  assert.deepEqual(await fs.readdir(f.dataDir), []);
});

test('QR checks deduplicate in-flight fetches, throttle retries, and stop at local expiry', async t => {
  const gate = deferred(); let checks = 0;
  const f = await fixture(t, {fetchImpl: async url => url.endsWith('/unikey') ? response({code: 200, unikey: 'fixture-key-1234'}) : (checks++, (await gate.promise).clone())});
  const service = f.create(), qr = await service.beginQR();
  const a = service.checkQR(qr), b = service.checkQR(qr); assert.equal(a, b); await new Promise(setImmediate); assert.equal(checks, 1);
  gate.resolve(response({code: 802})); assert.deepEqual(await a, {status: 'scanned'});
  assert.deepEqual(await service.checkQR(qr), {status: 'scanned'}); assert.equal(checks, 1);
  f.advance(CHECK_INTERVAL); assert.equal((await service.checkQR(qr)).status, 'scanned'); assert.equal(checks, 2);
  f.advance(QR_LIFETIME); assert.deepEqual(await service.checkQR(qr), {status: 'expired'}); assert.equal(checks, 2);
});

test('cancelled or superseded 803 responses cannot set account state or write cookies', async t => {
  const gate = deferred(); let checks = 0, accounts = 0, checkSignal;
  const f = await fixture(t, {fetchImpl: async (url, init) => {
    if (url.endsWith('/unikey')) return response({code: 200, unikey: 'fixture-key-1234'});
    if (url.endsWith('/account/get')) { accounts++; return response({code: 200, profile: PROFILE}); }
    checks++; checkSignal = init.signal; return gate.promise;
  }});
  const service = f.create(), qr = await service.beginQR(), pending = service.checkQR(qr);
  await new Promise(setImmediate);
  await service.cancelQR(qr); assert.equal(checkSignal.aborted, true);
  gate.resolve(response({code: 803}, [`MUSIC_U=${COOKIE.MUSIC_U}; Domain=.music.163.com`]));
  await assert.rejects(pending, {code: 'CANCELLED'}); assert.equal(checks, 1); assert.equal(accounts, 0);
  assert.equal(service.getState().state, 'signedOut'); assert.deepEqual(await fs.readdir(f.dataDir), []);
});

test('expiration aborts an in-flight check and rejects late confirmation without persistence', async t => {
  const gate = deferred(); let signal;
  const f = await fixture(t, {fetchImpl: async (url, init) => {
    if (url.endsWith('/unikey')) return response({code: 200, unikey: 'fixture-key-1234'});
    signal = init.signal; return gate.promise;
  }}), service = f.create(), qr = await service.beginQR(), check = service.checkQR(qr);
  await new Promise(setImmediate);
  f.advance(QR_LIFETIME); assert.deepEqual(await service.checkQR(qr), {status: 'expired'}); assert.equal(signal.aborted, true);
  gate.resolve(response({code: 803}, [`MUSIC_U=${COOKIE.MUSIC_U}`]));
  assert.deepEqual(await check, {status: 'expired'}); assert.deepEqual(await fs.readdir(f.dataDir), []);
});

test('logout during account verification prevents a late login from returning', async t => {
  const gate = deferred(), started = deferred();
  const f = await fixture(t), original = f.options.fetchImpl;
  const service = f.create({fetchImpl: async (url, init) => {
    if (url.endsWith('/account/get')) { started.resolve(); return gate.promise; }
    return original(url, init);
  }}), qr = await service.beginQR(), check = service.checkQR(qr);
  await started.promise; await service.logout(); gate.resolve(response({code: 200, profile: PROFILE}));
  await assert.rejects(check, {code: 'CANCELLED'}); assert.equal(service.getState().state, 'signedOut');
  assert.deepEqual(await fs.readdir(f.dataDir), []);
});

test('safeStorage encryption failure never reports confirmation or stores raw credentials', async t => {
  const f = await fixture(t, {encryptString: () => { throw new Error('sensitive low-level details'); }}), service = f.create(), qr = await service.beginQR();
  await assert.rejects(service.checkQR(qr), error => error.code === 'STORAGE_FAILED' && !error.message.includes('sensitive'));
  assert.equal(service.getState().state, 'signedOut'); assert.deepEqual(await fs.readdir(f.dataDir), []);
});

test('unavailable OS encryption supports memory login and clearly reports no persistence', async t => {
  const f = await fixture(t, {isEncryptionAvailable: () => false}), service = f.create(), qr = await service.beginQR();
  assert.equal((await service.checkQR(qr)).persistence, false); assert.equal(service.getState().state, 'signedIn');
  assert.deepEqual(await fs.readdir(f.dataDir), []); assert.equal((await f.create().bootstrap()).state, 'signedOut');
});

test('offline bootstrap retains the saved account and distinguishes pending verification', async t => {
  const f = await fixture(t), service = f.create(), qr = await service.beginQR(); await service.checkQR(qr);
  const file = path.join(f.dataDir, 'music-auth.json'), previous = await fs.readFile(file, 'utf8');
  let requests = 0; const second = f.create({fetchImpl: async () => { requests++; throw new Error('Cookie: secret'); }});
  const state = await second.bootstrap(); await second.bootstrap();
  assert.equal(state.state, 'signedIn'); assert.equal(state.profile.nickname, PROFILE.nickname); assert.equal(state.verification, 'pending'); assert.equal(state.offline, true); assert.equal(requests, 1);
  assert.equal(await fs.readFile(file, 'utf8'), previous);
});

test('rejected saved login clears its encrypted file and corrupted files are not authenticated', async t => {
  const f = await fixture(t), service = f.create(), qr = await service.beginQR(); await service.checkQR(qr);
  const invalid = f.create({fetchImpl: async () => response({code: 301})});
  assert.equal((await invalid.bootstrap()).state, 'signedOut'); assert.deepEqual(await fs.readdir(f.dataDir), []);
  await fs.writeFile(path.join(f.dataDir, 'music-auth.json'), JSON.stringify({version: 1, encrypted: 'corrupted'}));
  let called = false; assert.equal((await f.create({fetchImpl: async () => {called = true;}}).bootstrap()).state, 'signedOut'); assert.equal(called, false);
});

test('cookie/profile sanitation allows only bounded login fields and official HTTPS avatars', () => {
  assert.deepEqual(cleanCookies({...COOKIE, SESSION: 'bad', MUSIC_U: 'line\r\nbreak'}), {__csrf: COOKIE.__csrf});
  assert.deepEqual(cookiesFromHeaders(new Headers([
    ['set-cookie', 'MUSIC_U=bad; Domain=evil.test'], ['set-cookie', 'SESSION=ignored; Domain=.music.163.com'],
    ['set-cookie', 'MUSIC_U=good%2Fvalue; Domain=.music.163.com; Expires=Wed, 21 Oct 2030 07:28:00 GMT'],
    ['set-cookie', '__csrf=allowed; Domain=music.163.com']
  ])), {MUSIC_U: 'good/value', __csrf: 'allowed'});
  assert.equal(publicProfile({userId: 0, nickname: 'bad'}), null);
  assert.equal(publicProfile({...PROFILE, avatarUrl: 'http://p1.music.126.net/p.jpg'}).avatarURL, undefined);
  assert.equal(publicProfile({...PROFILE, avatarUrl: 'https://evil.test/p.jpg'}).avatarURL, undefined);
});

test('HTTP failures and oversized streamed payloads return sanitized errors', async () => {
  const bad = createNeteaseClient({fetchImpl: async () => { throw new Error('MUSIC_U=do-not-forward'); }});
  await assert.rejects(bad.key(), error => error.code === 'NETWORK_UNAVAILABLE' && !error.message.includes('do-not-forward'));
  const huge = createNeteaseClient({fetchImpl: async () => new Response('x'.repeat(128 * 1024 + 1))});
  await assert.rejects(huge.key(), {code: 'RESPONSE_TOO_LARGE'});
  const redirected = createNeteaseClient({fetchImpl: async () => response({}, [], 302)});
  await assert.rejects(redirected.key(), {code: 'UPSTREAM_UNAVAILABLE'});
});

test('cancellation while encrypted commit is pending rolls back the uncommitted file', async t => {
  const f = await fixture(t), gate = deferred(), started = deferred(), encrypt = f.options.encryptString;
  const service = f.create({encryptString: async value => { started.resolve(); await gate.promise; return encrypt(value); }});
  const qr = await service.beginQR(), checking = service.checkQR(qr);
  await started.promise; await service.cancelQR(qr); gate.resolve();
  await assert.rejects(checking, {code: 'CANCELLED'}); assert.equal(service.getState().state, 'signedOut'); assert.deepEqual(await fs.readdir(f.dataDir), []);
});

test('auth store rejects oversized files and ignores sessions without MUSIC_U', async t => {
  const f = await fixture(t), store = createAuthStore(f.options);
  await fs.writeFile(path.join(f.dataDir, 'music-auth.json'), 'x'.repeat(128 * 1024 + 1)); assert.equal(await store.load(), null);
  await assert.rejects(store.save({__csrf: 'csrf-only'}, PROFILE), {code: 'STORAGE_FAILED'});
});

test('dispose waits for an entered encrypted write and its rollback before completing', async t => {
  const f = await fixture(t), started = deferred(), gate = deferred(), encrypt = f.options.encryptString;
  const service = f.create({encryptString: async value => { started.resolve(); await gate.promise; return encrypt(value); }});
  const qr = await service.beginQR(), check = service.checkQR(qr), rejected = assert.rejects(check, {code: 'CANCELLED'});
  await started.promise; let stopped = false; const stopping = service.dispose().then(() => {stopped = true;});
  await Promise.resolve(); assert.equal(stopped, false);
  gate.resolve(); await stopping; await rejected;
  assert.equal(stopped, true); assert.equal(service.getState().state, 'signedOut');
  assert.deepEqual(await fs.readdir(f.dataDir), []);
});

test('official avatar hosts include p1c but exclude an extra music subdomain', () => {
  assert.equal(publicProfile({...PROFILE, avatarUrl: 'https://p1c.music.126.net/a.jpg'}).avatarURL, 'https://p1c.music.126.net/a.jpg');
  assert.equal(publicProfile({...PROFILE, avatarUrl: 'https://p1.music.music.126.net/a.jpg'}).avatarURL, undefined);
});


test('incomplete account response retains credentials and on-demand retry recovers without QR',async t=>{
  const f=await fixture(t),initial=f.create(),qr=await initial.beginQR();await initial.checkQR(qr);await initial.dispose();
  const file=path.join(f.dataDir,'music-auth.json'),original=await fs.readFile(file,'utf8');let calls=0;
  const restored=f.create({fetchImpl:async()=>{calls++;return calls===1?response({code:200,profile:null}):response({code:200,profile:PROFILE});}});
  const first=await restored.bootstrap();assert.equal(first.state,'signedIn');assert.equal(first.verification,'pending');
  assert.equal(await fs.readFile(file,'utf8'),original);await restored.bootstrap();assert.equal(calls,1);
  f.advance(30000);const [a,b]=await Promise.all([restored.bootstrap(),restored.bootstrap()]);
  assert.equal(calls,2);assert.equal(a.verification,'verified');assert.equal(b.profile.nickname,PROFILE.nickname);assert(!a.offline);
  await restored.dispose();
});

test('startup network failure is retried only on later use and never causes a fresh QR login',async t=>{
  const f=await fixture(t),initial=f.create(),qr=await initial.beginQR();await initial.checkQR(qr);await initial.dispose();let calls=0;
  const restored=f.create({fetchImpl:async()=>{if(++calls===1)throw new Error('temporary outage');return response({code:200,profile:PROFILE});}});
  assert.equal((await restored.bootstrap()).verification,'pending');f.advance(29999);await restored.bootstrap();assert.equal(calls,1);
  f.advance(1);assert.equal((await restored.bootstrap()).verification,'verified');assert.equal(calls,2);await restored.dispose();
});

test('a rotated login token is encrypted for the next process and no token enters public state',async t=>{
  const f=await fixture(t),initial=f.create(),qr=await initial.beginQR();await initial.checkQR(qr);await initial.dispose();
  const refreshed=f.create({fetchImpl:async()=>response({code:200,profile:PROFILE},['MUSIC_U=synthetic-rotated-session; Domain=.music.163.com'])});
  const value=await refreshed.bootstrap();assert.equal(value.verification,'verified');assert(!JSON.stringify(value).includes('synthetic-rotated-session'));await refreshed.dispose();
  const saved=await createAuthStore(f.options).load();assert.equal(saved.cookie.MUSIC_U,'synthetic-rotated-session');
  const stored=await fs.readFile(path.join(f.dataDir,'music-auth.json'),'utf8');assert(!stored.includes('synthetic-rotated-session'));
});

test('temporary safeStorage unavailability never removes an already saved encrypted account',async t=>{
  const f=await fixture(t),store=createAuthStore(f.options);await store.save(COOKIE,PROFILE);
  const file=path.join(f.dataDir,'music-auth.json'),old=await fs.readFile(file,'utf8');
  const unavailable=createAuthStore({...f.options,isEncryptionAvailable:()=>false});
  assert.equal(await unavailable.save({MUSIC_U:'synthetic-new-memory-only'},PROFILE),false);
  assert.equal(await fs.readFile(file,'utf8'),old);assert.equal((await store.load()).cookie.MUSIC_U,COOKIE.MUSIC_U);
});

test('logout during rotated-token persistence cannot revive the account after the queued clear',async t=>{
  const f=await fixture(t),store=createAuthStore(f.options);await store.save(COOKIE,PROFILE);
  const entered=deferred(),gate=deferred(),encrypt=f.options.encryptString;
  const restored=f.create({fetchImpl:async()=>response({code:200,profile:PROFILE},['MUSIC_U=synthetic-rotation; Domain=.music.163.com']),encryptString:async value=>{entered.resolve();await gate.promise;return encrypt(value);}});
  const boot=restored.bootstrap(),rejected=assert.rejects(boot,{code:'CANCELLED'});await entered.promise;const logout=restored.logout();gate.resolve();await rejected;await logout;
  assert.equal(restored.getState().state,'signedOut');assert.equal(await store.load(),null);await restored.dispose();
});
