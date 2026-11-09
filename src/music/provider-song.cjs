'use strict';

const {imageURL} = require('./media-policy.cjs');
const FORMATS = {qq: /^[A-Za-z0-9]{1,64}$/, kugou: /^[a-fA-F0-9]{32}$/, qishui:/^[A-Za-z0-9_-]{1,90}$/, spotify:/^[A-Za-z0-9]{22}$/};
function providerKey(value) {
  const match = /^(qq|kugou|qishui|spotify):(.+)$/.exec(String(value || ''));
  return match && FORMATS[match[1]].test(match[2]) ? {provider: match[1], id: match[2]} : null;
}
function providerSong(input) {
  if (!input || typeof input !== 'object') return null;
  const key = providerKey(input.id);
  if (!key || (input.source && input.source !== key.provider) || (input.provider && input.provider !== key.provider)) return null;
  const clean = (value, limit = 160) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, limit) : '';
  const title = clean(input.title || input.name);
  if (!title) return null;
  const song = {id: key.provider + ':' + key.id, title, artist: clean(input.artist) || '未知歌手', duration: Math.max(0, Math.min(86400, Number(input.duration) || 0)), source: key.provider, provider: key.provider, providerId: key.id};
  const cover = imageURL(input.coverURL);
  if (cover) song.coverURL = cover.href;
  const album = clean(input.album);
  if (album) song.album = album;
  if (typeof input.liked === 'boolean') song.liked = input.liked;
  if (key.provider === 'spotify' && typeof input.browserRoute === 'string' && /^\/(?:playlist\/[A-Za-z0-9]{22}|collection\/tracks|search\/[^?#]{1,500})$/.test(input.browserRoute)) song.browserRoute = input.browserRoute;
  if(key.provider==='spotify'&&Number.isSafeInteger(input.browserRow)&&input.browserRow>0&&input.browserRow<=10002)song.browserRow=input.browserRow;
  if(key.provider==='qq'&&/^[A-Za-z0-9]{1,64}$/.test(String(input.mediaMid||'')))song.mediaMid=String(input.mediaMid);
  if(key.provider==='kugou'){
    for(const field of ['albumId','albumAudioId'])if(/^\d{1,20}$/.test(String(input[field]||'')))song[field]=String(input[field]);
    for(const field of ['hqHash','sqHash','resHash'])if(/^[a-fA-F0-9]{32}$/.test(String(input[field]||'')))song[field]=String(input[field]);
  }
  return song;
}
module.exports = {providerKey, providerSong};
