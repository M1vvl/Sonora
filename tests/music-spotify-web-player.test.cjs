'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createSpotifyWebPlayer, playerURL, PARTITION} = require('../src/music/spotify-web-player.cjs');

function fixture() {
  const owner = new EventEmitter(), views = [], opened = [], observed = [];
  let currentOwner = owner;
  owner.isDestroyed = () => false; owner.getContentSize = () => [1200, 800]; owner.children = new Set();
  owner.contentView = {addChildView: view => owner.children.add(view), removeChildView: view => owner.children.delete(view)};
  class View {
    constructor(options) {
      this.options = options; views.push(this); const web = this.webContents = new EventEmitter();
      web.isDestroyed = () => this.destroyed; web.getURL = () => this.url || 'about:blank';
      web.setWindowOpenHandler = handler => {this.popup = handler;};
      web.loadURL = url => {this.url = url; return new Promise(resolve => {this.loaded = resolve;});};
      web.close = () => {this.destroyed = true; web.emit('destroyed');};
    }
    setBounds(value) {this.bounds = value;}
    setBackgroundColor() {}
  }
  const network = {partition: PARTITION};
  const api = createSpotifyWebPlayer({getHostWindow: () => currentOwner,
    electron: {WebContentsView: View, session: {fromPartition: name => {assert.equal(name, PARTITION);return network;}}, shell: {openExternal: async url => opened.push(url)}},
    observeProfile: web => {const value = {web, released: false};observed.push(value);return () => {value.released = true;};}
  });
  return {api, owner, views, opened, observed, show: path => api.request({provider: 'spotify', visible: true, bounds: {x: 20, y: 100, width: 1000, height: 650}, ...(path === undefined ? {} : {path})}), loseOwner() {currentOwner = null;}};
}

test('official player routes cannot open another host or inject browser parameters', () => {
  for (const path of ['/', '/collection/tracks', '/collection/playlists', '/search/Night%20City']) assert(playerURL(path).startsWith('https://open.spotify.com/'));
  for (const path of ['https://evil.test', '//evil.test/', '/?token=secret', '/#fragment', '/user/other', 'file:///C:/private', '/search/a/b']) assert.throws(() => playerURL(path));
});

test('official workspace shares only its isolated login session and hides before earlier navigation completes', async t => {
  const f = fixture();t.after(() => f.api.dispose());
  const state = await f.show();assert.equal(state.embeddedAudio, false);assert.equal(state.playback, 'official-browser');
  const view = f.views[0];assert.equal(f.owner.children.size, 1);assert.equal(view.options.webPreferences.nodeIntegration, false);assert.equal(view.options.webPreferences.sandbox, true);assert.equal(view.options.webPreferences.preload, undefined);
  await f.api.request({provider: 'spotify', visible: false});view.loaded();await Promise.resolve();assert.equal(f.owner.children.size, 0);
  await f.show();assert.equal(f.views.length, 1);assert.equal(f.owner.children.size, 1);
  f.owner.emit('hide');assert.equal(f.owner.children.size, 0);
  await f.show('/collection/tracks');assert.equal(view.url, 'https://open.spotify.com/collection/tracks');
  view.url='https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL';
  await f.show('/collection/tracks');assert.equal(view.url,'https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL');
  await f.api.request({provider:'spotify',visible:true,bounds:view.bounds,path:'/collection/tracks',navigate:true});
  assert.equal(view.url,'https://open.spotify.com/collection/tracks');
});

test('official identity popups stay inside bounded views and unknown navigations are rejected', async t => {
  const f = fixture();t.after(() => f.api.dispose());await f.show();const view = f.views[0];
  assert.equal(view.popup({url: 'https://evil.test'}).action, 'deny');
  const popup = view.popup({url: 'https://accounts.spotify.com/login'});assert.equal(popup.action, 'allow');
  popup.createWindow({webPreferences: {nodeIntegration: true, preload: 'must-not-load'}});
  assert.equal(f.owner.children.size, 1);assert.equal(f.views[1].options.webPreferences.nodeIntegration, false);assert.equal(f.views[1].options.webPreferences.preload, undefined);
  let denied = false;f.views[1].webContents.emit('will-navigate', {preventDefault() {denied = true;}}, 'https://spotify.com.evil.test/');assert(denied);
  f.views[1].webContents.close();assert(f.owner.children.has(view));
});

test('supported-browser playback opens only an official route and disposal releases every observer', async () => {
  const f = fixture();await f.show();
  f.views[0].url='https://open.spotify.com/collection/tracks';
  assert.deepEqual(await f.api.request({provider: 'spotify', action: 'browser', path: '/collection/tracks'}), {opened: true, playback: 'official-browser'});
  assert.deepEqual(f.opened, ['https://open.spotify.com/collection/tracks']);
  f.views[0].url='https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL?si=not-forwarded';
  await f.api.request({provider:'spotify',action:'browser'});
  assert.equal(f.opened.at(-1),'https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL');
  await assert.rejects(f.api.request({provider: 'spotify', action: 'browser', path: 'https://evil.test'}));
  await assert.rejects(f.api.request({provider: 'qq', visible: true}));
  f.api.dispose();assert(f.views.every(view => view.destroyed));assert(f.observed.every(value => value.released));
  assert.equal(f.owner.children.size, 0);assert.equal(f.owner.listenerCount('hide'), 0);assert.equal(f.owner.listenerCount('closed'), 0);
  await assert.rejects(f.show());
});
