'use strict';

// Adapted from MineRadio's handleKugouGuessLike (GPL-3.0-only).
// Reuse the account core's gateway signing and track projection.
const {createHash} = require('node:crypto');
const APP_ID = 1005;
const CLIENT_VERSION = 20489;
const ANDROID_SALT = 'OIlwieks28dk2k092lksi2UIkp';
const PUBLIC_HEADERS = {'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kugou.com/'};

function embeddedTracks(html) {
  if (typeof html !== 'string' || html.length > 1024 * 1024) throw new Error('酷狗公开歌单响应无效');
  const marker = /var\s+data\s*=\s*\[/.exec(html);
  if (!marker) throw new Error('酷狗公开歌单未返回歌曲数据');
  const start = marker.index + marker[0].length - 1;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '[') depth++;
    else if (character === ']' && --depth === 0) return JSON.parse(html.slice(start, index + 1));
  }
  throw new Error('酷狗公开歌单数据不完整');
}

function createKugouDiscovery({core, getCookie, requestText, now = Date.now}) {
  const publicMetadata = new Map();
  function tracks(items, limit) {
    const unique = new Map();
    for (const item of items.slice(0, 1000)) {
      const song = core.mapKugouPlaylistTrack(item);
      const id = String(song.hash || song.id || '').toLowerCase();
      if (song.name && /^[a-f0-9]{32}$/.test(id) && !unique.has(id)) unique.set(id, song);
    }
    return [...unique.values()].slice(0, limit);
  }
  async function recommend(limit = 20) {
    const size = Math.max(1, Math.min(20, Math.floor(Number(limit) || 20)));
    const cookie = await getCookie();
    const auth = core.extractKugouAuth(cookie);
    if (!auth.playbackReady) throw new Error('请先登录酷狗音乐以获取个人推荐');

    const clienttime = now();
    const result = await core.kugouGatewayRequest('/v1/app_song_list_offset', {
      cookie,
      method: 'POST',
      router: 'fm.service.kugou.com',
      body: {
        appid: APP_ID,
        area_code: 1,
        clienttime,
        clientver: CLIENT_VERSION,
        data: [{fmid: '0', fmtype: 2, offset: -1, size, singername: ''}],
        get_tracker: 1,
        key: createHash('md5')
          .update(`${APP_ID}${CLIENT_VERSION}${clienttime}${ANDROID_SALT}`)
          .digest('hex'),
        mid: auth.mid,
        uid: Number(auth.userid),
      },
    });
    const data = result?.data;
    const candidates = [data?.info, data?.song_list, data?.songs, data?.list, data?.songlist, result?.info, result?.list];
    const items = candidates.find(value => Array.isArray(value) && value.length) || [];
    return tracks(items, size);
  }

  async function publicPlaylists(limit = 18) {
    const body = await requestText('https://m.kugou.com/plist/index&json=true', {headers: PUBLIC_HEADERS});
    const result = JSON.parse(body);
    const items = result?.plist?.list?.info;
    if (!Array.isArray(items)) throw new Error('酷狗热门歌单暂未返回');
    const playlists = items.slice(0, Math.max(1, Math.min(30, Number(limit) || 18)))
      .filter(item => /^\d{1,20}$/.test(String(item.specialid || '')))
      .map(item => ({
        listId: 'public_' + item.specialid,
        id: 'public_' + item.specialid,
        name: String(item.specialname || '').slice(0, 160),
        cover: String(item.imgurl || '').replace(/\{size\}/g, '384'),
        trackCount: Math.max(0, Number(item.songcount) || 0),
        playCount: Math.max(0, Number(item.playcount) || 0),
      })).filter(item => item.name);
    publicMetadata.clear();
    for (const item of playlists) publicMetadata.set(item.id, item);
    return playlists;
  }

  async function publicPlaylist(id, {offset = 0, limit = 50} = {}) {
    const match = /^public_(\d{1,20})$/.exec(String(id || ''));
    if (!match) throw new Error('无效的酷狗公开歌单');
    const html = await requestText(`https://www.kugou.com/yy/special/single/${match[1]}.html`, {headers: PUBLIC_HEADERS});
    // This is a JSON array in the official page. Never evaluate page scripts.
    const items = embeddedTracks(html).filter(item => item && typeof item === 'object').map(item => ({
      ...item,
      name: item.songname || item.audio_name || item.name || item.filename,
      SingerName: item.author_name || item.singername || item.SingerName,
      cover: item.cover || item.img || item.trans_param?.union_cover || publicMetadata.get(id)?.cover || '',
      duration: (Number(item.timelength || item.duration) || 0) / 1000,
      HQFileHash: item.hash_320 || item['320hash'],
      SQFileHash: item.hash_flac || item.sqhash,
      ResFileHash: item.hash_high,
    }));
    const songs = tracks(items, 1000);
    const start = Math.max(0, Math.min(1000, Math.floor(Number(offset) || 0)));
    const size = Math.max(1, Math.min(50, Math.floor(Number(limit) || 50)));
    return {
      playlist: publicMetadata.get(id) || {listId: id, id, name: '酷狗热门歌单'},
      songs: songs.slice(start, start + size),
      total: songs.length,
      offset: start,
      nextOffset: Math.min(start + size, songs.length),
      hasMore: start + size < songs.length,
    };
  }

  return {recommend, publicPlaylists, publicPlaylist};
}

module.exports = {createKugouDiscovery};
