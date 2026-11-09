'use strict';

const {providerSong}=require('../provider-song.cjs');
const {imageURL}=require('../media-policy.cjs');
const ID=/^[A-Za-z0-9]{22}$/;
const text=(value,max=160)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max):'';
function track(value){
  if(!value||!ID.test(value.id)||value.type&&value.type!=='track'||value.is_local)return null;
  return providerSong({id:'spotify:'+value.id,title:value.name,artist:(value.artists||[]).slice(0,8).map(item=>text(item.name,80)).filter(Boolean).join(' / '),duration:(Number(value.duration_ms)||0)/1000,coverURL:value.album?.images?.[0]?.url,album:value.album?.name,source:'spotify'});
}
function createSpotifyAdapter({electron,network,dataDir,onStatus=()=>{},oauth:injected}={}){
  let profile=null,disposed=false,generation=0,profileJob=null,device=null,owned=false,playQueue=Promise.resolve();
  const known=new Map(),mutations=new Map();
  const oauth=injected||require('../spotify-oauth.cjs').createSpotifyOAuth({dataDir,safeStorage:electron.safeStorage,fetchImpl:(url,init)=>network.fetch(url,init),openExternal:url=>electron.shell.openExternal(url),onChange:message=>{
    if(disposed)return;if(message){profile=null;onStatus(message);return;}
    generation++;profile=null;known.clear();profileJob=null;getProfile().then(()=>onStatus('')).catch(error=>onStatus(error.message));
  }});
  const check=ticket=>{if(disposed||ticket!==generation)throw new Error('Spotify 操作已取消');};
  function remember(songs){for(const song of songs){known.delete(song.id);known.set(song.id,{...song});while(known.size>300)known.delete(known.keys().next().value);}return songs;}
  async function getProfile(){
    if(profileJob)return profileJob;const ticket=generation;
    const job=oauth.api('/me').then(value=>{check(ticket);if(!text(value.id))throw new Error('Spotify 未返回有效账号');profile={provider:'spotify',userId:text(value.id),nickname:text(value.display_name)||text(value.id),avatarURL:imageURL(value.images?.[0]?.url)?.href||'',vip:value.product==='premium',verification:'verified'};return {...profile};}).catch(error=>{if(ticket===generation)profile=null;throw error;}).finally(()=>{if(profileJob===job)profileJob=null;});profileJob=job;return job;
  }
  function songID(payload){const id=String(payload.id||'').replace(/^spotify:/,'');if(!ID.test(id))throw new Error('无效的 Spotify 歌曲');if(payload.source&&payload.source!=='spotify')throw new Error('歌曲与音乐平台不匹配');return id;}
  async function withLikes(songs){if(!songs.length)return songs;const uris=songs.map(song=>'spotify:track:'+song.providerId).join(',');try{const values=await oauth.api('/me/library/contains?uris='+encodeURIComponent(uris));if(Array.isArray(values)&&values.length===songs.length)return remember(songs.map((song,index)=>({...song,...(typeof values[index]==='boolean'?{liked:values[index]}:{})})));}catch{/* Missing optional scope must not replace the catalog with another platform. */}return remember(songs);}
  async function playlists(payload={}){
    const offset=Math.max(0,Math.min(10000,Math.floor(Number(payload.offset)||0))),limit=50;
    const value=await oauth.api('/me/playlists?limit='+limit+'&offset='+offset);
    const rows=(value.items||[]).filter(item=>ID.test(item?.id)).map(item=>({id:'spotify:'+item.id,title:text(item.name)||'Spotify 歌单',source:'spotify',provider:'spotify',trackCount:Number(item.items?.total??item.tracks?.total)||0,coverURL:imageURL(item.images?.[0]?.url)?.href||'',owned:!!profile&&item.owner?.id===profile.userId,creator:text(item.owner?.display_name)}));
    if(offset===0)rows.unshift({id:'spotify:liked',title:'我喜欢的音乐',source:'spotify',provider:'spotify',owned:false,trackCount:0});
    return {provider:'spotify',playlists:rows,offset,nextOffset:offset+(value.items?.length||0),hasMore:!!value.next};
  }
  async function playlist(payload){
    const id=String(payload.id||'').replace(/^spotify:/,''),offset=Math.max(0,Math.min(10000,Math.floor(Number(payload.offset)||0))),limit=Math.max(1,Math.min(50,Math.floor(Number(payload.limit)||50)));
    if(id!=='liked'&&!ID.test(id))throw new Error('无效的 Spotify 歌单');
    const value=await oauth.api((id==='liked'?'/me/tracks':'/playlists/'+id+'/items')+'?limit='+limit+'&offset='+offset);
    let songs=(value.items||[]).map(item=>track(item.item||item.track)).filter(Boolean);
    songs=id==='liked'?remember(songs.map(song=>({...song,liked:true}))):await withLikes(songs);
    return {provider:'spotify',songs,total:Number(value.total)||songs.length,offset,nextOffset:offset+(value.items?.length||0),hasMore:!!value.next};
  }
  const qualityOptions=[{id:'client',label:'在 Spotify 客户端设置音质',short:'客户端',description:'打开官方客户端的音质设置；实际档位受账号权益控制'}];
  async function stopPlayback(){await playQueue.catch(()=>{});if(!owned)return {stopped:true};owned=false;try{await oauth.api('/me/player/pause'+(device?'?device_id='+encodeURIComponent(device):''),{method:'PUT'});}catch{/* The device may already have disconnected. */}return {stopped:true};}
  async function request(payload={}){
    const ticket=generation;check(ticket);let result;
    if(payload.action==='authorize'){generation++;profile=null;profileJob=null;known.clear();return oauth.authorize();}
    if(payload.action==='launchClient'){await electron.shell.openExternal('spotify:');return {opened:true};}
    if(payload.action==='profile')return {provider:'spotify',apiConnected:true,profile:await getProfile(),qualityOptions};
    if(payload.action==='playlists')result=await playlists(payload);
    else if(payload.action==='playlist')result=await playlist(payload);
    else if(payload.action==='home'||payload.action==='discovery'){
      const library=await playlists();let songs=[];
      try{const value=await oauth.api('/me/top/tracks?limit=30&time_range=short_term');songs=await withLikes((value.items||[]).map(track).filter(Boolean));}catch{check(ticket);}
      if(!songs.length)try{songs=(await playlist({id:'spotify:liked',limit:30})).songs;}catch{check(ticket);}
      result={...library,songs,cards:songs,discoveryModes:[],recommendationMode:'library',recommendationLabel:'Spotify · 常听与收藏'};
    }
    else if(payload.action==='search'){
      const query=text(payload.query,160);if(!query)return {songs:[]};const offset=Math.max(0,Math.min(1000,Math.floor(Number(payload.offset)||0))),limit=10;
      const value=await oauth.api('/search?type=track&limit='+limit+'&offset='+offset+'&q='+encodeURIComponent(query));
      result={provider:'spotify',songs:await withLikes((value.tracks?.items||[]).map(track).filter(Boolean)),offset,nextOffset:offset+limit,hasMore:!!value.tracks?.next};
    }
    else if(payload.action==='lyrics')result={lines:[]};
    else if(payload.action==='playbackOptions')result={provider:'spotify',apiConnected:!!profile,qualityOptions,qualityLabel:'音质由 Spotify 客户端控制'};
    else if(payload.action==='qualitySettings'){await electron.shell.openExternal('spotify:preferences');return {opened:true};}
    else if(payload.action==='like'){
      const id=songID(payload);if(typeof payload.liked!=='boolean')throw new Error('无效的收藏状态');
      if(mutations.has(id))throw new Error('这首歌的收藏正在同步，请稍候');
      const task=(async()=>{const endpoint='/me/library?uris='+encodeURIComponent('spotify:track:'+id);await oauth.api(endpoint,{method:payload.liked?'PUT':'DELETE'});check(ticket);const values=await oauth.api('/me/library/contains?uris='+encodeURIComponent('spotify:track:'+id));if(!Array.isArray(values)||values[0]!==payload.liked)throw new Error('Spotify 尚未确认收藏状态，请刷新后重试');if(known.has('spotify:'+id))known.get('spotify:'+id).liked=payload.liked;return {id:'spotify:'+id,provider:'spotify',liked:payload.liked};})();mutations.set(id,task);try{return await task;}finally{mutations.delete(id);}
    }
    else if(payload.action==='playlistAdd'){
      const id=songID(payload),list=String(payload.playlistId||'').replace(/^spotify:/,'');if(!ID.test(list))throw new Error('请选择本人 Spotify 歌单');
      const current=await getProfile(),info=await oauth.api('/playlists/'+list+'?fields=id,owner(id)');check(ticket);if(info.owner?.id!==current.userId)throw new Error('只能添加到本人创建的 Spotify 歌单');
      await oauth.api('/playlists/'+list+'/items',{method:'POST',body:{uris:['spotify:track:'+id]}});result={id:'spotify:'+id,playlistId:'spotify:'+list,added:true};
    }
    else if(payload.action==='stopPlayback')return stopPlayback();
    else if(payload.action==='play'){
      const id=songID(payload),song=providerSong(known.get('spotify:'+id)||payload.song);if(!song)throw new Error('Spotify 歌曲信息不完整，请从歌单或搜索中选择');
      const job=playQueue.catch(()=>{}).then(async()=>{
        check(ticket);if(payload.isCurrent&& !payload.isCurrent())return {canceled:true};
        const devices=await oauth.api('/me/player/devices');check(ticket);
        const available=(devices.devices||[]).filter(item=>!item.is_restricted&&typeof item.id==='string'&&item.id.length<=256);
        const computers=available.filter(item=>item.type==='Computer'),hostname=require('node:os').hostname().toLowerCase();
        const selected=computers.find(item=>text(item.name).toLowerCase()===hostname)||computers.find(item=>item.is_active)||(computers.length===1?computers[0]:null);
        if(!selected)throw new Error('请打开并登录 Spotify 电脑客户端，使其成为可用播放设备');
        if(payload.isCurrent&&!payload.isCurrent())return {canceled:true};device=selected.id;
        if(payload.autoplay!==false){await oauth.api('/me/player/play?device_id='+encodeURIComponent(device),{method:'PUT',body:{uris:['spotify:track:'+id],position_ms:Math.round(Math.max(0,Math.min(song.duration||86400,Number(payload.position)||0))*1000)}});owned=true;}
        return {provider:'spotify',source:'spotify',song,remote:true,playable:true,deviceName:text(selected.name),quality:'client',qualityLabel:'Spotify 客户端控制',qualityOptions};
      });playQueue=job;result=await job;
    }
    else if(payload.action==='playerState'){
      const value=await oauth.api('/me/player');const song=track(value.item);result={remote:true,song,playing:value.is_playing===true,position:Math.max(0,(Number(value.progress_ms)||0)/1000),volume:Math.max(0,Math.min(1,(Number(value.device?.volume_percent)||0)/100)),deviceName:text(value.device?.name)};
    }
    else if(payload.action==='playerControl'){
      const suffix=device?'device_id='+encodeURIComponent(device):'',control=payload.control;
      let endpoint,body;
      if(control==='pause'||control==='resume')endpoint='/me/player/'+(control==='resume'?'play':'pause')+(suffix?'?'+suffix:'');
      else if(control==='seek')endpoint='/me/player/seek?position_ms='+Math.round(Math.max(0,Math.min(86400,Number(payload.position)||0))*1000)+(suffix?'&'+suffix:'');
      else if(control==='volume')endpoint='/me/player/volume?volume_percent='+Math.round(Math.max(0,Math.min(1,Number(payload.volume)||0))*100)+(suffix?'&'+suffix:'');
      else throw new Error('无效的 Spotify 播放控制');
      await oauth.api(endpoint,{method:'PUT',body});if(control==='pause')owned=false;else if(control==='resume')owned=true;result={ok:true};
    }
    else throw new Error('Spotify 暂未提供此操作');
    check(ticket);return result;
  }
  return {request,getProfile:()=>profile,hasSession:()=>oauth.hasSession(),getStatus:()=>oauth.getStatus?.()||{},stopPlayback,cancel(){generation++;profile=null;known.clear();oauth.cancel();},async logout(){generation++;await stopPlayback();profile=null;known.clear();await oauth.logout();},async dispose(){try{await stopPlayback();}finally{disposed=true;generation++;profile=null;known.clear();await oauth.dispose();}}};
}
module.exports={createSpotifyAdapter,track};
