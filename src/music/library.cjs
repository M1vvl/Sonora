'use strict';
// Account library metadata and explicit single-song writes. The catalog owns
// cancellation/auth epochs; this module never sees disk credentials or audio.
const {id,playlist,text}=require('./catalog.cjs');
const {authError}=require('./netease.cjs');
function createLibrary({client,catalog,getAuth,now=Date.now}){
  const cache=new Map(),adds=new Map();
  function auth(){const value=getAuth();if(value.state!=='signedIn'||!id(value.profile?.userId))throw authError('LOGIN_REQUIRED','请先登录网易云音乐，再查看或收藏到歌单');return value;}
  function row(raw,userId){const value=playlist(raw);if(!value)return null;const owner=id(raw.creator?.userId),count=Number(raw.trackCount);return {...value,trackCount:Number.isFinite(count)?Math.max(0,Math.floor(count)):0,creator:text(raw.creator?.nickname,80),owned:owner===String(userId)};}
  async function userPlaylists(payload={}){
    const user=auth(),offset=Math.min(10000,Math.max(0,Math.floor(Number(payload.offset)||0))),limit=Math.min(30,Math.max(1,Math.floor(Number(payload.limit)||30))),key=user.profile.userId+':'+offset+':'+limit;
    const hit=cache.get(key);if(payload.refresh!==true&&hit&&now()-hit.at<60000)return structuredClone(hit.value);
    return catalog.context('library',async(options,current)=>{
      const body=catalog.require200(await client.userPlaylists(current.profile.userId,{...options,offset,limit}),'暂时无法读取账号歌单，请稍后重试'),raw=Array.isArray(body.playlist)?body.playlist.slice(0,limit):[],seen=new Set();
      if(options.signal.aborted)throw authError('CANCELLED','音乐操作已取消');
      const playlists=raw.map(value=>row(value,current.profile.userId)).filter(value=>value&&!seen.has(value.id)&&seen.add(value.id)),nextOffset=offset+raw.length;
      const value={playlists,nextOffset,hasMore:raw.length>0&&(body.more===true||(body.more!==false&&raw.length>=limit))};
      cache.delete(key);cache.set(key,{at:now(),value:structuredClone(value)});while(cache.size>8)cache.delete(cache.keys().next().value);return value;
    },{supersede:true});
  }
  function playlistAdd(payload={}){
    const user=auth(),playlistId=id(payload.playlistId),songId=id(payload.id);
    if(!playlistId||!songId)throw authError('INVALID_PLAYLIST','请选择有效的歌曲与目标歌单');
    const key=user.profile.userId+':'+playlistId+':'+songId;if(adds.has(key))return adds.get(key);if(adds.size>=8)throw authError('BUSY','添加歌曲请求较多，请稍后重试');
    const job=catalog.context('playlistAdd',async(options,current)=>{
      const body=catalog.require200(await client.playlist(playlistId,options),'暂时无法核实目标歌单'),target=body.playlist;
      if(!target||id(target.id)!==playlistId||id(target.creator?.userId)!==String(current.profile.userId))throw authError('PLAYLIST_NOT_OWNED','只能添加到当前账号创建的歌单');
      if(options.signal.aborted||getAuth().state!=='signedIn'||String(getAuth().profile?.userId)!==String(current.profile.userId))throw authError('CANCELLED','音乐操作已取消');
      catalog.require200(await client.playlistAdd(playlistId,songId,options),'添加歌曲未成功，可能已在歌单中或暂无编辑权限');
      cache.clear();catalog.invalidatePlaylists?.();return {added:true,playlistId,id:songId};
    }).finally(()=>{if(adds.get(key)===job)adds.delete(key);});adds.set(key,job);return job;
  }
  return {userPlaylists,playlistAdd,clear(){cache.clear();adds.clear();}};
}
module.exports={createLibrary};
