/* GPL-3.0-only. Adapted from MineRadio kugou-api.js favorites operations. */
'use strict';
const {confirmFavorite} = require('./favorite-confirmation.cjs');

function createKugouFavorites({core, getCookie}) {
  async function read(hash, cookie) {
    const library = await core.handleKugouUserPlaylists(cookie);
    if (!library.libraryReady) throw new Error('酷狗收藏歌单暂时无法读取');
    const list = library.playlists.find(item => /我喜欢|liked music|my favorites?/i.test(item.name));
    if (!list?.listId) throw new Error('酷狗未返回“我喜欢”歌单');
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const value = await core.handleKugouPlaylistTracks(list.listId, cookie, {paged:true,limit:50,offset});
      if (value.error || !Array.isArray(value.tracks)) throw new Error('酷狗收藏状态暂时无法确认');
      const track = value.tracks.find(item => String(item.hash || item.id).toLowerCase() === hash);
      if (track) return {liked:true,listId:list.listId,fileId:track.fileId};
      if (!value.hasMore) return {liked:false,listId:list.listId};
      if (!value.tracks.length) break;
      offset += value.tracks.length;
    }
    throw new Error('酷狗收藏列表较长，尚未确认此歌曲的状态，请稍后重试');
  }
  async function like({id, liked, toggle = false, song = {}}) {
    const hash = String(id || '').replace(/^kugou:/,'').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(hash)) throw new Error('无效的酷狗歌曲');
    const cookie = await getCookie(), auth = core.extractKugouAuth(cookie);
    if (!auth.playbackReady) throw new Error('请先登录酷狗音乐');
    const actual = await confirmFavorite({liked,toggle,read:() => read(hash,cookie),write:async (desired,state) => {
      const body = {userid:Number(auth.userid),token:auth.token,listid:Number(state.listId),list_ver:0,type:0};
      if (desired) {
        if (!song.title) throw new Error('酷狗曲目信息不完整，请重新打开歌曲');
        Object.assign(body,{slow_upload:1,scene:'false;null',data:[{number:1,name:song.title,hash,size:0,sort:0,timelen:Math.round((Number(song.duration)||0)*1000),bitrate:0,album_id:Number(song.albumId)||0,mixsongid:Number(song.albumAudioId)||0}]});
      } else {
        if (!/^\d+$/.test(String(state.fileId || ''))) throw new Error('酷狗未返回收藏条目标识，未移除歌曲');
        body.data = [{fileid:Number(state.fileId)}];
      }
      const response = await core.kugouH5GatewayRequest(desired ? '/v6/add_song' : '/v4/delete_songs',{
        method:'POST',cookie,router:'cloudlist.service.kugou.com',
        ...(desired ? {params:{last_time:Math.floor(Date.now()/1000),last_area:'gztx',userid:auth.userid,token:auth.token}} : {}),body,
      });
      if (Number(response?.status) !== 1) throw new Error('酷狗未确认收藏写入，请刷新后重试');
    }});
    return {provider:'kugou',id:'kugou:'+hash,liked:actual};
  }
  return {like,state:async id => read(String(id).replace(/^kugou:/,'').toLowerCase(),await getCookie())};
}
module.exports = {createKugouFavorites};
