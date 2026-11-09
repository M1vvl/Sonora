'use strict';
const {createCatalog, id, song:normalizeSong} = require('./catalog.cjs');
const {providerKey} = require('./provider-song.cjs');
const {createMusicState} = require('./state.cjs');
const {authError} = require('./netease.cjs');
const {QUALITY_OPTIONS,validQuality,normalizeQuality,describe}=require('./quality.cjs');
const {parseLyrics}=require('./lyrics.cjs');
function audioURL(value) {
  try { const url = new URL(value); if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && /^(?:m\d+|m\d+c)\.music\.126\.net$/.test(url.hostname) && url.href.length <= 8192 ? url.href : null;
  } catch { return null; }
}
function createPlayerService({client, getAuth, dataDir, now = Date.now, random} = {}) {
  const catalog = createCatalog({client, getAuth, now, random}), state = createMusicState(dataDir), issued = new Map();
  const library=require('./library.cjs').createLibrary({client,catalog,getAuth,now});
  let disposed = false;const lyricCache=new Map();
  function ensure() { if (disposed) throw authError('CANCELLED', '音乐模块已关闭'); }
  async function home(payload) { ensure(); const result = await catalog.home(payload), saved = state.get(); catalog.remember(saved.recent); return {...result, recent: saved.recent, preferences: saved.preferences,listening:state.listening(now())}; }
  async function play(payload = {}) {
    ensure(); const key = id(payload.id); if (!key) throw authError('INVALID_SONG', '歌曲编号无效');
    if(payload.source&&payload.source!=='netease')throw authError('SOURCE_UNAVAILABLE','该音乐平台尚未接通，当前使用网易云音源');
    if(payload.quality!==undefined&&!validQuality(payload.quality))throw authError('INVALID_QUALITY','不支持的音质档位');
    const requested=normalizeQuality(payload.quality||state.preferences().quality||'jyeffect');
    return catalog.context('play', async options => {
      const value=await catalog.details(key,options);
      const result=await require('./netease-playback.cjs').resolveNeteasePlayback({client,key,song:value,options,requested});
      const {track,url}=result;
      if (options.signal.aborted) throw authError('CANCELLED', '音乐操作已取消');
      const song = {...value},previous=issued.get(key); issued.delete(key); issued.set(key, {song, at: now(),lastProgress:previous?.lastProgress??now(),position:previous?.position??0}); while (issued.size > 100) issued.delete(issued.keys().next().value);
      if(payload.quality)state.preferences({quality:payload.quality});
      return {song, audioURL: url, playable: true,...describe(track,requested),...(result.matchedFromId?{resolvedSongId:result.resolvedSongId,matchedFromId:result.matchedFromId,matchKind:result.matchKind}:{})};
    }, {supersede: true});
  }
  async function lyrics(payload={}){
    ensure();const key=id(payload.id);if(!key)throw authError('INVALID_SONG','歌曲编号无效');
    const cached=lyricCache.get(key);if(cached&&now()-cached.at<1800000)return structuredClone(cached.value);
    return catalog.context('lyrics',async options=>{const body=catalog.require200(await client.lyrics(key,options),'歌词暂时无法读取'),value=parseLyrics(body);if(options.signal.aborted)throw authError('CANCELLED','音乐操作已取消');lyricCache.delete(key);lyricCache.set(key,{at:now(),value,bytes:Buffer.byteLength(JSON.stringify(value))});while(lyricCache.size>16||[...lyricCache.values()].reduce((sum,item)=>sum+item.bytes,0)>2*1024*1024)lyricCache.delete(lyricCache.keys().next().value);return value;},{supersede:true});
  }
  function playbackOptions(){ensure();return {source:'netease',quality:state.preferences().quality||'jyeffect',qualityOptions:QUALITY_OPTIONS,sources:[{id:'netease',label:'网易云音乐',available:true,current:true},...['qq','kugou','qishui','spotify'].map((id,index)=>({id,label:['QQ 音乐','酷狗音乐','汽水音乐','Spotify'][index],available:false,current:false}))]};}
  async function like(payload = {}) {
    ensure(); const auth = getAuth(), key = id(payload.id);
    const next = typeof payload.liked === 'boolean' ? payload.liked : payload.like;
    if (auth.state !== 'signedIn') throw authError('LOGIN_REQUIRED', '请先登录网易云音乐，再收藏歌曲');
    if (!key || typeof next !== 'boolean') throw authError('INVALID_LIKE', '请明确选择收藏或取消收藏');
    return catalog.context('like', async options => {
      catalog.require200(await client.like(key, next, options), '收藏未成功，请稍后重试');
      if (typeof client.likes === 'function') {
        let confirmed = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          if (attempt) await new Promise(resolve => setTimeout(resolve,300));
          if (options.signal.aborted) throw authError('CANCELLED', '音乐操作已取消');
          const body = catalog.require200(await client.likes([key],options),'暂时无法核实收藏状态');
          const data = body.data || body.ids;
          const actual = Array.isArray(data) ? data.map(String).includes(key) : typeof data?.[key] === 'boolean' ? data[key] : null;
          if (actual === next) {confirmed = true;break;}
        }
        if (!confirmed) throw authError('LIKE_UNCONFIRMED','网易云尚未确认收藏状态，请稍后重试');
      }
      if (options.signal.aborted) throw authError('CANCELLED', '音乐操作已取消');
      catalog.markLiked(key, next);
      library.clear();
      return {id: key, liked: next};
    });
  }
  function registerExternal(value) {
    ensure();
    const song = normalizeSong(value);
    if (!song || !providerKey(song.id)) throw authError('INVALID_SONG', '外部歌曲信息无效');
    issued.set(song.id, {song, at: now(), lastProgress: now(), position: 0});
    while (issued.size > 100) issued.delete(issued.keys().next().value);
  }
  function historyProgress(payload = {}) {
    ensure(); const key = providerKey(payload.id)?String(payload.id):id(payload.id), entry = issued.get(key), position = Number(payload.position), duration = Number(payload.duration);
    if (!entry || now() - entry.at > 24 * 3600000 || !Number.isFinite(position) || position < 0 || position > 86400) throw authError('INVALID_PROGRESS', '尚未开始播放，或播放进度无效');
    const total = Number.isFinite(duration) && duration > 0 && duration <= 86400 ? duration : entry.song.duration;
    if (total > 0 && position > total + 2) throw authError('INVALID_PROGRESS', '播放进度超出歌曲长度');
    const at=now(),wall=Math.max(0,(at-entry.lastProgress)/1000),reported=Number(payload.listenedSeconds),seconds=Number.isFinite(reported)?Math.max(0,Math.min(30,wall,reported)):Math.max(0,Math.min(30,wall,position-entry.position));
    const recent=state.progress(entry.song, Math.min(position, total || position), total, at,seconds);entry.lastProgress=at;entry.position=position;
    return {recent,listening:state.listening(at)};
  }
  return {registerExternal,home,deck:()=>{ensure();return catalog.deck();}, discovery:payload=>{ensure();return catalog.discovery(payload);},userPlaylists:payload=>{ensure();return library.userPlaylists(payload);},playlistAdd:payload=>{ensure();return library.playlistAdd(payload);}, play, like,lyrics,playbackOptions,listening(){ensure();return state.listening(now());}, historyProgress, search: payload => {ensure(); return catalog.search(payload);}, playlist: payload => {ensure(); return catalog.playlist(payload);}, comments: payload => {ensure(); return catalog.comments(payload);},
    preferences(payload) { ensure(); return {preferences: state.preferences(payload)}; }, inactive() {catalog.inactive();}, authChanged() { catalog.authChanged();library.clear(); issued.clear(); },
    async dispose() { disposed = true; await catalog.dispose();library.clear(); issued.clear();lyricCache.clear(); }};
}
module.exports = {createPlayerService, audioURL};
