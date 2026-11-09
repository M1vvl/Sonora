'use strict';

// Login runs in an isolated, non-persistent network session. The service alone
// owns encrypted credentials; renderer IPC exposes public account data only.
function installMusicBridge({electron,dataDir,isDashboard,getHostWindow,getOfficialSession,onMediaState=()=>{},factories={}}){
  const {ipcMain,protocol,session,safeStorage}=electron;
  const officialSession = provider => getOfficialSession ? getOfficialSession(provider) : session.fromPartition('persist:agent-pulse-'+provider+'-official',{cache:false});
  let service=null,apiSession=null,audio=null,visuals=null,platforms=null,workspace=null,spotifyWeb=null,spotifyPilot=null,disposed=false,playGeneration=0;
  let remotePrepared=false;
  let playback=null;const playbackStore=()=>playback||=require('./music/playback-state.cjs').createPlaybackState(dataDir);
  const matchedLyrics=require('./music/matched-lyrics.cjs').createMatchedLyrics({request:(action,payload)=>ensure().request(action,payload)});
  const images=require('./music-images.cjs').createMusicImages({fetchImpl:(url,init)=>network().fetch(url,init)});
  const controlJobs=new Map();let controlId=0;
  const pendingDecoders=new Set();let streamProvider=null,playProvider=null,pendingPlays=0;
  function cancelDecoders(){for(const decoder of pendingDecoders)decoder.dispose();pendingDecoders.clear();}
  async function fetchAuthorizedAudio(value,init={}){
    const allowed=require('./music/media-policy.cjs').audioURL;
    let url=allowed(value);
    for(let redirects=0;redirects<=3&&url;redirects++){
      const response=await network().fetch(url.href,{...init,redirect:'manual',credentials:'omit',cache:'no-store'});
      if(![301,302,303,307,308].includes(response.status))return response;
      await response.body?.cancel();
      url=allowed(new URL(response.headers.get('location')||'',url).href);
    }
    throw new Error('音乐平台返回了不受信任的音频跳转');
  }
  ipcMain.handle('pulse:music-control-result',(event,id,result)=>{
    if(!isDashboard(event))throw new Error('Untrusted music caller');
    const job=controlJobs.get(id);if(!job)return {accepted:false};
    clearTimeout(job.timer);controlJobs.delete(id);job.resolve(result?.ok===true?{ok:true}:{error:String(result?.error||'播放控制未完成').slice(0,160)});return {accepted:true};
  });
  function network(){
    if(disposed)throw new Error('音乐模块已关闭');
    if(!apiSession){
      apiSession=session.fromPartition('pulse-music-auth',{cache:false});
      apiSession.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
      apiSession.setPermissionCheckHandler(()=>false);
    }
    return apiSession;
  }
  function ensure(){
    if(!service)service=(factories.createService||require('./music/index.cjs').createMusicService)({
      dataDir,fetchImpl:(url,init)=>network().fetch(url,{...init,credentials:'omit'}),
      encryptString:value=>safeStorage.encryptString(value),decryptString:value=>safeStorage.decryptString(value),
      isEncryptionAvailable:()=>safeStorage.isEncryptionAvailable(),
      toDataURL:(...args)=>require('qrcode').toDataURL(...args),
      onStatus:value=>{const web=getHostWindow?.()?.webContents;if(!disposed&&web&&!web.isDestroyed())web.send('pulse:music-update',value);}
    });
    return service;
  }
  function visual(){return visuals||=(factories.createVisualBackend||require('./music-visual/index.cjs').createVisualBackend)({electron,dataDir,getHostWindow});}
  function platformLogin(){return platforms||=(factories.createPlatformLogin||require('./music/platform-login.cjs').createPlatformLogin)({electron,dataDir,getOfficialSession:officialSession,getHostWindow,onStatus:value=>{const web=getHostWindow?.()?.webContents;if(!disposed&&web&&!web.isDestroyed())web.send('pulse:music-update',{platformSession:value});}});}
  function spotifyPlayer(){return spotifyWeb||=(factories.createSpotifyWebPlayer||require('./music/spotify-web-player.cjs').createSpotifyWebPlayer)({electron,getHostWindow,getOfficialSession:officialSession,observeProfile:web=>platformLogin().observeSpotifyPlayer(web)});}
  async function startSpotify() {
    const value = await platformLogin().status({provider:'spotify'});
    if (!value.webAuthenticated || !value.webProfile) throw new Error('请先登录 Spotify');
    spotifyWeb?.release();
    spotifyPilot ||= (factories.createSpotifyBrowserPilot || require('./music/spotify-browser-pilot.cjs').createSpotifyBrowserPilot)({dataDir,getCookies:()=>officialSession('spotify').cookies.get({}),lookupLyrics:matchedLyrics.lookup});
    return spotifyPilot.start(value.webProfile);
  }
  async function workspaceStatus(payload) {
    if (payload.provider === 'spotify') await startSpotify();
    return platformStatus(payload);
  }
  async function platformStatus(payload){const value=await platformLogin().status(payload);return payload.provider==='spotify'&&spotifyPilot?.enabled?{...value,browserBridge:true}:value;}
  function platformRequest(payload){return payload.provider==='spotify'&&spotifyPilot?.enabled?spotifyPilot.request(payload):platformLogin().request(payload);}
  function providerWorkspace(){return workspace||=require('./music/provider-workspace.cjs').createProviderWorkspace({
    requestNetease:(action,payload)=>ensure().request(action,payload),requestPlatform:payload=>platformRequest(payload),platformStatus:payload=>workspaceStatus(payload),
    onChange:value=>{if(value.provider!=='spotify')spotifyWeb?.release();const web=getHostWindow?.()?.webContents;if(!disposed&&web&&!web.isDestroyed())web.send('pulse:music-update',{workspaceProvider:value});}
  });}
  async function providerRequest(payload,ticket){
    const result=await platformRequest({...payload,...(payload.action==='play'?{isCurrent:()=>!disposed&&ticket===playGeneration}:{})});
    if(payload.action!=='play')return result;
    if(disposed||ticket!==playGeneration)return {canceled:true};
    if(result.trial===true&&payload.provider!=='qishui')throw new Error('此歌曲当前仅有试听授权，请选择可完整播放的歌曲');
    const song=require('./music/provider-song.cjs').providerSong(result.song);
    if(!song||song.source!==payload.provider)throw new Error('音乐平台返回的歌曲信息无效');
    if(result.remote===true){
      if(payload.provider!=='spotify')throw new Error('无效的外部播放来源');
      audio?.stop();streamProvider=null;remotePrepared=true;ensure().registerExternalPlayback?.(song);
      return {song,source:'spotify',remote:true,playable:true,quality:'client',qualityLabel:String(result.qualityLabel||'Spotify 客户端控制').slice(0,80),qualityOptions:Array.isArray(result.qualityOptions)?result.qualityOptions:[],deviceName:String(result.deviceName||'').slice(0,100)};
    }
    remotePrepared=false;
    const trial=result.trial===true;
    if(trial){
      const duration=Number(result.duration);
      if(!Number.isFinite(duration)||duration<=0||duration>600)throw new Error('试听音源未提供有效时长');
      song.duration=duration;
    }
    let decoder=null;
    if(result.encrypted===true){
      if(payload.provider!=='qishui'||pendingDecoders.size>=2)throw new Error('授权音源解析繁忙，请稍后重试');
      decoder=(factories.createQishuiStream||require('./music/qishui-stream.cjs').createQishuiStream)({url:result.url,authorization:result.authorization,fetchImpl:fetchAuthorizedAudio});
      pendingDecoders.add(decoder);
      try{await decoder.ready();}catch(error){decoder.dispose();throw error;}finally{pendingDecoders.delete(decoder);}
      if(disposed||ticket!==playGeneration){decoder.dispose();return {canceled:true};}
    }
    audio||=require('./music-stream.cjs').createMusicStream({fetchImpl:(url,init)=>network().fetch(url,init)});
    let audioURL;
    try{audioURL=audio.prepare(result.url||result.audioURL,{decoder});streamProvider=song.source;}catch(error){decoder?.dispose();throw error;}
    ensure().registerExternalPlayback?.(song);
    return {song,audioURL,source:song.source,playable:true,trial,quality:result.quality||null,qualityLabel:(String(result.qualityLabel||'')+(trial?' · 试听':'')).slice(0,80),
      qualityOptions:Array.isArray(result.qualityOptions)?result.qualityOptions.slice(0,12).map(item=>({id:String(item.id||'').slice(0,40),label:String(item.label||'').slice(0,80),short:String(item.short||item.shortLabel||'').slice(0,16),description:String(item.description||'').slice(0,160)})):[],
      bitrate:Math.max(0,Number(result.bitrate)||0),requestedQuality:result.requestedQuality||null,degraded:result.degraded===true};
  }
  async function sourceOptions(){
    const sources=await Promise.all(['qq','kugou','qishui','spotify'].map(async provider=>{
      if(provider==='spotify')return {id:provider,available:spotifyPilot?.enabled===true,reason:spotifyPilot?.enabled?'':'请在账号面板选择 Spotify'};
      try{
        let status=await platformLogin().status({provider});
        if(!status.apiConnected&&status.sessionSaved){await platformLogin().request({provider,action:'profile'});status=await platformLogin().status({provider});}
        return {id:provider,available:status.apiConnected===true,reason:status.apiConnected?'':'请先在账号面板连接并验证'};
      }catch{return {id:provider,available:false,reason:'账号尚未验证或平台暂不可用'};}
    }));
    return {sources:[{id:'netease',available:true},...sources]};
  }
  async function switchSource(payload,ticket){
    const provider=payload.provider;
    if(!['netease','qq','kugou','qishui','spotify'].includes(provider))throw new Error('该平台的播放接口尚未接通');
    const target=require('./music/catalog.cjs').song(payload.song);
    if(!target)throw new Error('当前歌曲信息无效');
    const query=[target.title,target.artist].join(' ');
    const results=provider==='netease'?await ensure().request('search',{query}):await platformRequest({provider,action:'search',query});
    if(disposed||ticket!==playGeneration)return {canceled:true};
    const matched=require('./music/song-match.cjs').matchSong(target,results.songs);
    if(!matched)throw new Error('此来源没有匹配到同名、同歌手与时长的歌曲');
    if(provider!=='netease')return providerRequest({provider,action:'play',id:matched.id,song:matched,position:payload.position,autoplay:payload.autoplay},ticket);
    const result=await ensure().request('play',{id:matched.id,source:'netease'});
    if(disposed||ticket!==playGeneration)return {canceled:true};
    audio||=require('./music-stream.cjs').createMusicStream({fetchImpl:(url,init)=>network().fetch(url,init)});
    streamProvider='netease';return {...result,audioURL:audio.prepare(result.audioURL)};
  }
  ipcMain.handle('pulse:music',async(event,action,payload={})=>{
    if(!isDashboard(event))throw new Error('Untrusted music caller');
    if(!['providerState','selectProvider','sourceOptions','switchSource','platformLogin','platformStatus','platformLogout','platformBounds','platformClose','platformWebPlayer','spotifyPilot','platformRequest','nowPlaying','playbackState','bootstrap','beginQR','checkQR','cancelQR','logout','home','discovery', 'deck','search','playlist','userPlaylists','playlistAdd','visualSettings','memoryStatus','memoryPreferences','memoryTrim','play','like','comments','lyrics','playbackOptions','listening','historyProgress','preferences','deactivate','stopAudio'].includes(action))return {error:'无效的音乐操作'};
    if(disposed)return {error:'音乐模块已关闭'};
    if(action==='nowPlaying'){onMediaState(payload);return {accepted:true};}
    if(action==='deactivate')spotifyWeb?.hide();
    // Do not load the service merely because a page is being released.
    if(action==='playbackState')return {state:payload.state!==undefined?playbackStore().save(payload.state):playbackStore().get()};
    if(['cancelQR','deactivate'].includes(action)&&!service)return {canceled:true};
    if(action==='stopAudio'){playGeneration++;cancelDecoders();audio?.stop();if(remotePrepared||playProvider==='spotify')await platformRequest({provider:'spotify',action:'stopPlayback'});remotePrepared=false;streamProvider=playProvider=null;return {stopped:true};}
    if(action==='logout'&&playProvider==='netease')playGeneration++;
    const isPlay=action==='play'||action==='switchSource'||action==='platformRequest'&&payload.action==='play';
    if(isPlay){cancelDecoders();pendingPlays++;}
    const previousProvider=playProvider;
    if(isPlay)playProvider=action==='switchSource'||action==='platformRequest'?payload.provider:require('./music/provider-song.cjs').providerKey(payload.id)?.provider||payload.source||'netease';
    const ticket=isPlay?++playGeneration:playGeneration;
    try{
      if(['like','playlistAdd'].includes(action)){const owner=require('./music/provider-song.cjs').providerKey(payload.id)?.provider||'netease';if(payload.source&&payload.source!==owner)throw new Error('歌曲与收藏平台不匹配');}
      if(isPlay&&previousProvider==='spotify'&&playProvider!=='spotify'){await platformRequest({provider:'spotify',action:'stopPlayback'});remotePrepared=false;if(disposed||ticket!==playGeneration)return {canceled:true};}
      if(action==='providerState')return await providerWorkspace().state();
      if(action==='selectProvider')return await providerWorkspace().select(payload);
      if(action==='userPlaylists'&&payload.source){if(payload.source==='netease')return await ensure().request(action,payload);if(['qq','kugou','qishui','spotify'].includes(payload.source))return await providerRequest({provider:payload.source,action:'playlists',offset:payload.offset,songId:payload.songId},ticket);throw new Error('无效的歌单来源');}
      if(['home','deck','search','discovery','userPlaylists'].includes(action))return await providerWorkspace().request(action,payload);
      if(action==='sourceOptions')return await sourceOptions();
      if(action==='switchSource')return await switchSource(payload,ticket);
      if(action==='platformLogin')return await platformLogin().open(payload);
      if(action==='platformStatus')return await platformStatus(payload);
      if(action==='spotifyPilot'){if(payload.action!=='start')throw new Error('无效验证操作');return startSpotify();}
      if(action==='platformWebPlayer')return await spotifyPlayer().request(payload);
      if(action==='platformLogout'){if(payload.provider==='spotify'){spotifyWeb?.release();await spotifyPilot?.logout();spotifyPilot=null;}if(playProvider===payload.provider){playGeneration++;if(payload.provider==='qishui')cancelDecoders();if(payload.provider==='spotify')remotePrepared=false;}if(streamProvider===payload.provider){audio?.stop();streamProvider=null;}const result=await platformLogin().logout(payload);workspace?.invalidate(payload.provider);return result;}
      if(action==='platformBounds')return platformLogin().setBounds(payload);
      if(action==='platformClose')return platformLogin().close(payload);
      if(action==='platformRequest'){if(['like','playlistAdd'].includes(payload.action)&&require('./music/provider-song.cjs').providerKey(payload.id)?.provider!==payload.provider)throw new Error('歌曲与收藏平台不匹配');return await providerRequest(payload,ticket);}
      const playlist=action==='playlist'&&/^(qq|kugou|qishui|spotify):([A-Za-z0-9_-]{1,96})$/.exec(String(payload.id||''));
      const foreign=playlist?{provider:playlist[1]}:require('./music/provider-song.cjs').providerKey(payload.id);
      if(foreign&&['play','lyrics','playlist','comments','like','playlistAdd','playbackOptions'].includes(action)){
        if(action==='playlistAdd'&&foreign.provider!=='spotify')throw new Error(({qq:'QQ 音乐',kugou:'酷狗音乐',qishui:'汽水音乐'})[foreign.provider]+'的自选歌单写入尚未接通，本次没有修改歌单');
        if(!['play','lyrics','playlist','playbackOptions','like','playlistAdd'].includes(action))throw new Error('此音乐平台暂未提供该操作');
        if(payload.source&&payload.source!==foreign.provider)throw new Error('歌曲与音乐平台不匹配');
        return await providerRequest({...payload,provider:foreign.provider,action},ticket);
      }
      if(['memoryStatus','memoryPreferences','memoryTrim'].includes(action))return await visual().request(action,payload);
      const result=await ensure().request(action,payload);
      if(action==='play'&&result.audioURL){
        if(disposed||ticket!==playGeneration)return {canceled:true};
        audio||=require('./music-stream.cjs').createMusicStream({fetchImpl:(url,init)=>network().fetch(url,init)});
        streamProvider='netease';return {...result,audioURL:audio.prepare(result.audioURL)};
      }
      if(action==='logout'){workspace?.invalidate('netease');if(streamProvider==='netease'){audio?.stop();streamProvider=null;}}
      return result;
    }catch(error){return {error:String(error?.message||'音乐账号请求失败').slice(0,240)};}finally{if(isPlay)pendingPlays--;}
  });
  const flushPlayback=(event,value)=>{if(!isDashboard(event)||disposed){event.returnValue={error:'Untrusted playback state'};return;}try{playbackStore().save(value);event.returnValue={saved:true};}catch{event.returnValue={error:'无法保存播放进度'};}};ipcMain.on?.('pulse:flush-music-playback',flushPlayback);
  protocol.handle('pulse-music-image',request=>images.handle(request));
  protocol.handle('pulse-music-audio',request=>audio?audio.handle(request):new Response(null,{status:404}));
  protocol.handle('pulse-visual-media',request=>visual().handle(request));
  return {
    hasPlayback:()=>!disposed&&(remotePrepared||pendingPlays>0||audio?.getStatus().prepared===true),
    background(){spotifyWeb?.release();platforms?.close?.();Promise.resolve().then(()=>service?.request('cancelQR',{})).catch(()=>{});},
    control(action,{songId,position}={}){
      const web=getHostWindow?.()?.webContents;
      if(disposed||!web||web.isDestroyed()||!['toggle','next','previous','seek'].includes(action))return Promise.resolve({error:'音乐播放器不可用'});
      if(controlJobs.size>=8)return Promise.resolve({error:'请稍后重试'});
      const id=++controlId;
      return new Promise(resolve=>{
        const timer=setTimeout(()=>{controlJobs.delete(id);resolve({error:'音乐控制超时，请重试'});},5000);timer.unref?.();
        controlJobs.set(id,{resolve,timer});web.send('pulse:music-control',{id,action,songId:String(songId),position:Math.max(0,Math.min(86400,Number(position)||0))});
      });
    },
    findMediaLyrics:async value=>{
      const provider={qqmusic:'qq',kugou:'kugou',qishui:'qishui'}[value?.source];
      if(provider){
        try{
          const result=await platformLogin().request({provider,action:'search',query:[value.title,value.artist].filter(Boolean).join(' ')});
          const song=require('./music/song-match.cjs').matchSong(value,result.songs);
          if(song){
            const lyrics=await platformLogin().request({provider,action:'lyrics',id:song.id,song});
            if(lyrics.lines?.length)return lyrics.lines;
          }
        }catch{/* A disconnected platform can still match the public catalog below. */}
      }
      return (await matchedLyrics.lookup(value)).lines||[];
    },
    async getArtwork(url){
      if(disposed)return null;
      const response=await images.handle(new Request('pulse-music-image://cover/?url='+encodeURIComponent(url)));
      if(!response.ok)return null;
      const bytes=Buffer.from(await response.arrayBuffer());
      const image=electron.nativeImage.createFromBuffer(bytes);
      if(image.isEmpty())return null;
      const output=image.resize({width:96,height:96}).toPNG();
      return output.length<=512*1024?'data:image/png;base64,'+output.toString('base64'):null;
    },
    cancel(){onMediaState(null);cancelDecoders();streamProvider=null;spotifyWeb?.release();platforms?.close?.();for(const job of controlJobs.values()){clearTimeout(job.timer);job.resolve({error:'音乐面板已关闭'});}controlJobs.clear();playGeneration++;audio?.stop();Promise.resolve().then(()=>service?.request('cancelQR',{})).catch(()=>{});Promise.resolve().then(()=>service?.request('deactivate',{})).catch(()=>{});},
    getStatus:()=>({loaded:!!service,state:service?.getState(),...images.getStatus(),audio:audio?.getStatus()}),
    async dispose(){if(disposed)return;onMediaState(null);disposed=true;matchedLyrics.dispose();cancelDecoders();streamProvider=null;for(const job of controlJobs.values()){clearTimeout(job.timer);job.resolve({error:'音乐模块已关闭'});}controlJobs.clear();playGeneration++;audio?.dispose();await workspace?.dispose();spotifyWeb?.dispose();await spotifyPilot?.dispose();images.dispose();ipcMain.removeHandler('pulse:music');ipcMain.removeHandler('pulse:music-control-result');ipcMain.removeListener?.('pulse:flush-music-playback',flushPlayback);protocol.unhandle('pulse-music-image');protocol.unhandle('pulse-music-audio');protocol.unhandle('pulse-visual-media');await platforms?.dispose();await visuals?.dispose();await service?.dispose();await apiSession?.closeAllConnections();}
  };
}
module.exports={installMusicBridge};
