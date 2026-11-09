'use strict';
// MineRadio resolves an authorized direct tier, then lower tiers and its legacy
// endpoint before trying a strictly matched catalog entry. Keep the same bounded
// order without its whole-song cache, unbounded probes or trial playback.
const {authError}=require('./netease.cjs');
const {song:normalizeSong}=require('./catalog.cjs');
const {matchSong}=require('./song-match.cjs');
const {normalizeQuality}=require('./quality.cjs');
const {audioURL}=require('./media-policy.cjs');
const BUDGET_MS=12000;
const MAX_ATTEMPTS=10;
function qualityCandidates(value){
  const requested=normalizeQuality(value);
  const lower=requested==='standard'?[]:requested==='exhigh'?['standard']:requested==='lossless'?['exhigh','standard']:['lossless','exhigh','standard'];
  return [...new Set([requested,...lower])];
}
function completeTrack(result,key){
  if(Number(result?.body?.code)!==200)return null;
  const track=result.body.data?.find(item=>String(item?.id)===String(key));
  if(!track || track.freeTrialInfo || track.code!==undefined&&Number(track.code)!==200)return null;
  const value=String(track.url||'').replace(/^http:/,'https:');
  const url=audioURL(value);
  return url&&/^(?:m\d+|m\d+c)\.music\.126\.net$/.test(url.hostname)?{track,url:url.href}:null;
}
async function resolveNeteasePlayback({client,key,song,options,requested,now=Date.now}){
  const deadline=now()+BUDGET_MS;
  let attempts=0,lastError=null;
  function nextOptions(){
    if(options.signal?.aborted)throw authError('CANCELLED','音乐操作已取消');
    const remaining=deadline-now();
    if(attempts>=MAX_ATTEMPTS || remaining<250)return null;
    attempts++;
    return {...options,timeoutMs:Math.min(2200,remaining)};
  }
  async function obtain(id,quality,legacy=false){
    const requestOptions=nextOptions();
    if(!requestOptions)return null;
    try{
      const result=legacy?await client.songURLLegacy(id,{...requestOptions,bitrate:quality==='standard'?128000:320000}):await client.songURL(id,{...requestOptions,quality});
      if(options.signal?.aborted)throw authError('CANCELLED','音乐操作已取消');
      return completeTrack(result,id);
    }catch(error){
      if(options.signal?.aborted || error.code==='CANCELLED')throw error;
      lastError=error;return null;
    }
  }
  const levels=qualityCandidates(requested);
  for(const level of levels){const result=await obtain(key,level);if(result)return {...result,resolvedSongId:String(key)};}
  if(typeof client.songURLLegacy==='function'){
    const result=await obtain(key,levels.at(-1),true);
    if(result)return {...result,resolvedSongId:String(key)};
  }
  // A matching title alone is insufficient. Both entries must have real timing
  // and a complete matching artist set before any alternative is requested.
  if(song?.duration>0 && typeof client.search==='function' && matchSong(song,[song])){
    const searchOptions=nextOptions();
    if(searchOptions){
      let rows=[];
      try{const result=await client.search([song.title,song.artist].join(' '),1,searchOptions);if(Number(result?.body?.code)===200)rows=result.body.result?.songs||[];}
      catch(error){if(options.signal?.aborted || error.code==='CANCELLED')throw error;lastError=error;}
      const candidates=rows.slice(0,30).map(normalizeSong).filter(item=>item&&item.id!==String(key)&&item.duration>0&&Math.abs(item.duration-song.duration)<2&&matchSong(song,[item])&&matchSong(item,[song])).slice(0,2);
      for(const candidate of candidates){
        const result=await obtain(candidate.id,requested)||await obtain(candidate.id,'standard');
        if(result)return {...result,resolvedSongId:candidate.id,matchedFromId:String(key),matchKind:'same_title_artist_duration'};
      }
    }
  }
  if(options.signal?.aborted)throw authError('CANCELLED','音乐操作已取消');
  if(lastError && ['NETWORK_UNAVAILABLE','TIMEOUT','UPSTREAM_UNAVAILABLE'].includes(lastError.code))throw lastError;
  throw authError('PLAYBACK_UNAVAILABLE',options.cookie?.MUSIC_U?'此歌曲各音质及站内匹配版本均未返回完整授权音源，请确认本软件账号的会员、单曲购买或地区权限':'请先在本软件登录网易云音乐，再尝试获取该歌曲的完整音源');
}
module.exports={resolveNeteasePlayback,qualityCandidates,completeTrack,BUDGET_MS,MAX_ATTEMPTS};
