'use strict';
const {authError, publicProfile} = require('./netease.cjs');
const {createDiscovery}=require('./discovery.cjs');
function text(value, max = 160) { return typeof value === 'string' ? value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim().slice(0, max) : ''; }
function id(value) { const string = String(value ?? ''); return /^[1-9]\d{0,15}$/.test(string) && Number.isSafeInteger(Number(string)) ? string : null; }
function image(value) {
  try { const url = new URL(value); if (url.protocol === 'http:') url.protocol = 'https:'; return url.protocol === 'https:' && !url.username && !url.password && !url.port && /^(?:p\d+|p\d+c)\.music\.126\.net$/.test(url.hostname) && url.href.length <= 2048 ? url.href : undefined; } catch { return undefined; }
}
function song(value) {
  if (!value || typeof value !== 'object') return null;
  if (String(value.id || '').includes(':')) return require('./provider-song.cjs').providerSong(value);
  const nested = value.song || value, key = id(nested.id ?? value.id), title = text(nested.name || nested.title || value.name);
  if (!key || !title) return null;
  const sourceArtists = nested.ar || nested.artists, artists = Array.isArray(sourceArtists) ? sourceArtists : [], album = nested.al || nested.album || {};
  const artist = text(typeof nested.artist === 'string' ? nested.artist : artists.slice(0, 8).map(value => text(value?.name, 80)).filter(Boolean).join(' / ')) || '未知歌手';
  const ms = Number(nested.dt ?? nested.duration), seconds = Number.isFinite(ms) ? Math.max(0, Math.min(86400, ms / 1000)) : 0;
  const result = {id: key, title, artist, duration: seconds};
  const albumName = text(typeof nested.album === 'string' ? nested.album : album.name); if (albumName) result.album = albumName;
  const cover = image(nested.coverURL || album.picUrl || value.picUrl); if (cover) result.coverURL = cover;
  // Persisted canonical songs express seconds, while upstream uses ms.
  if (nested.title && nested.artist && Number.isFinite(Number(nested.duration))) result.duration = Math.max(0, Math.min(86400, Number(nested.duration)));
  if (typeof nested.liked === 'boolean') result.liked = nested.liked;
  return result;
}
function playlist(value, subtitle = '') {
  if (!value || typeof value !== 'object') return null;
  const key = id(value.id), title = text(value.name || value.title); if (!key || !title) return null;
  const coverURL = image(value.picUrl || value.coverImgUrl || value.coverURL);
  return {id: key, title, ...(coverURL ? {coverURL} : {}),...(Number.isFinite(Number(value.playCount))&&Number(value.playCount)>0?{playCount:Math.floor(Number(value.playCount))}:{}), subtitle: text(subtitle || value.copywriter || value.description || value.subtitle, 100)};
}
const clone = value => structuredClone(value);
const beijingDay=at=>new Date(at+8*3600000).toISOString().slice(0,10);
const MODE_PLAYLIST=/每日推荐|私人雷达|私人漫游|私人FM|心动模式|相似歌曲|我喜欢的音乐/;
function independentPlaylists(values,excluded=[],limit=18){const blocked=new Set(excluded.filter(Boolean).map(String)),seen=new Set();return (Array.isArray(values)?values:[]).map(value=>playlist(value,Number(value?.playCount)>0?'高播放精选':'精选歌单')).filter(value=>value&&!MODE_PLAYLIST.test(value.title)&&!blocked.has(value.id)&&!seen.has(value.id)&&seen.add(value.id)).sort((a,b)=>(b.playCount||0)-(a.playCount||0)).slice(0,limit);}
const orderedSongs=values=>[...new Map(values.filter(Boolean).map(value=>[value.id,value])).values()];
function createCatalog({client, getAuth, now = Date.now,random=Math.random} = {}) {
  const known = new Map(), memo = new Map(), operations = new Map(), liked = new Map(), playlistPages = new Map();
  const hot=require('./hot-playlists.cjs').createHotPlaylists({loadPage:options=>typeof client.topPlaylists==='function'?client.topPlaylists(options):Promise.resolve({body:{code:200,playlists:[]}}),normalize:independentPlaylists,now,random});
  let epoch = 0, disposed = false;
  const bounded = (map, key, value, max) => { map.delete(key); map.set(key, value); while (map.size > max) map.delete(map.keys().next().value); return value; };
  function remember(values) { return values.filter(Boolean).map(value => { const normalized = liked.has(value.id) ? {...value, liked: liked.get(value.id)} : value; bounded(known, value.id, normalized, 300); return {...normalized}; }); }
  function require200(result, message = '网易云暂时无法提供这些音乐，请稍后重试') { if (Number(result?.body?.code) !== 200) throw authError('CONTENT_UNAVAILABLE', message); return result.body; }
  async function context(kind, task, {supersede = false} = {}) {
    if (disposed) throw authError('CANCELLED', '音乐模块已关闭');
    if (supersede) for (const operation of operations.values()) if (operation.kind === kind) operation.controller.abort();
    const controller = new AbortController(), token = {}, ticket = epoch, auth = getAuth();
    let complete; const settled = new Promise(resolve => {complete = resolve;});
    operations.set(token, {kind, controller, settled});
    const options = {signal: controller.signal, cookie: auth.state === 'signedIn' ? auth.cookie : {}};
    try {
      const result = await task(options, auth);
      if (disposed || ticket !== epoch || controller.signal.aborted) throw authError('CANCELLED', '音乐操作已取消');
      return result;
    } finally { operations.delete(token); complete(); }
  }
  function cached(key, ttl = 5 * 60000) { const entry = memo.get(key); return entry && now() - entry.at < ttl ? clone(entry.value) : null; }
  function save(key, value) { bounded(memo, key, {at: now(), value: clone(value)}, 30); return value; }
  async function withLikes(values, options) {
    if (getAuth().state !== 'signedIn' || !values.length || typeof client.likes !== 'function') return values;
    try {
      const body = require200(await client.likes(values.map(value => value.id), options)), data = body.data || body.ids;
      if (options.signal.aborted) throw authError('CANCELLED', '音乐操作已取消');
      if (Array.isArray(data) && data.every(value => id(value))) {
        const set = new Set(data.map(String)); for (const value of values) bounded(liked, value.id, set.has(value.id), 300);
      } else if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const value of values) if (typeof data[value.id] === 'boolean') bounded(liked, value.id, data[value.id], 300);
      }
    } catch (error) { if (options.signal.aborted) throw error; }
    return remember(values);
  }
  async function home(payload={}) {
    const auth = getAuth(), mode = auth.state === 'signedIn' ? 'personal' : 'public', key = `home:${mode}:${auth.profile?.userId || 0}:${beijingDay(now())}`;
    const hit = cached(key); if (hit) { remember(hit.songs);if(payload.refreshPlaylists===true)return context('hotPlaylists',async options=>{const value={...hit,playlists:await hot.select({options,excluded:[hit.radarPlaylist?.id],fallback:hit.playlists,refresh:true})},entry=memo.get(key);if(entry)entry.value=clone(value);return value;});return hit; }
    return context('home', async (options) => {
      const [dailyResult, resourceResult] = await Promise.allSettled([
        client.dailySongs(options), mode === 'personal' ? client.dailyPlaylists(options) : client.publicPlaylists(options)
      ]);
      if (options.signal.aborted) throw authError('CANCELLED', '音乐操作已取消');
      let songs = [], lists = [], radarPlaylist=null, recommendationMode = mode, recommendationLabel = mode === 'personal' ? '每日推荐' : '公开每日推荐';
      if (dailyResult.status === 'fulfilled' && Number(dailyResult.value.body.code) === 200) songs = remember((dailyResult.value.body.data?.dailySongs || dailyResult.value.body.recommend || []).slice(0, 30).map(song));
      if (!songs.length) { const fallback = require200(await client.publicSongs(options)); songs = remember((fallback.result || []).slice(0, 30).map(song)); recommendationMode = 'public'; recommendationLabel = '公开新歌推荐'; }
      if (resourceResult.status === 'fulfilled' && Number(resourceResult.value.body.code) === 200) {
        const resources=(resourceResult.value.body.recommend || resourceResult.value.body.result || []).slice(0,30);
        if(mode==='personal')radarPlaylist=playlist(resources.find(value=>/私人雷达/.test(text(value.name))));
        lists=resources.slice(0,8).map(value=>playlist(value,mode==='personal'?'为你推荐':'公开推荐歌单')).filter(Boolean);
      }
      if (!lists.length && mode === 'personal') { try { const body = require200(await client.publicPlaylists(options)); lists = (body.result || []).slice(0, 8).map(value => playlist(value, '公开推荐歌单')).filter(Boolean); } catch (error) { if (options.signal.aborted) throw error; } }
      const excluded=[radarPlaylist?.id];
      lists=await hot.select({options,excluded,fallback:lists,refresh:true});
      if (!songs.length && !lists.length) throw authError('CONTENT_UNAVAILABLE', '暂时没有可用推荐，请稍后重试');
      songs = await withLikes(songs, options);
      return save(key, {cards:orderedSongs(songs), songs, playlists: lists, recommendationMode, recommendationLabel,...(radarPlaylist?{radarPlaylist}:{})});
    });
  }
  async function deck(){
    const auth=getAuth(),mode=auth.state==='signedIn'?'personal':'public',key=`deck:${mode}:${auth.profile?.userId||0}:${beijingDay(now())}`;
    const hit=cached(key);if(hit){remember(hit.cards);return hit;}
    return context('deck',async options=>{
      const daily=await home(),first=orderedSongs(daily.songs).slice(0,30);
      if(options.signal.aborted)throw authError('CANCELLED','音乐操作已取消');
      let radar=[],message='',radarError=null;
      if(mode==='personal'&&daily.radarPlaylist?.id){
        try{radar=await completeRadarSongs(daily.radarPlaylist.id,options);}
        catch(error){if(options.signal.aborted)throw error;radarError=error.code||'CONTENT_UNAVAILABLE';message=error.code==='RADAR_TOO_LARGE'?'私人雷达歌曲数量过多，暂时无法完整载入；当前保留每日推荐队列。':error.code==='RADAR_INCOMPLETE'?'私人雷达部分歌曲暂时无法完整读取；当前保留每日推荐队列。':'私人雷达暂时无法读取，当前保留完整每日推荐队列。';}
      }else if(mode==='personal')message='当前账号未返回“私人雷达”专属歌单，当前保留完整每日推荐队列。';
      const cards=orderedSongs([...first,...radar]);
      return save(key,{cards,dailyCount:first.length,radarCount:Math.max(0,cards.length-first.length),label:daily.recommendationLabel,day:beijingDay(now()),...(radarError?{radarError}:{}),...(message?{message}:{})});
    },{supersede:true});
  }
  async function search(payload = {}) {
    const query = text(payload.query, 100); if (!query) return {songs: [], playlists: []};
    const key = 'search:' + query, hit = cached(key); if (hit) { remember(hit.songs); return hit; }
    return context('search', async options => {
      const values = await Promise.allSettled([client.search(query, 1, options), client.search(query, 1000, options)]);
      if (options.signal.aborted) throw authError('CANCELLED', '音乐操作已取消');
      let songs = values[0].status === 'fulfilled' && Number(values[0].value.body.code) === 200 ? remember((values[0].value.body.result?.songs || []).slice(0, 30).map(song)) : [];
      const playlists = values[1].status === 'fulfilled' && Number(values[1].value.body.code) === 200 ? (values[1].value.body.result?.playlists || []).slice(0, 6).map(value => playlist(value)).filter(Boolean) : [];
      if (values.every(value => value.status === 'rejected' || Number(value.value?.body?.code) !== 200)) throw authError('CONTENT_UNAVAILABLE', '搜索暂时不可用，请稍后重试');
      songs = await withLikes(songs, options);
      return save(key, {songs, playlists});
    }, {supersede: true});
  }
  async function details(key, options) {
    key = id(key); if (!key) throw authError('INVALID_SONG', '歌曲编号无效');
    const existing = known.get(key); if (existing) return {...existing};
    const body = require200(await client.songs([key], options));
    const value = remember((body.songs || []).slice(0, 1).map(song))[0];
    if (!value || value.id !== key) throw authError('CONTENT_UNAVAILABLE', '找不到这首歌曲');
    return (await withLikes([value], options))[0];
  }
  // The visual deck needs the actual whole radar sequence, not the first
  // playlist page. Hydrate IDs in bounded batches; no audio/images are fetched.
  async function completeRadarSongs(key,options){
    const raw=require200(await client.playlist(key,options)).playlist;
    if(!raw)throw authError('RADAR_INCOMPLETE','私人雷达未返回完整歌单');
    const tracks=Array.isArray(raw.tracks)?raw.tracks:[],trackIds=Array.isArray(raw.trackIds)?raw.trackIds:[],total=Number(raw.trackCount)||0;
    if(total>500||tracks.length>500||trackIds.length>500)throw authError('RADAR_TOO_LARGE','私人雷达歌曲数量超过载入上限');
    const ordered=trackIds.length?trackIds.map(value=>id(value?.id)):tracks.map(value=>id(value?.id));
    if(ordered.some(value=>!value)||total>ordered.length)throw authError('RADAR_INCOMPLETE','私人雷达歌曲顺序未完整返回');
    const ids=[...new Set(ordered)],byId=new Map(tracks.map(song).filter(Boolean).map(value=>[value.id,value]));
    const missing=ids.filter(key=>!byId.has(key));
    for(let offset=0;offset<missing.length;offset+=30){
      if(options.signal.aborted)throw authError('CANCELLED','音乐操作已取消');
      const chunk=missing.slice(offset,offset+30),expected=new Set(chunk),body=require200(await client.songs(chunk,options));
      if(options.signal.aborted)throw authError('CANCELLED','音乐操作已取消');
      for(const value of (Array.isArray(body.songs)?body.songs:[]).slice(0,30).map(song).filter(Boolean))if(expected.has(value.id))byId.set(value.id,value);
    }
    if(ids.some(key=>!byId.has(key)))throw authError('RADAR_INCOMPLETE','私人雷达部分歌曲未完整返回');
    return remember(ids.map(key=>byId.get(key)));
  }
  async function playlistContent(key,options,payload={}){
    let entry=playlistPages.get(key),raw;
    if(entry&&now()-entry.at<60000)raw=entry.value;
    else{raw=require200(await client.playlist(key,options)).playlist;if(options.signal.aborted)throw authError('CANCELLED','歌单读取已取消');if(raw)bounded(playlistPages,key,{at:now(),value:raw},2);}
    if (!raw) throw authError('CONTENT_UNAVAILABLE', '该歌单暂不可用');
    const offset=Math.min(10000,Math.max(0,Math.floor(Number(payload.offset)||0))),limit=Math.min(30,Math.max(1,Math.floor(Number(payload.limit)||30)));
    const tracks=Array.isArray(raw.tracks)?raw.tracks:[],ids=Array.isArray(raw.trackIds)&&raw.trackIds.length?raw.trackIds.map(value=>id(value?.id)):tracks.map(value=>id(value?.id));
    const total=Math.max(ids.length,Math.max(0,Math.floor(Number(raw.trackCount)||0))),window=ids.slice(offset,offset+limit),keys=window.filter(Boolean),byId=new Map(tracks.map(song).filter(Boolean).map(value=>[value.id,value]));
    if(offset>=ids.length&&total>ids.length)throw authError('PLAYLIST_INCOMPLETE','来源未完整返回歌单歌曲，暂时无法继续加载');
    const missing=keys.filter(key=>!byId.has(key));
    if(missing.length){const response=require200(await client.songs(missing,options));for(const value of (Array.isArray(response.songs)?response.songs:[]).slice(0,30).map(song).filter(Boolean))byId.set(value.id,value);}
    let songs=remember(keys.map(key=>byId.get(key)).filter(Boolean));
    songs = await withLikes(songs, options);
    const nextOffset=offset+window.length;
    return {playlist: {...playlist(raw),trackCount:total},songs,total,nextOffset,hasMore:window.length>0&&nextOffset<total};
  }
  async function getPlaylist(payload = {}) {
    const key = id(payload.id); if (!key) throw authError('INVALID_PLAYLIST', '歌单编号无效');
    return context('playlist', options=>playlistContent(key,options,payload), {supersede:true});
  }
  function requireLogin(auth){if(auth.state!=='signedIn'||!id(auth.profile?.userId))throw authError('LOGIN_REQUIRED','请先登录网易云音乐，再使用此私人推荐功能');}
  const cleanSongs=values=>remember((Array.isArray(values)?values:[]).slice(0,30).map(value=>song(value?.songInfo||value)).filter(Boolean));
  const discoveryContext=(mode,payload,task)=>context(payload?.preview===true?'discovery-preview:'+mode:'discovery',task,{supersede:true});
  const discovery=createDiscovery({providers:{netease:{
    daily:payload=>discoveryContext('daily',payload,async()=>{const result=await home();return {songs:result.songs,playlists:result.playlists,label:result.recommendationLabel};}),
    radar:payload=>discoveryContext('radar',payload,async(options,auth)=>{
      requireLogin(auth);const body=require200(await client.dailyPlaylists(options));
      const list=(body.recommend||body.result||[]).slice(0,30).filter(value=>id(value.id));
      const exact=list.find(value=>/私人雷达/.test(text(value.name))),selected=exact;
      if(!selected)throw authError('RADAR_UNAVAILABLE','当前账号未返回“私人雷达”专属歌单，不能用普通歌单代替。请稍后重试。');
      const result=await playlistContent(id(selected.id),options);
      return {...result,playlists:result.playlist?[result.playlist]:[],label:exact?'私人雷达':'官方推荐歌单',...(!exact?{message:'当前账号未返回“私人雷达”专属歌单，已展示网易云官方推荐歌单。'}:{})};
    }),
    fm:payload=>discoveryContext('fm',payload,async(options,auth)=>{
      requireLogin(auth);const body=require200(await client.personalFM(options)),songs=await withLikes(cleanSongs(body.data),options);
      if(!songs.length)throw authError('CONTENT_UNAVAILABLE','私人漫游暂时没有返回歌曲，请稍后再试');
      return {songs,playlists:[],label:'私人漫游'};
    }),
    heart:payload=>discoveryContext('heart',payload,async(options,auth)=>{
      requireLogin(auth);const library=require200(await client.userPlaylists(auth.profile.userId,options));
      const values=(library.playlist||[]).slice(0,30),favorite=values.find(value=>Number(value.specialType)===5&&id(value.id))||values.find(value=>String(value.creator?.userId)===String(auth.profile.userId)&&/喜欢/.test(text(value.name))&&id(value.id));
      if(!favorite)throw authError('CONTENT_UNAVAILABLE','当前账号未返回“我喜欢的音乐”歌单，暂时无法开启心动模式');
      const selected=await playlistContent(id(favorite.id),options),seed=id(payload.seedId)||selected.songs[0]?.id;
      if(!seed)throw authError('SEED_REQUIRED','请先收藏或选择一首歌曲，再开启心动模式');
      const body=require200(await client.intelligence(seed,id(favorite.id),options),'心动模式暂时不可用，请稍后再试'),songs=await withLikes(cleanSongs(body.data),options);
      if(!songs.length)throw authError('CONTENT_UNAVAILABLE','心动模式暂时没有返回歌曲，请稍后再试');
      return {songs,playlists:[],label:'心动模式'};
    }),
    similar:payload=>discoveryContext('similar',payload,async options=>{
      let seed=id(payload.seedId);if(payload.seedId!==undefined&&!seed)throw authError('SEED_REQUIRED','歌曲编号无效，请重新选择歌曲');if(!seed)seed=(await home()).songs[0]?.id;if(!seed)throw authError('SEED_REQUIRED','当前没有可用歌曲，请先选择一首歌曲');
      const body=require200(await client.similarSongs(seed,options)),songs=await withLikes(cleanSongs(body.songs).filter(value=>value.id!==seed),options);
      if(!songs.length)throw authError('CONTENT_UNAVAILABLE','这首歌暂时没有返回相似歌曲，试试其他歌曲');
      return {songs,playlists:[],label:'相似歌曲'};
    })
  }}});
  async function comments(payload = {}) {
    const key = id(payload.id); if (!key) throw authError('INVALID_SONG', '歌曲编号无效');
    const offset = Math.min(1000, Math.max(0, Math.floor(Number(payload.offset) || 0)));
    return context('comments', async options => {
      const body = require200(await client.comments(key, offset, options));
      const raw = body.comments || [], values = raw.slice(0, 20).map(value => {
        const user = publicProfile(value.user), content = text(value.content, 1200); if (!content) return null;
        return {id: id(value.commentId) || '0', nickname: user?.nickname || text(value.user?.nickname, 80) || '网易云用户', ...(user?.avatarURL ? {avatarURL: user.avatarURL} : {}), content,
          time: Number.isFinite(Number(value.time)) ? Number(value.time) : 0, likedCount: Math.max(0, Math.floor(Number(value.likedCount) || 0))};
      }).filter(Boolean);
      return {comments: values, total: Math.max(0, Math.floor(Number(body.total) || 0)), hasMore: body.more === true};
    }, {supersede: true});
  }
  function inactive() { epoch++; for (const operation of operations.values()) operation.controller.abort(); }
  return {home, deck, search, discovery, playlist: getPlaylist, comments, details, context, require200, remember, lookup: key => known.get(String(key)),
    invalidatePlaylists(){playlistPages.clear();},
    markLiked(key, value) { bounded(liked, String(key), value, 300); const current = known.get(String(key)); if (current) known.set(String(key), {...current, liked: value}); memo.clear(); },
    inactive, authChanged() { inactive(); memo.clear();playlistPages.clear();hot.clear(); liked.clear(); for (const value of known.values()) delete value.liked; },
    async dispose() { const jobs = [...operations.values()].map(value => value.settled); disposed = true; inactive();hot.clear(); await Promise.allSettled(jobs); memo.clear(); playlistPages.clear(); known.clear(); liked.clear(); }};
}
module.exports = {createCatalog, song, playlist, image, id, text,independentPlaylists};
