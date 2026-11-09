/* GPL-3.0-only. Adapted from MineRadio qishui-api.js collection operations. */
'use strict';
const {confirmFavorite} = require('./favorite-confirmation.cjs');

function createQishuiFavorites({core}) {
  async function read(id, cookie) {
    core.invalidateQishuiLibraryCaches();
    const library = await core.fetchQishuiWebLibrary(cookie);
    const hit = (library.likedTracks || []).some(track => String(track.providerSongId || track.id) === id);
    if (hit) return {liked:true};
    if (!library.likedCard?.id) throw new Error('汽水未返回完整的“我喜欢”歌单');
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const value = await core.fetchQishuiWebPlaylistTracks(library.likedCard.id,cookie,{limit:50,offset});
      if (value.error || !Array.isArray(value.tracks)) throw new Error('汽水收藏状态暂时无法确认');
      if (value.tracks.some(track => String(track.providerSongId || track.id) === id)) return {liked:true};
      if (!value.hasMore) return {liked:false};
      if (!value.tracks.length) break;
      offset += value.tracks.length;
    }
    throw new Error('汽水收藏列表较长，尚未确认此歌曲的状态，请稍后重试');
  }
  async function like({id,liked,toggle = false},cookie,{isCurrent = () => true} = {}) {
    const key = String(id || '').replace(/^qishui:/,'');
    if (!/^[A-Za-z0-9_-]{1,90}$/.test(key)) throw new Error('无效的汽水歌曲');
    const check = () => {if (!isCurrent()) throw new Error('汽水账号已切换，收藏操作已取消');};
    const actual = await confirmFavorite({liked,toggle,read:async () => {check();const value = await read(key,cookie);check();return value;},write:async desired => {
      check();
      await core.qishuiPcPostJson(desired ? '/luna/pc/me/collection/media' : '/luna/pc/me/collection/media/delete',{
        media:[{type:'track',id:key}],scene:'',
      },cookie);
      core.invalidateQishuiLibraryCaches();
    }});
    return {provider:'qishui',id:'qishui:'+key,liked:actual};
  }
  return {like,state:read};
}
module.exports = {createQishuiFavorites};
