(function(host,factory){'use strict';const value=factory(typeof module==='object'&&module.exports?require('./track-options.js'):host.PulseMusicTrackOptions,typeof module==='object'&&module.exports?require('./queue.js'):host.PulseMusicQueue,typeof module==='object'&&module.exports?require('./remote-clock.js'):host.PulseMusicRemoteClock);if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicPlayer=value;})(typeof window==='object'?window:globalThis,function(optionsModule,queueModule,clockModule){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const paths={play:'<path d="m8.5 5.5 10.5 6.5-10.5 6.5Z" fill="currentColor" stroke="none"/>',pause:'<path d="M9 5v14M16 5v14" stroke-width="3"/>',prev:'<path d="M5 5v14m14-14L8 12l11 7Z"/>',next:'<path d="M19 5v14M5 5l11 7-11 7Z"/>',heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',comments:'<path d="M21 11a8 8 0 0 1-8 8H4l-2 3V11a9 9 0 0 1 9-9h2a8 8 0 0 1 8 9Z"/><path d="M7 8h9M7 12h6"/>',muted:'<path d="m11 4-6 5H2v6h3l6 5Zm5 5 6 6m0-6-6 6"/>',volume:'<path d="m11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',note:'<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',queue:'<path d="M4 6h16M4 12h16M4 18h10"/>',add:'<path d="M12 5v14M5 12h14"/>',sequence:'<path d="M4 5h10M4 10h10M4 15h6M14 17h7m-3-3 3 3-3 3"/>','repeat-one':'<path d="M18.8 6.8A8 8 0 1 0 20 15M19 3v5h-5"/><path d="m10 10 2-1v7m-2 0h4"/>' ,'repeat-all':'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-3v2a3 3 0 0 1-3 3H3"/>',shuffle:'<path d="M4 6h3c5 0 5 12 10 12h3m-3-3 3 3-3 3M4 18h3c5 0 5-12 10-12h3m-3-3 3 3-3 3"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'};
  const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.note}</svg>`;
  const time=value=>{const seconds=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
  function create({root,api,imageURL=value=>value,onError=()=>{},onHistory=()=>{},onSong=()=>{},onTime=()=>{},onOpenQueue=()=>{},onAddPlaylist=()=>{},onLike=null,now=()=>Date.now()}={}){
    if(!root?.ownerDocument||typeof api!=='function')throw new TypeError('Music player needs root and API');
    const document=root.ownerDocument,$=selector=>root.querySelector(selector),listeners=[],state={active:false,disposed:false,song:null,queue:[],phase:'idle',duration:0,position:0,volume:.7,muted:false,quality:null,qualityLabel:null,trial:false,source:'netease',qualityOptions:null,sources:[],bitrate:0,qualityPending:false,error:'',seeking:false};
    const queueModel=queueModule.create(),subscribers=new Set(),modeLabels={sequence:'顺序播放','repeat-one':'单曲循环',shuffle:'随机播放','repeat-all':'列表循环'};
    let listeningStarted=null,listened=0,buffering=false,seekingAudio=false,historyWait=Promise.resolve(),finishHistory=null;
    let generation=0,controlRevision=0,lastSaved=-Infinity,played=false,historyPending=false,commentsFocus=null,commentsGeneration=0,likePending=false,pendingResume=null;
    root.classList.add('music-player-root');root.innerHTML=`<audio class="music-audio" preload="metadata"></audio><div class="music-player-bar" aria-label="音乐播放器" data-no-window-drag><div class="music-now-playing"><span class="music-disc">${icon('note')}<img alt="" hidden></span><div class="music-track-copy"><span class="music-title-row"><strong class="music-track-title">选择一首歌曲</strong><span class="music-track-options-host"></span></span><span class="music-track-artist">音乐会从这里开始</span></div></div><div class="music-player-actions"><button type="button" class="music-icon-button" data-player-action="add-playlist" aria-label="收藏到歌单" disabled>${icon('add')}</button><button type="button" class="music-icon-button music-like" data-player-action="like" aria-label="喜欢这首歌" aria-pressed="false" disabled>${icon('heart')}</button><button type="button" class="music-icon-button" data-player-action="comments" aria-label="查看歌曲评论" disabled>${icon('comments')}</button></div><div class="music-player-center"><div class="music-transport"><button type="button" class="music-icon-button music-playback-mode" data-player-action="mode" aria-label="播放模式：顺序播放" data-mode="sequence">${icon('sequence')}</button><button type="button" class="music-icon-button" data-player-action="previous" aria-label="上一首" disabled>${icon('prev')}</button><button type="button" class="music-play-toggle" data-player-action="toggle" aria-label="播放" disabled>${icon('play')}</button><button type="button" class="music-icon-button" data-player-action="next" aria-label="下一首" disabled>${icon('next')}</button><button type="button" class="music-icon-button" data-player-action="queue" aria-label="当前播放队列">${icon('queue')}</button></div><div class="music-seek-row"><time class="music-position">0:00</time><input type="range" class="music-seek" min="0" max="1" step=".1" value="0" aria-label="播放进度" disabled><time class="music-duration">0:00</time></div></div><div class="music-player-end"><div class="music-volume-label"><button type="button" class="music-icon-button music-mute" data-player-action="mute" aria-label="静音" aria-pressed="false">${icon('volume')}</button><div class="music-volume-popover"><output class="music-volume-number" aria-hidden="true" hidden></output><input class="music-volume" type="range" min="0" max="1" step=".01" value=".7" aria-label="音量"></div></div></div></div><dialog class="music-comments-dialog" aria-label="歌曲评论"><div class="music-comments-heading"><div><h2>歌曲评论</h2><p class="music-comments-song"></p></div><button type="button" class="music-icon-button" data-player-action="close-comments" aria-label="关闭评论">${icon('close')}</button></div><div class="music-comments-list" aria-live="polite"></div></dialog>`;
    const audio=$('audio'),seek=$('.music-seek'),dialog=$('.music-comments-dialog');audio.crossOrigin='anonymous';audio.volume=state.volume;
    const snapshot=()=>({phase:state.phase,songId:state.song?.id||null,position:state.position,duration:state.duration,muted:state.muted,volume:state.volume,quality:state.quality,qualityPending:state.qualityPending,remote:remoteSession,mode:queueModel.getMode(),queueCount:state.queue.length,disposed:state.disposed});
    function notify(type){for(const listener of subscribers)listener({type,...snapshot()});}
    function setMode(mode){if(!queueModel.setMode(mode))return;render();notify('mode');}
    function cycleMode(){const modes=queueModule.MODES;setMode(modes[(modes.indexOf(queueModel.getMode())+1)%modes.length]);}
    const options=optionsModule.create({root:$('.music-track-options-host'),onQuality:quality=>changeQuality(quality),onSource:source=>changeQuality(undefined,source),onOpenSource:refreshSources});
    const on=(target,event,handler)=>{target.addEventListener(event,handler);listeners.push(()=>target.removeEventListener(event,handler));};
    async function request(action,payload={}){const result=await api(action,payload);if(result?.error)throw new Error(result.error);return result||{};}
    let remoteSession=false,remoteTimer=null,remoteVolumeTimer=null,remoteFailures=0,remoteBound=false,remoteFrame=null,lastRemoteFrame=0;
    const remoteClock=clockModule.create({now});
    function stopRemoteFrame(){if(remoteFrame!==null)document.defaultView.cancelAnimationFrame(remoteFrame);remoteFrame=null;}
    function animateRemote(){
      if(remoteFrame!==null||!remoteSession||!state.active||state.phase!=='playing'||document.visibilityState==='hidden')return;
      remoteFrame=document.defaultView.requestAnimationFrame(stamp=>{
        remoteFrame=null;
        if(!remoteSession||state.disposed||!state.active||state.phase!=='playing'||document.visibilityState==='hidden')return;
        if(stamp-lastRemoteFrame>=32&&!state.seeking){lastRemoteFrame=stamp;state.song.position=state.position=remoteClock.position();progress();}
        animateRemote();
      });
    }
    function clearRemote(){stopRemoteFrame();remoteClock.reset();if(remoteVolumeTimer!==null)document.defaultView.clearTimeout(remoteVolumeTimer);remoteVolumeTimer=null;if(remoteTimer!==null)document.defaultView.clearTimeout(remoteTimer);remoteTimer=null;remoteSession=false;remoteBound=false;}
    async function remoteControl(control,payload={}){const result=await request('platformRequest',{provider:'spotify',action:'playerControl',control,...payload});if(result.ok!==true)throw new Error('Spotify 未确认播放控制');return result;}
    function remoteVolume(){if(!remoteSession)return;if(remoteVolumeTimer!==null)document.defaultView.clearTimeout(remoteVolumeTimer);const ticket=generation;remoteVolumeTimer=document.defaultView.setTimeout(()=>{remoteVolumeTimer=null;if(remoteSession&&ticket===generation)remoteControl('volume',{volume:audio.muted?0:audio.volume}).catch(value=>onError(value.message));},150);}
    async function seekTo(value){if(!state.song||!Number.isFinite(Number(value)))return {ok:false,error:'没有可定位的歌曲'};const position=Math.max(0,Math.min(state.duration||86400,Number(value)));try{if(remoteSession){++controlRevision;await remoteControl('seek',{position});remoteClock.update(position,state.duration,state.phase==='playing');if(remoteTimer!==null)document.defaultView.clearTimeout(remoteTimer);pollRemote(generation,state.song.id);}else if(audio.getAttribute('src'))audio.currentTime=position;state.song.position=state.position=position;progress();saveProgress(true);return {ok:true,songId:String(state.song.id)};}catch(error){onError(error.message);return {ok:false,error:error.message};}}
    async function pollRemote(ticket,expected,started=now()){
      remoteTimer=null;if(state.disposed||!remoteSession||ticket!==generation)return;const revision=controlRevision;
      try{const result=await request('platformRequest',{provider:'spotify',action:'playerState'});if(state.disposed||!remoteSession||ticket!==generation||revision!==controlRevision)return;
        if(!result.song){stopRemoteFrame();state.phase='paused';remoteClock.reset();render();remoteTimer=document.defaultView.setTimeout(()=>pollRemote(ticket,expected,started),1000);return;}
        if(!remoteBound&&String(result.song.id)!==String(expected)){if(now()-started>12000)throw new Error('Spotify 客户端尚未切换到所选歌曲，请重试');remoteTimer=document.defaultView.setTimeout(()=>pollRemote(ticket,expected,started),1000);return;}
        remoteBound=true;remoteFailures=0;if(Number.isFinite(result.volume)){audio.volume=Math.max(0,Math.min(1,result.volume));if(audio.volume>0)audio.muted=false;}const changed=String(state.song?.id)!==String(result.song.id);accumulateListening(!result.playing);
        state.song={...state.song,...result.song,position:result.position};state.position=result.position;state.duration=Number(result.song.duration)||state.duration;state.phase=result.playing?'playing':'paused';
        remoteClock.update(result.position,state.duration,result.playing);state.song.position=state.position=remoteClock.position();
        if(result.playing){played=true;if(listeningStarted===null)listeningStarted=now();}
        if(changed){onSong(state.song);notify('song');}render();saveProgress();notify('remote');
        if(result.playing)animateRemote();else stopRemoteFrame();
        if(result.playing||state.active)remoteTimer=document.defaultView.setTimeout(()=>pollRemote(ticket,expected,started),result.playing?500:1000);
      }catch(value){if(state.disposed||!remoteSession||ticket!==generation||revision!==controlRevision)return;stopRemoteFrame();remoteFailures++;if(remoteFailures<3){remoteTimer=document.defaultView.setTimeout(()=>pollRemote(ticket,expected,started),1000);return;}accumulateListening(true);state.phase='paused';error(value.message||'Spotify 播放状态暂不可用');render();}
    }
    function useRemote(result,song,ticket,autoplay=true){
      audio.pause();audio.removeAttribute('src');audio.load();remoteSession=true;remoteBound=false;remoteFailures=0;
      state.song={...song,...result.song,position:Math.max(0,Number(song.position)||0)};state.position=state.song.position;state.duration=Number(state.song.duration)||0;state.source='spotify';state.quality='client';state.qualityLabel=result.qualityLabel||'Spotify 客户端控制';state.qualityOptions=result.qualityOptions||[];state.bitrate=0;state.phase=autoplay?'loading':'paused';
      onSong(state.song);notify('song');render();if(autoplay)pollRemote(ticket,state.song.id);
    }
    function error(value){state.error=String(value||'播放暂不可用');onError(state.error);}
    function render(){
      const song=state.song;$('.music-track-title').textContent=song?.title||'选择一首歌曲';$('.music-track-artist').textContent=song?.artist||'音乐会从这里开始';$('.music-track-title').title=song?.title||'';
      root.classList.toggle('is-playing',state.phase==='playing');root.classList.toggle('is-active',state.active);$('.music-like').setAttribute('aria-pressed',String(!!song?.liked));
      const toggle=$('[data-player-action="toggle"]');toggle.innerHTML=icon(state.phase==='playing'?'pause':'play');toggle.setAttribute('aria-label',state.phase==='playing'?'暂停':'播放');toggle.disabled=!song||state.phase==='loading';
      $('[data-player-action="like"]').disabled=!song||likePending;$('[data-player-action="comments"]').disabled=!song;$('[data-player-action="add-playlist"]').disabled=!song;const mode=queueModel.getMode(),modeButton=$('.music-playback-mode');modeButton.innerHTML=icon(mode);modeButton.setAttribute('aria-label','播放模式：'+modeLabels[mode]);modeButton.title=modeLabels[mode];modeButton.dataset.mode=mode;for(const action of ['previous','next'])$(`[data-player-action="${action}"]`).disabled=state.queue.length<2;
      renderVolume();options.update({song:state.song,source:state.source,qualityOptions:state.qualityOptions,sources:state.sources,quality:state.quality,qualityLabel:state.qualityLabel,trial:state.trial,bitrate:state.bitrate,busy:state.qualityPending||state.phase==='loading'});
      const cover=$('.music-disc img'),url=imageURL(song?.coverURL||'');if(url){if(cover.getAttribute('src')!==url)cover.src=url;cover.hidden=false;}else {cover.hidden=true;cover.removeAttribute('src');}$('.music-disc svg').toggleAttribute('hidden',!cover.hidden);
      progress();
    }
    function renderVolume(){
      const button=$('.music-mute'),muted=audio.muted||audio.volume===0;state.muted=muted;state.volume=audio.volume;$('.music-volume').value=String(audio.volume);
      button.setAttribute('aria-label',muted?'取消静音':'静音');button.setAttribute('aria-pressed',String(muted));button.innerHTML=icon(muted?'muted':'volume');
    }
    function toggleMute(){audio.muted=!audio.muted;if(!audio.muted&&audio.volume===0){state.volume=.7;audio.volume=state.volume;$('.music-volume').value=state.volume;}renderVolume();remoteVolume();}
    function progress(){const hasStream=!!audio.getAttribute('src');const duration=hasStream&&Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:state.duration;state.duration=Math.max(0,duration||0);state.position=Math.max(0,pendingResume?pendingResume.position:hasStream?(Number(audio.currentTime)||0):(Number(state.song?.position)||state.position||0));$('.music-position').textContent=time(state.position);$('.music-duration').textContent=time(state.duration);seek.disabled=!state.song||state.duration<=0;seek.max=state.duration||1;if(!state.seeking)seek.value=Math.min(state.position,state.duration||state.position);seek.setAttribute('aria-valuetext',`${time(state.position)} / ${time(state.duration)}`);onTime(state.position);notify('time');}
    function resume(){
      const pending=pendingResume;if(!pending||pending.ticket!==generation||state.disposed||audio.getAttribute('src')!==pending.url)return;
      const duration=Number(audio.duration);if(!Number.isFinite(duration)||duration<=0){if(pending.position===0)pendingResume=null;return;}
      pendingResume=null;audio.currentTime=Math.max(0,Math.min(duration-.25,pending.position));progress();
    }
    function accumulateListening(stop=false){if(listeningStarted!==null){const stamp=now();listened=Math.min(30,listened+Math.max(0,(stamp-listeningStarted)/1000));listeningStarted=stop?null:stamp;}}
    async function saveProgress(force=false){
      if(!played||!state.song||state.disposed)return;if(!force&&now()-lastSaved<10000)return;if(historyPending){if(force){await historyWait;return saveProgress(true);}return;}
      accumulateListening();lastSaved=now();historyPending=true;historyWait=new Promise(resolve=>{finishHistory=resolve;});const heard=listened;listened=0;const song=state.song,payload={id:song.id,listenedSeconds:heard,position:Math.max(0,remoteSession?state.position:Number(audio.currentTime)||0),duration:Math.max(0,Number.isFinite(audio.duration)?audio.duration:state.duration)};
      try{const result=await request('historyProgress',payload);onHistory({...song,...payload},result.listening);}catch{if(state.song?.id===song.id)listened=Math.min(30,listened+heard);}finally{historyPending=false;const finish=finishHistory;finishHistory=null;finish?.();}
    }
    async function play(song,{queue=state.queue,autoplay=true}={}){
      if(state.disposed)return {ok:false,error:'播放器已关闭'};
      if(!song?.id)return {ok:false,error:'请先选择歌曲'};
      if(document.defaultView.navigator.onLine===false){const message='当前离线，联网后可播放音乐';onError(message);return {ok:false,error:message};}
      saveProgress(true);const ticket=++generation,revision=++controlRevision;
      const stale=()=>state.disposed||ticket!==generation||revision!==controlRevision;
      const cancelled=()=>({ok:false,error:state.disposed?'播放器已关闭':'播放操作已被更新',cancelled:true});
      const wasRemote=remoteSession;clearRemote();pendingResume=null;options.close();closeComments();audio.pause();played=false;if(queue!==state.queue){queueModel.set(queue);state.queue=queueModel.getItems();notify('queue');}state.song={...song};state.phase='loading';state.qualityPending=false;state.quality=null;state.qualityLabel=null;state.trial=false;state.source=song.source||song.provider||'netease';state.qualityOptions=null;state.bitrate=0;state.error='';state.position=0;state.duration=Number(song.duration)||0;audio.removeAttribute('src');onSong(state.song);notify('song');render();
      try{
        if(wasRemote){await request('stopAudio');if(stale())return cancelled();}
        const result=await request('play',{id:song.id,source:state.source,song,autoplay,position:Math.max(0,Number(song.position)||0)});
        if(stale())return cancelled();
        if(document.defaultView.navigator.onLine===false)throw new Error('当前离线，联网后可播放音乐');
        if(result.remote===true){useRemote(result,song,ticket,autoplay);return {ok:true,songId:String(state.song.id)};}
        const url=result.audioURL||result.url;
        if(typeof url!=='string'||!/^pulse-music-audio:\/\//i.test(url))throw new Error('此歌曲当前没有可播放的音源');
        state.song={...song,...result.song};state.quality=result.quality||null;state.qualityLabel=result.qualityLabel||null;state.trial=result.trial===true;state.source=result.source||state.source;state.qualityOptions=Array.isArray(result.qualityOptions)?result.qualityOptions:null;state.bitrate=Number(result.bitrate)||0;state.duration=Number(state.song.duration)||0;
        pendingResume={ticket,url,position:Math.max(0,Number(song.position)||0)};audio.src=url;audio.load();state.phase='paused';render();
        if(autoplay)await audio.play();
        if(stale())return cancelled();
        if(autoplay&&(audio.paused||audio.ended))throw new Error('歌曲未能开始播放');
        if(result.trial)onError('此歌曲当前提供'+Math.round(state.duration)+'秒试听');
        else if(result.degraded)onError('当前歌曲实际提供'+(result.qualityLabel||'较低档位音质'));
        return {ok:true,songId:String(state.song.id)};
      }catch(value){
        if(stale())return cancelled();
        pendingResume=null;state.phase='paused';error(value?.message||'此歌曲暂时无法播放');render();
        if(state.source!=='netease')refreshQualities(song,ticket);
        return {ok:false,error:state.error};
      }
    }
    async function refreshQualities(song,ticket){
      try{
        const result=await request('playbackOptions',{id:song.id,source:song.source||song.provider,song});
        if(state.disposed||ticket!==generation||state.song?.id!==song.id)return;
        if(Array.isArray(result.qualityOptions)){state.qualityOptions=result.qualityOptions;render();}
      }catch{}
    }
    let sourceOptionsPending=false;
    async function refreshSources(){
      if(state.disposed||sourceOptionsPending)return;
      sourceOptionsPending=true;
      try{const result=await request('sourceOptions');if(!state.disposed&&Array.isArray(result.sources)){state.sources=result.sources;render();}}
      catch(value){if(!state.disposed)onError(value.message||'音乐来源暂时无法读取');}
      finally{sourceOptionsPending=false;}
    }
    async function changeQuality(quality,provider){
      if(state.disposed||!state.song||state.qualityPending||provider===state.source)return;
      if(!provider&&state.source==='spotify'){try{await request('platformRequest',{provider:'spotify',action:'qualitySettings'});}catch(value){onError(value.message);}return;}
      const song=state.song,shouldAutoplay=state.phase==='playing'||(!audio.getAttribute('src')&&!remoteSession),ticket=++generation;state.qualityPending=true;render();
      try{
        await saveProgress(true);if(state.disposed||ticket!==generation)return;
        if(provider==='spotify')audio.pause();
        const result=await request(provider?'switchSource':'play',provider?{provider,song,position:state.position,autoplay:shouldAutoplay}:{id:song.id,source:state.source,quality,song});if(state.disposed||ticket!==generation)return;
        if(result.remote===true){const items=state.queue.map(item=>String(item.id)===String(song.id)?{...result.song}:item);queueModel.set(items);state.queue=queueModel.getItems();clearRemote();useRemote(result,{...result.song,position:state.position},ticket,shouldAutoplay);notify('queue');return;}
        clearRemote();
        const url=result.audioURL||result.url;if(typeof url!=='string'||!/^pulse-music-audio:\/\//i.test(url))throw new Error('所选音质暂时不可用');
        const position=Math.max(0,audio.getAttribute('src')?Number(audio.currentTime)||0:state.position),shouldPlay=!audio.paused||!audio.getAttribute('src');saveProgress(true);audio.pause();pendingResume={ticket,url,position};state.song=provider?{...result.song,source:result.source||provider,position}:{...song,...result.song};if(provider){const queue=state.queue.map(item=>String(item.id)===String(song.id)?{...state.song}:item);queueModel.set(queue);state.queue=queueModel.getItems();onSong(state.song);notify('song');notify('queue');}state.quality=result.quality||null;state.qualityLabel=result.qualityLabel||null;state.trial=result.trial===true;state.duration=Number(state.song.duration)||0;state.source=result.source||state.source;state.qualityOptions=Array.isArray(result.qualityOptions)?result.qualityOptions:provider?null:state.qualityOptions;state.bitrate=Number(result.bitrate)||0;audio.src=url;audio.load();state.phase='paused';render();if(shouldPlay)await audio.play();if(result.trial)onError('此歌曲当前提供'+Math.round(Number(state.song.duration)||state.duration)+'秒试听');else if(result.degraded)onError('当前歌曲实际提供'+(result.qualityLabel||'较低档位音质'));
      }catch(value){if(!state.disposed&&ticket===generation)onError(value.message||(provider?'此来源未能切换歌曲':'所选音质暂时不可用'));}
      finally{if(!state.disposed&&ticket===generation){state.qualityPending=false;render();if(remoteSession&&remoteTimer===null)pollRemote(ticket,state.song.id);}}
    }
    function adjacent(delta,{ended=false}={}){if(state.disposed)return Promise.resolve({ok:false,error:'播放器已关闭'});const song=queueModel.choose(state.song,delta,{ended});return song?play({...song,position:0}):Promise.resolve({ok:false,error:'当前队列没有可切换的歌曲'});}
    function stopCurrent(){saveProgress(true);clearRemote();++generation;pendingResume=null;played=false;audio.pause();audio.removeAttribute('src');audio.load();request('stopAudio').catch(()=>{});state.song=null;state.trial=false;state.position=state.duration=0;state.phase='idle';onSong(null);notify('song');render();}
    function clearQueue(){queueModel.clear();state.queue=[];stopCurrent();notify('queue');}
    function removeQueue(id){const wasPlaying=state.phase==='playing',at=state.queue.findIndex(item=>String(item.id)===String(id)),current=String(state.song?.id)===String(id);queueModel.remove(id);state.queue=queueModel.getItems();if(current){const next=state.queue[Math.min(Math.max(at,0),state.queue.length-1)];if(next)play({...next,position:0},{autoplay:wasPlaying});else stopCurrent();}else render();notify('queue');}
    async function toggle(){
      if(state.disposed)return {ok:false,error:'播放器已关闭'};
      if(!state.song)return {ok:false,error:'请先选择歌曲'};
      if(remoteSession){const ticket=generation;++controlRevision;try{await remoteControl(state.phase==='playing'?'pause':'resume');if(state.disposed||ticket!==generation)return {ok:false,cancelled:true};if(remoteTimer!==null)document.defaultView.clearTimeout(remoteTimer);remoteFailures=0;await pollRemote(ticket,state.song.id);return {ok:true,songId:String(state.song.id)};}catch(value){error(value.message);return {ok:false,error:value.message};}}
      if(state.phase==='playing'){controlRevision++;audio.pause();return {ok:true,songId:String(state.song.id)};}
      if(!audio.getAttribute('src'))return play({...state.song,position:state.position});
      if(document.defaultView.navigator.onLine===false)return {ok:false,error:'当前离线，联网后可播放音乐'};
      const ticket=generation,revision=++controlRevision;
      try{
        await audio.play();
        if(state.disposed||ticket!==generation||revision!==controlRevision)return {ok:false,error:'播放操作已被更新',cancelled:true};
        if(audio.paused||audio.ended)throw new Error('歌曲未能开始播放');
        return {ok:true,songId:String(state.song.id)};
      }catch(value){
        if(state.disposed||ticket!==generation||revision!==controlRevision)return {ok:false,error:'播放操作已被更新',cancelled:true};
        error(value?.message||'无法开始播放');return {ok:false,error:state.error};
      }
    }
    function applyLiked(id,liked){if(state.disposed||typeof liked!=='boolean')return false;const key=String(id??'');let changed=false,current=false;for(const item of state.queue)if(String(item.id)===key&&item.liked!==liked){item.liked=liked;changed=true;}if(state.song&&String(state.song.id)===key&&state.song.liked!==liked){state.song.liked=liked;changed=current=true;}if(changed){if(current)render();notify('metadata');}return changed;}
    async function like(){if(!state.song||likePending)return;const song=state.song;likePending=true;render();try{const result=onLike?await onLike(song):await request('like',{id:song.id,source:song.source||song.provider||'netease',liked:!song.liked});if(typeof result.liked!=='boolean')throw new Error('未能确认收藏状态，请稍后重试');applyLiked(song.id,result.liked);}catch(value){error(value.message);}finally{likePending=false;if(!state.disposed)render();}}
    function closeComments(){++commentsGeneration;if(dialog.open&&typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');commentsFocus?.focus();commentsFocus=null;}
    async function comments(){if(!state.song)return;const ticket=++commentsGeneration;commentsFocus=document.activeElement;$('.music-comments-song').textContent=`${state.song.title} · ${state.song.artist||''}`;$('.music-comments-list').textContent='正在加载评论…';if(typeof dialog.showModal==='function'){if(!dialog.open)dialog.showModal();}else dialog.setAttribute('open','');const id=state.song.id;try{const result=await request('comments',{id});if(state.disposed||ticket!==commentsGeneration||!dialog.open||state.song?.id!==id)return;const items=result.comments||result.items||[];$('.music-comments-list').innerHTML=items.length?items.map(item=>`<article class="music-comment"><strong>${esc(item.nickname||item.user||'音乐听众')}</strong><p>${esc(item.content||item.text||'')}</p><small>${esc(item.likedCount?`${item.likedCount} 人赞同`:'')}</small></article>`).join(''):'<p class="music-empty-copy">这首歌暂时没有可展示的评论。</p>';}catch(value){if(!state.disposed&&ticket===commentsGeneration&&dialog.open&&state.song?.id===id){$('.music-comments-list').replaceChildren();onError(value.message||'评论暂时不可用');}}}
    on(root,'click',event=>{const button=event.target.closest('[data-player-action]');if(!button||button.disabled)return;const action=button.dataset.playerAction;if(action==='toggle')toggle();else if(action==='previous')adjacent(-1);else if(action==='next')adjacent(1);else if(action==='mute')toggleMute();else if(action==='like')like();else if(action==='comments')comments();else if(action==='close-comments')closeComments();else if(action==='mode'){options.close();cycleMode();}else if(action==='queue')onOpenQueue();else if(action==='add-playlist'&&state.song)onAddPlaylist({...state.song});});
    on(audio,'playing',()=>{accumulateListening();buffering=seekingAudio=false;listeningStarted=now();resume();state.phase='playing';state.error='';played=true;render();saveProgress(true);});on(audio,'pause',()=>{accumulateListening(true);if(state.phase!=='loading')state.phase='paused';render();saveProgress(true);});on(audio,'ended',()=>{accumulateListening(true);saveProgress(true);state.phase='paused';render();adjacent(1,{ended:true});});on(audio,'loadedmetadata',()=>{resume();progress();});on(audio,'durationchange',progress);on(audio,'timeupdate',()=>{progress();saveProgress();});on(audio,'error',()=>{accumulateListening(true);if(!audio.getAttribute('src'))return;state.phase='error';error('音源暂时无法播放，请尝试其他歌曲');render();});
    on(seek,'input',()=>{state.seeking=true;$('.music-position').textContent=time(seek.value);});on(seek,'change',()=>{if(state.duration>0){const position=Math.max(0,Math.min(state.duration,Number(seek.value)||0));if(audio.getAttribute('src'))audio.currentTime=position;else if(state.song){state.song.position=state.position=position;if(remoteSession)seekTo(position);}}state.seeking=false;progress();saveProgress(true);});on($('.music-volume'),'input',event=>{state.volume=Math.max(0,Math.min(1,Number(event.target.value)||0));audio.volume=state.volume;if(state.volume>0)audio.muted=false;renderVolume();showVolumeNumber();notify('volume');remoteVolume();});
    for(const event of ['waiting','stalled'])on(audio,event,()=>{buffering=true;accumulateListening(true);});
    on(audio,'seeking',()=>{seekingAudio=true;accumulateListening(true);});
    on(audio,'seeked',()=>{seekingAudio=false;if(!audio.paused&&!buffering&&state.phase==='playing')listeningStarted=now();});
    on(audio,'canplay',()=>{buffering=false;if(!audio.paused&&!seekingAudio&&state.phase==='playing'&&listeningStarted===null)listeningStarted=now();});
    function showVolumeNumber(){const node=$('.music-volume-number');node.textContent=String(Math.round(audio.volume*100));node.hidden=false;}
    function hideVolumeNumber(){$('.music-volume-number').hidden=true;}
    on($('.music-volume'),'pointerdown',showVolumeNumber);on(document,'pointerup',hideVolumeNumber);on(document,'pointercancel',hideVolumeNumber);
    for(const name of ['change','keyup','blur'])on($('.music-volume'),name,hideVolumeNumber);
    on(document,'visibilitychange',()=>{if(document.visibilityState==='hidden')stopRemoteFrame();else animateRemote();});
    on(document.defaultView,'offline',()=>{if(state.disposed||!audio.getAttribute('src'))return;state.song.position=Math.max(0,Number(audio.currentTime)||state.position||0);saveProgress(true);request('stopAudio').catch(()=>{});++generation;pendingResume=null;audio.pause();audio.removeAttribute('src');audio.load();state.phase='paused';hideVolumeNumber();onError('网络已断开，联网后可继续播放');render();});
    on(audio,'volumechange',()=>{renderVolume();notify('volume');});
    on($('.music-disc img'),'error',()=>{$('.music-disc img').hidden=true;$('.music-disc svg').removeAttribute('hidden');});on(dialog,'cancel',event=>{event.preventDefault();closeComments();});
    render();
    return {restorePlayback(value){if(state.song||!value)return;queueModel.set(value.queue||[]);queueModel.setMode(value.mode);state.queue=queueModel.getItems();state.song=value.song?{...value.song,position:Math.max(0,Number(value.position)||0)}:null;state.position=state.song?.position||0;state.source=state.song?.source||state.song?.provider||'netease';state.duration=Number(state.song?.duration)||0;state.phase=state.song?'paused':'idle';audio.volume=Number.isFinite(value.volume)?Math.max(0,Math.min(1,value.volume)):.7;audio.muted=value.muted===true;onSong(state.song);render();notify('queue');},play,toggle,seek:seekTo,previous:()=>adjacent(-1),next:()=>adjacent(1),setMode,clearQueue,removeQueue,applyLiked,getRoot:()=>root,getAudio:()=>audio,getSong:()=>state.song?{...state.song}:null,enqueue(song){if(!song?.id)return false;const items=queueModel.getItems();if(!items.some(item=>String(item.id)===String(song.id)))items.push({...song});queueModel.set(items);state.queue=queueModel.getItems();render();notify('queue');return true;},getQueue:()=>({songs:state.queue.slice(),songId:state.song?.id||null,mode:queueModel.getMode()}),subscribe(listener){subscribers.add(listener);return()=>subscribers.delete(listener);},setQueue(items){queueModel.set(items);state.queue=queueModel.getItems();render();notify('queue');},activate(){state.active=true;render();if(remoteSession){animateRemote();if(remoteTimer===null)pollRemote(generation,state.song.id);}},deactivate(){state.active=false;stopRemoteFrame();saveProgress(true);root.classList.remove('is-active');options.close();closeComments();},getState:snapshot,dispose(){if(state.disposed)return;saveProgress(true);++generation;clearRemote();pendingResume=null;played=false;state.disposed=true;audio.pause();audio.removeAttribute('src');audio.load();closeComments();listeners.splice(0).forEach(remove=>remove());options.dispose();subscribers.clear();root.replaceChildren();}};
  }
  return {create,time};
});
