'use strict';

const crypto = require('node:crypto');
const {createSpotifyBrowserBridge} = require('./spotify-browser-bridge.cjs');
const {providerSong} = require('./provider-song.cjs');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const same = (left, right) => String(left || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim() === String(right || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

function createSpotifyBrowserPilot(options) {
  const bridge = options.bridge || createSpotifyBrowserBridge(options);
  const known = new Map();
  const writable = new Map();
  let enabled = false;
  let current = null;
  let currentRoute = null;
  let playingRoute = null;
  let profile = null;
  let home = null;
  let queue = Promise.resolve();
  let disposed = false;
  let startJob = null;

  function check() {if (disposed) throw new Error('Spotify 网页中转已关闭');}
  function remember(rows, route) {
    const result = [];
    for (const raw of rows) {
      const song = providerSong(raw);
      if (!song) continue;
      song.browserRoute = route;
      known.delete(song.id);
      known.set(song.id, {song, route});
      result.push(song);
    }
    while (known.size > 10000) known.delete(known.keys().next().value);
    return result;
  }

  async function loadRoute(route, collect = false) {
    check();
    let value;
    if (route.startsWith('/playlist/')) value = await bridge.playlist(route.slice(10));
    else value = await bridge.navigate(route, {songs:true});
    if (value.loginRequired) throw new Error('请完成 Spotify 官方登录');
    if (collect && bridge.collect) value = await bridge.collect(route, {songs:true,complete:route.startsWith('/playlist/')||route==='/collection/tracks'});
    currentRoute = route;
    return remember(value.songs, route);
  }

  async function loadHome() {
    const value = bridge.navigate ? await bridge.navigate('/') : await bridge.read();
    if (value.loginRequired) throw new Error('请完成 Spotify 官方登录');
    if (value.profileName && profile?.nickname && profile.nickname !== 'Spotify 账号' && !same(value.profileName, profile.nickname)) throw new Error('浏览器与 Sonara 的 Spotify 账号不一致');
    const playlists = value.playlists.filter(item => /^spotify:[A-Za-z0-9]{22}$/.test(item.id));
    if (!playlists.length) throw new Error('Spotify 暂未显示推荐歌单，请稍后重试');
    let songs = [];
    for (const list of playlists.slice(0, 3)) {
      try {songs = await loadRoute('/playlist/' + list.id.slice(8));} catch {check();}
      if (songs.length) break;
    }
    home = {provider:'spotify', playlists, songs, cards:songs, discoveryModes:[], recommendationMode:'library', recommendationLabel:'Spotify · 推荐歌单'};
    return {...home, profile};
  }

  async function start(account) {
    check();
    if (enabled && profile?.userId === account?.userId) return {enabled:true};
    if (startJob) return startJob;
    startJob = (async () => {
      profile = account;
      await bridge.open();
      await loadHome();
      check();
      enabled = true;
      await bridge.minimize().catch(() => {});
      return {enabled:true, playlistCount:home.playlists.length, songCount:home.songs.length};
    })().finally(() => {startJob = null;});
    return startJob;
  }

  async function locate(id) {
    const record = known.get(id);
    if (!record) throw new Error('请从已读取的歌单或搜索结果中选择歌曲');
    if (currentRoute !== record.route) await loadRoute(record.route);
    await bridge.locateSong?.(id,record.song.browserRow);
    const visible = (await bridge.read()).songs.find(song => song.id === id);
    if (!visible || !same(visible.title, record.song.title) || !same(visible.artist, record.song.artist)) throw new Error('歌曲列表已更新，请刷新歌单后重试');
    return record;
  }

  async function menuFor(id) {
    await locate(id);
    await bridge.dismissMenus();
    await delay(150);
    await bridge.operation('more', {id});
    for (let attempt = 0; attempt < 10; attempt++) {
      await delay(150);
      const menu = await bridge.operation('menus');
      if (menu.some(item => item.role === 'menuitem' && /添加至.?已点赞的歌曲|从.?已点赞的歌曲.?中?(?:移除|删除)|(?:Add to|Remove from) (?:your )?Liked Songs/i.test(item.text))) return;
    }
    throw new Error('Spotify 歌曲菜单尚未就绪，请重试');
  }

  async function like(payload) {
    if (typeof payload.liked !== 'boolean') throw new Error('无效的收藏状态');
    await menuFor(payload.id);
    try {
      const before = await bridge.operation('likeState', {id:payload.id});
      if (typeof before.liked !== 'boolean') throw new Error('Spotify 尚未确认收藏状态');
      const desired = payload.toggle === true ? !before.liked : payload.liked;
      if (before.liked !== desired) {
        await bridge.operation('like', {id:payload.id});
        let confirmed = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          await delay(300);
          await menuFor(payload.id);
          const after = await bridge.operation('likeState', {id:payload.id});
          if (after.liked === desired) {confirmed = true;break;}
        }
        if (!confirmed) throw new Error('Spotify 尚未确认收藏状态，请刷新后重试');
      }
      known.get(payload.id).song.liked = desired;
      if (current?.id === payload.id) current.liked = desired;
      return {id:payload.id, liked:desired};
    } finally {await bridge.dismissMenus();}
  }

  async function choices(id) {
    await menuFor(id);
    try {
      await bridge.operation('addMenu');
      await delay(350);
      const menus = await bridge.operation('menus');
      const values = menus.filter(item => item.depth === '1' && item.text && !/^(新建歌单|Create playlist)$/i.test(item.text));
      writable.clear();
      for (const item of values) {
        const key = 'spotify:add-' + crypto.createHash('sha256').update(item.text).digest('hex').slice(0,20);
        if (writable.has(key)) throw new Error('歌单名称重复，请在官方页面确认目标歌单');
        writable.set(key, item.text);
      }
      return {playlists:[...writable].map(([key,title]) => ({id:key,title,source:'spotify',owned:true}))};
    } finally {await bridge.dismissMenus();await bridge.dismissMenus();}
  }

  async function add(payload) {
    const title = writable.get(payload.playlistId);
    if (!title) throw new Error('请先选择可写入的本人歌单');
    await menuFor(payload.id);
    try {
      await bridge.operation('addMenu');
      await delay(300);
      const noticesBefore = new Set(await bridge.operation('notices'));
      await bridge.operation('menu', {text:title});
      for (let attempt = 0; attempt < 12; attempt++) {
        await delay(250);
        const notices = await bridge.operation('notices');
        if (notices.some(text => !noticesBefore.has(text) && /^(?:已添加|已加入|添加至|Added to)/i.test(text) && text.includes(title))) return {id:payload.id,playlistId:payload.playlistId,added:true};
      }
      throw new Error('Spotify 未返回添加确认，请在目标歌单核查后重试');
    } finally {await bridge.dismissMenus();}
  }

  async function state() {
    const value = await (bridge.readPlayer ? bridge.readPlayer() : bridge.read());
    if (value.loginRequired) throw new Error('Spotify 登录已失效，请重新登录');
    const matching = [...known.values()].filter(record => value.song && same(record.song.title, value.song.title) && same(record.song.artist, value.song.artist));
    const active = matching.find(record => record.song.id === current?.id) || matching.find(record => record.route === playingRoute) || (matching.length === 1 ? matching[0] : null);
    if (active) current = {...active.song,...(value.song.coverURL?{coverURL:value.song.coverURL}:{})};
    const matches = active && value.song;
    if (matches && value.duration > 0) current.duration = value.duration;
    return {remote:true,song:matches ? current : null,playing:!!matches && value.playing === true,position:matches ? value.position : 0,deviceName:'Spotify 官方网页'};
  }

  async function execute(payload) {
    check();
    if (!enabled) throw new Error('Spotify 音乐页面正在连接，请稍后重试');
    if (payload.action === 'home') return payload.refresh ? loadHome() : {...home,profile};
    if (payload.action === 'profile') return {provider:'spotify',profile,browserBridge:true,webAuthenticated:true,apiConnected:false};
    if (payload.action === 'playlists') {
      if (payload.songId) return choices(payload.songId);
      const result = await bridge.collect('/collection/playlists');
      currentRoute = null;
      return {playlists:[{id:'spotify:liked',title:'已点赞的歌曲',source:'spotify'}, ...result.playlists],hasMore:false};
    }
    if (payload.action === 'playlist') {
      const id = String(payload.id).replace(/^spotify:/, '');
      if (id !== 'liked' && !/^[A-Za-z0-9]{22}$/.test(id)) throw new Error('无效歌单');
      const songs = await loadRoute(id === 'liked' ? '/collection/tracks' : '/playlist/' + id, true);
      return {songs,total:songs.length,hasMore:false};
    }
    if (payload.action === 'search') {
      const query = String(payload.query || '').trim().slice(0,160);
      if (!query) return {songs:[],playlists:[]};
      const route = '/search/' + encodeURIComponent(query);
      const value = await bridge.collect(route, {songs:true,complete:route.startsWith('/playlist/')||route==='/collection/tracks'});
      currentRoute = route;
      return {songs:remember(value.songs, route),playlists:value.playlists};
    }
    if (payload.action === 'like') return like(payload);
    if (payload.action === 'playlistAdd') return add(payload);
    if (payload.action === 'lyrics') {
      const song=known.get(payload.id)?.song;
      if(!song||!options.lookupLyrics)return {lines:[]};
      const result=await options.lookupLyrics(song);check();return result;
    }
    if (payload.action === 'playbackOptions') return {qualityOptions:[],qualityLabel:'音质由官方网页控制'};
    if (payload.action === 'play') {
      if (!known.has(payload.id) && payload.song?.id === payload.id) {
        const saved = providerSong(payload.song);
        if (saved?.browserRoute) remember([saved], saved.browserRoute);
      }
      const record = await locate(payload.id);
      if (payload.isCurrent && !payload.isCurrent()) return {canceled:true};
      if (payload.autoplay !== false) {
        await bridge.play(record.song.id.slice(8));
        let confirmed = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          const value = await bridge.read();
          if (value.playing === true && same(value.song?.title, record.song.title) && same(value.song?.artist, record.song.artist)) {confirmed = true;break;}
          await delay(400);
        }
        if (!confirmed) throw new Error('Spotify 官方网页未确认所选歌曲开始播放');
        if (Number(payload.position) > 0) {
          const position = Math.max(0,Math.min(record.song.duration || 86400,Number(payload.position)));
          await bridge.operation('seek', {value:position});
          await delay(300);
          if (Math.abs((await bridge.read()).position - position) > 3) throw new Error('Spotify 尚未确认恢复进度');
        }
      }
      current = {...record.song,position:Math.max(0,Number(payload.position) || 0)};
      playingRoute = record.route;
      return {song:current,source:'spotify',remote:true,playable:true,qualityLabel:'Spotify 官方网页',qualityOptions:[]};
    }
    if (payload.action === 'playerControl') {
      if (['seek','volume'].includes(payload.control)) {
        const value = payload.control === 'seek' ? Number(payload.position) : Number(payload.volume);
        if (!Number.isFinite(value)) throw new Error('无效播放参数');
        await bridge.operation(payload.control, {value});
        if (payload.control === 'seek') {
          await delay(300);
          if (Math.abs((await bridge.read()).position - value) > 3) throw new Error('Spotify 尚未确认进度变化');
        }
        return {ok:true};
      }
      if (!['pause','resume'].includes(payload.control)) throw new Error('无效播放控制');
      const expected = payload.control === 'resume';
      const before = await bridge.read();
      if (expected && current && (!same(before.song?.title, current.title) || !same(before.song?.artist, current.artist))) return execute({action:'play',id:current.id,position:current.position}).then(() => ({ok:true}));
      if (before.playing === null) throw new Error('网页尚未提供播放状态');
      if (before.playing !== expected) await bridge.toggle();
      for (let attempt = 0; attempt < 8; attempt++) {
        if ((await bridge.read()).playing === expected) return {ok:true};
        await delay(250);
      }
      throw new Error('Spotify 未确认播放状态变化');
    }
    if (payload.action === 'stopPlayback') {
      const value = await bridge.read();
      if (current && value.playing === true) await bridge.toggle();
      current = null;
      playingRoute = null;
      return {stopped:true};
    }
    throw new Error('Spotify 网页暂未提供此操作');
  }

  function request(payload) {
    if (payload.action === 'playerState') return state();
    // Catalog lyric lookup does not touch the browser. It must never hold the
    // webpage command queue while a user tries to pause or seek.
    if (payload.action === 'lyrics') return execute(payload);
    const job = queue.catch(() => {}).then(() => execute(payload));
    queue = job.catch(() => {});
    return job;
  }
  return {start,request,get enabled() {return enabled;},async logout() {await bridge.clearSession?.();await this.dispose();},async dispose() {disposed = true;enabled = false;current = null;known.clear();writable.clear();await bridge.dispose();}};
}
module.exports = {createSpotifyBrowserPilot};
