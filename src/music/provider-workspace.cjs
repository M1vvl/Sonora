'use strict';

const PROVIDERS = Object.freeze(['netease', 'qq', 'kugou', 'qishui', 'spotify']);
const LABELS = {qq: 'QQ 音乐', kugou: '酷狗音乐', qishui: '汽水音乐',spotify:'Spotify'};

// Route the catalog separately from the current audio owner: switching accounts
// changes future browsing, without destroying the song that is already playing.
function createProviderWorkspace({requestNetease, requestPlatform, platformStatus, onChange = () => {}, now = Date.now}) {
  let selected = null, generation = 0, disposed = false, cached = null, pending = null;
  let profile = null, verifiedAt = -Infinity, spotifyWeb = false;
  let commits = Promise.resolve();
  const alive = ticket => {if (disposed || ticket !== generation) throw new Error('音乐账号已切换，请重试');};
  async function provider() {
    if (selected === null) {
      const value = await requestNetease('preferences', {});
      if (selected === null) selected = PROVIDERS.includes(value?.preferences?.activeProvider) ? value.preferences.activeProvider : 'netease';
    }
    if (disposed) throw new Error('音乐工作区已关闭');
    return selected;
  }
  async function verify(source, ticket) {
    // A Spotify website session belongs to the official player, not to our
    // optional Web API adapter. Never require an app token just to browse it.
    if (source === 'spotify' && platformStatus) {
      const result = await platformStatus({provider: source});
      alive(ticket);
      if(result?.browserBridge && result.webAuthenticated && result.webProfile)return {provider:source,profile:result.webProfile,apiConnected:false,webAuthenticated:true,browserBridge:true,webPlayer:false};
      if(result?.apiConnected && result.profile) return {provider:source,profile:result.profile,apiConnected:true,webPlayer:false};
      if (!result?.webAuthenticated || !result.webProfile) throw new Error('请先登录 Spotify 官方网页');
      return {provider: source, profile: result.webProfile, apiConnected: false, webAuthenticated: true, webPlayer: true};
    }
    const result = source === 'netease' ? await requestNetease('bootstrap', {}) : await requestPlatform({provider: source, action: 'profile'});
    alive(ticket);
    if (source !== 'netease' && (!result?.apiConnected || !result.profile)) throw new Error('请先扫码登录并验证此平台账号');
    return {provider: source, profile: result?.profile || null, apiConnected: source === 'netease' || result.apiConnected === true};
  }
  async function state() {
    const source = await provider(), ticket = generation;
    try {
      const result = await verify(source, ticket);
      const identity = value => String(value?.userId || value?.nickname || '');
      if (profile && identity(profile) !== identity(result.profile)) {
        generation++;
        cached = pending = null;
      }
      profile = result.profile; spotifyWeb = result.webPlayer===true; verifiedAt = now();
      return result;
    } catch (error) {
      alive(ticket);
      profile = null; verifiedAt = -Infinity; cached = null;
      return {provider: source, profile: null, apiConnected: false, message: error.message};
    }
  }
  async function select({provider: source} = {}) {
    if (!PROVIDERS.includes(source)) throw new Error('该平台的音乐工作区尚未接通');
    await provider();
    const ticket = ++generation;
    cached = pending = null;
    const result = await verify(source, ticket);
    const commit = commits.then(async () => {
      alive(ticket);
      try {
        await requestNetease('preferences', {activeProvider: source});
      } catch (error) {
        await requestNetease('preferences', {activeProvider: selected});
        throw error;
      }
      // A newer choice may arrive during an asynchronous save. Restore the
      // committed account before that newer choice can enter the write queue.
      if (disposed || ticket !== generation) {
        await requestNetease('preferences', {activeProvider: selected});
        alive(ticket);
      }
      // Browsing that started while verification was pending still belongs to
      // the previous committed account and must expire at this boundary.
      generation++;
      cached = pending = null;
      selected = source; profile = result.profile; spotifyWeb = result.webPlayer===true; verifiedAt = now();
      onChange(result);
      return result;
    });
    commits = commit.catch(() => {});
    return commit;
  }
  async function home(source, payload = {}) {
    const ticket = generation;
    if (cached && cached.provider === source && now() - cached.at < 30000 && !payload.refreshPlaylists) return structuredClone(cached.value);
    if (pending?.provider === source) return pending.promise;
    const promise = (async () => {
      if (!profile || now() - verifiedAt > 60000) {
        const value = await verify(source, ticket); profile = value.profile; spotifyWeb = value.webPlayer===true; verifiedAt = now();
      }
      if (source === 'spotify' && platformStatus && spotifyWeb) {
        const saved = await requestNetease('preferences', {});
        alive(ticket);
        return {provider: source, profile, webPlayer: true, webAuthenticated: true,
          songs: [], cards: [], playlists: [], recent: [], preferences: saved.preferences,
          discoveryModes: [], recommendationMode: 'official-web'};
      }
      let result;
      try {
        result = await requestPlatform({provider: source, action: 'home', refresh: payload.refreshPlaylists === true});
      } catch (error) {
        alive(ticket);
      }
      // Older adapters can still serve their library when a recommendation
      // endpoint is unavailable. Keep every row bound to the selected platform.
      if (!Array.isArray(result?.playlists)) {
        result = await requestPlatform({provider: source, action: 'playlists'});
      }
      alive(ticket);
      const ownedRows = (rows, limit) => (Array.isArray(rows) ? rows : [])
        .filter(item => String(item?.id || '').startsWith(source + ':')).slice(0, limit);
      const playlists = ownedRows(result.playlists, 100);
      let songs = ownedRows(result.songs, 50);
      if (!songs.length) {
        // Empty built-in or private lists must not leave the whole home empty.
        for (const list of playlists.slice(0, 4)) {
          try {
            const tracks = await requestPlatform({provider: source, action: 'playlist', id: list.id, limit: 30});
            alive(ticket);
            const unique = new Map([...songs, ...ownedRows(tracks.songs, 30)].map(song => [song.id, song]));
            songs = [...unique.values()].slice(0, 50);
            if (songs.length >= 30) break;
          } catch (error) {alive(ticket);}
        }
      }
      const [saved, listening] = await Promise.all([requestNetease('preferences', {}), requestNetease('listening', {})]);
      alive(ticket);
      const cards = ownedRows(result.cards, 530);
      const value = {provider: source, profile, songs, cards: cards.length ? cards : songs, playlists, recent: [], preferences: saved.preferences, listening,
        discoveryModes: Array.isArray(result.discoveryModes) ? result.discoveryModes : [],
        discoveryLabels: result.discoveryLabels || {},
        recommendationMode: result.recommendationMode || 'library',
        recommendationLabel: result.recommendationLabel || LABELS[source] + ' · 我的歌单'};
      cached = {provider: source, at: now(), value};
      return structuredClone(value);
    })();
    pending = {provider: source, promise};
    try {return await promise;} finally {if (pending?.promise === promise) pending = null;}
  }
  async function request(action, payload = {}) {
    const source = await provider(), ticket = generation;
    if (source === 'netease') {
      const result = await requestNetease(action, payload);
      alive(ticket);
      return result;
    }
    if (action === 'home') return home(source, payload);
    if (action === 'deck') {const result = await home(source); return {provider: source, cards: result.cards};}
    if (action === 'discovery') {
      const result = await requestPlatform({...payload, provider: source, action});
      alive(ticket);
      return {...result, songs: (result.songs || []).filter(song => String(song?.id || '').startsWith(source + ':'))};
    }
    const result = await requestPlatform({...payload, provider: source, action: action === 'userPlaylists' ? 'playlists' : action});
    alive(ticket);
    return result;
  }
  function invalidate(source) {
    if (source === selected) {generation++; profile = null; verifiedAt = -Infinity; cached = pending = null; onChange({provider: selected, profile: null, apiConnected: false});}
  }
  return {state, select, request, invalidate, dispose() {disposed = true; generation++; cached = pending = null; profile = null; return commits;}};
}

module.exports = {createProviderWorkspace, PROVIDERS};
