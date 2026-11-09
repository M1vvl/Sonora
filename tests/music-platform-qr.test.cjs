'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createPlatformQR} = require('../src/music/platform-qr.cjs');

function fixture() {
  const windows = [], frames = [], verified = [], confirmed = [];
  let clock = 10000, credentials = false, session = false, verification = {apiConnected: false};
  class Window {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {framesInSubtree: frames};
      this.webContents.setWindowOpenHandler = handler => {this.popup = handler;};
      this.webContents.loadURL = async url => {this.url = url;};
      this.loadURL = async url => {this.url = url;};
      windows.push(this);
    }
    isDestroyed() {return this.destroyed;}
    destroy() {this.destroyed = true;}
  }
  frames.push({url: 'https://xui.ptlogin2.qq.com/login', executeJavaScript: async source => {
    new (require('node:vm').Script)(source);
    return 'data:image/png;base64,AAAA';
  }});
  const network = {flushed: 0, flushStorageData() {this.flushed++;}};
  const qr = createPlatformQR({
    electron: {BrowserWindow: Window}, network, provider: 'qq', entryURL: 'https://y.qq.com/n/ryqq/profile',
    trustedURL: (_, url) => new URL(url).hostname.endsWith('.qq.com'),
    activateLogin: async () => {}, hasCredentials: async () => credentials,
    hasSession: async () => session,
    verify: async () => {verified.push(true); return verification;},
    onConfirmed: value => confirmed.push(value), now: () => clock
  });
  return {qr, windows, frames, network, verified, confirmed,
    advance(ms) {clock += ms;},
    authorizeWebSession() {session = true;},
    authorize(value) {credentials = true; verification = value;}
  };
}

test('official QR host stays hidden and isolated and only exports a bounded image challenge', async () => {
  const f = fixture();
  try {
    const result = await f.qr.create();
    const window = f.windows[0];
    assert.equal(window.options.show, false);
    assert.equal(window.options.webPreferences.session, f.network);
    assert.equal(window.options.webPreferences.sandbox, true);
    assert.equal(window.options.webPreferences.nodeIntegration, false);
    assert.equal(window.options.webPreferences.preload, undefined);
    assert.equal(window.popup().action, 'deny');
    let prevented = false;
    window.webContents.emit('will-navigate', {preventDefault() {prevented = true;}}, 'https://untrusted.invalid/');
    assert.equal(prevented, true);
    assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'provider', 'qrImage', 'requestId', 'status']);
    assert.equal(result.status, 'waiting');
    assert.equal((await f.qr.check(result)).status, 'waiting');
    assert.equal(f.verified.length, 0);
  } finally {f.qr.dispose();}
});

test('a browser cookie requires server profile verification before QR login is confirmed', async () => {
  const f = fixture();
  try {
    const result = await f.qr.create();
    f.authorize({apiConnected: false});
    assert.equal((await f.qr.check(result)).status, 'waiting');
    assert.equal(f.confirmed.length, 0);
    f.authorize({apiConnected: true, profile: {provider: 'qq', nickname: 'synthetic'}});
    const completed = await f.qr.check(result);
    assert.equal(completed.status, 'confirmed');
    assert.equal(completed.profile.provider, 'qq');
    assert.equal(f.network.flushed, 1);
    assert.equal(f.confirmed.length, 1);
    assert(f.windows[0].destroyed);
    assert.equal((await f.qr.check(result)).status, 'expired');
  } finally {f.qr.dispose();}
});

test('QQ web login warms the official player once to obtain a playback ticket', async () => {
  const f = fixture();
  try {
    const challenge = await f.qr.create();
    f.authorizeWebSession();
    assert.equal((await f.qr.check(challenge)).status, 'waiting');
    assert.equal(f.windows.length, 2);
    assert.equal(f.windows[1].url, 'https://y.qq.com/n/ryqq/player');
    assert.equal(f.windows[1].options.webPreferences.session, f.network);
    assert.equal(f.windows[1].options.webPreferences.sandbox, true);
    assert.equal(f.windows[1].popup().action, 'deny');
    assert.equal((await f.qr.check(challenge)).status, 'waiting');
    assert.equal(f.windows.length, 2);
    f.authorize({apiConnected: true, profile: {provider: 'qq'}});
    assert.equal((await f.qr.check(challenge)).status, 'confirmed');
    assert(f.windows[1].destroyed);
  } finally {f.qr.dispose();}
});

test('refresh, cancel and dispose invalidate old challenges and release their hidden hosts', async () => {
  const f = fixture();
  const first = await f.qr.create();
  const second = await f.qr.create();
  assert(f.windows[0].destroyed);
  assert.notEqual(first.requestId, second.requestId);
  assert.equal((await f.qr.check(first)).status, 'expired');
  f.qr.cancel();
  assert(f.windows[1].destroyed);
  assert.equal((await f.qr.check(second)).status, 'expired');
  f.qr.dispose();
  await assert.rejects(f.qr.create(), /已关闭/);
});

test('expired and foreign challenges cannot verify an account', async () => {
  const f = fixture();
  try {
    const result = await f.qr.create();
    assert.equal((await f.qr.check({requestId: 'different'})).status, 'expired');
    f.advance(180001);
    assert.equal((await f.qr.check(result)).status, 'expired');
    assert.equal(f.verified.length, 0);
  } finally {f.qr.dispose();}
});

test('only trusted official frames are queried for the QR image', async () => {
  const f = fixture();
  try {
    f.frames.unshift({url: 'https://attacker.invalid/', executeJavaScript() {throw new Error('untrusted frame queried');}});
    assert.equal((await f.qr.create()).status, 'waiting');
  } finally {f.qr.dispose();}
});

test('canceling during session flush cannot confirm a stale QR challenge', async () => {
  const f = fixture();
  let release, flushing;
  const entered = new Promise(resolve => {flushing = resolve;});
  f.network.flushStorageData = () => {flushing(); return new Promise(resolve => {release = resolve;});};
  try {
    const challenge = await f.qr.create();
    f.authorize({apiConnected: true, profile: {provider: 'qq', nickname: 'synthetic'}});
    const check = f.qr.check(challenge);
    await entered;
    f.qr.cancel(); release();
    assert.equal((await check).status, 'expired');
    assert.equal(f.confirmed.length, 0);
  } finally {f.qr.dispose();}
});
