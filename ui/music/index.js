(function(host,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./account.js'),require('./player.js'),require('./music-workspace.js'),null,require('./feedback.js'),require('./lyrics.js'),require('./library.js'),require('./immersive.js'),require('./playback-session.js'),require('./interaction-policy.js'));
  else host.PulseMusicUI=factory(host.PulseMusicAccount,host.PulseMusicPlayer,host.PulseMusicWorkspace,host.PulseMusicCards,host.PulseMusicFeedback,host.PulseMusicLyrics,host.PulseMusicLibrary,host.PulseMusicImmersive,host.PulseMusicPlaybackSession,host.PulseMusicInteractionPolicy);
})(typeof window==='object'?window:globalThis,function(accountModule,playerModule,workspaceModule,cardsModule,feedbackModule,lyricsModule,libraryModule,immersiveModule,sessionModule,interactionModule){
  'use strict';
  function create({root,api,subscribe,imageURL=value=>value,now=()=>Date.now()}={}){
    if(!root?.ownerDocument||typeof api!=='function')throw new TypeError('Music UI needs a root and local API');
    const listeners=new Set();let disposed=false,active=false,workspace=null,library=null,immersive=null,accountOpen=false,immersiveOpen=false;
    root.classList.add('music-view');root.innerHTML='<div class="music-topbar"><span class="music-topbar-spacer" aria-hidden="true"></span><form class="music-search" role="search" data-no-window-drag></form><div class="music-account-host"></div></div><div class="music-body"><div class="music-workspace-host"></div><div class="music-bottom-row"><div class="music-player-host"></div><aside class="music-lyrics-host"></aside></div></div>';
    const $=selector=>root.querySelector(selector),image=value=>accountModule.safeImage(imageURL(value)),feedback=feedbackModule.create({root});
    const account=accountModule.create({root:$('.music-account-host'),api,now,imageURL:image,onNotice:feedback.show,onProviderChange:()=>{library?.authChanged();if(active)workspace?.providerChanged();},onPlay:songs=>songs?.length?player.play(songs[0],{queue:songs}):null,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},onPanelChange:open=>{accountOpen=open;workspace?.setObscured?.(accountOpen||immersiveOpen);feedback.clear();immersive?.setAccountOpen?.(open);library?.setBlocked(open);for(const selector of ['.music-search','.music-body'])$(selector).inert=open;}});
    const lyrics=lyricsModule.create({root:$('.music-lyrics-host'),api,imageURL:image,onNotice:feedback.show});
    const likeJobs=new Map();
    async function likeSong(song){
      const id=String(song?.id||'');if(!id)throw new Error('请先选择歌曲');if(likeJobs.has(id))return likeJobs.get(id);
      const source=id.includes(':')?id.split(':')[0]:'netease';if(song.source&&song.source!==source)throw new Error('歌曲与收藏平台不匹配');
      const current=player.getQueue().songs.find(item=>String(item.id)===id)||song;
      const job=(async()=>{const result=await api('like',{id,source,song:current,liked:!current.liked,toggle:['qq','kugou','qishui','spotify'].includes(source)});if(result?.error)throw new Error(result.error);if(typeof result?.liked!=='boolean'||result.id&&String(result.id)!==id)throw new Error('未能确认收藏状态，请刷新后重试');if(disposed)return result;player.applyLiked(id,result.liked);library?.applyLiked?.(id,result.liked);feedback.show((result.liked?'已收藏到':'已从')+({netease:'网易云音乐',qq:'QQ 音乐',kugou:'酷狗音乐',qishui:'汽水音乐',spotify:'Spotify'}[source]||source)+'的“我喜欢”'+(result.liked?'':'移除'));return result;})();
      likeJobs.set(id,job);try{return await job;}finally{likeJobs.delete(id);}
    }
    const player=playerModule.create({onLike:likeSong,root:$('.music-player-host'),api,now,imageURL:image,onError:feedback.show,onSong:song=>{lyrics.setSong(song,{load:true});workspace?.setSong(song);},onTime:value=>lyrics.time(value),onOpenQueue:()=>library?.open('queue',{keyboard:true}),onAddPlaylist:song=>library?.openAdd(song),onHistory:(song,listening)=>{workspace?.addRecent(song);workspace?.updateListening(listening);}});
    lyrics.attachPlayer?.(player);
    const playbackSession=sessionModule?.create({player,api,now,flushSync:value=>root.ownerDocument.defaultView.pulse?.flushMusicPlayback?.(value)});
    workspace=workspaceModule.create({root:$('.music-workspace-host'),searchRoot:$('.music-search'),api,imageURL:image,cardsFactory:cardsModule?.create,onPlay:(song,options)=>player.play(song,options),onNotice:feedback.show});
    $('.music-discovery-side').append($('.music-lyrics-host'));
    library=libraryModule.create({root,api,imageURL:image,getQueue:()=>player.getQueue(),onPlay:(song,options)=>player.play(song,options),onRemove:id=>player.removeQueue(id),onClear:()=>player.clearQueue(),onEnqueue:song=>player.enqueue(song),onLike:likeSong,onNotice:feedback.show});
    immersive=immersiveModule?.create({root,player,lyrics,api,accountRoot:$('.music-account-host'),library,imageURL:image,onNotice:feedback.show,onVisibilityChange:value=>{immersiveOpen=value;workspace?.setObscured?.(accountOpen||immersiveOpen);feedback.setRoot?.(value?root.ownerDocument.querySelector('.music-immersive'):root);}});
    const interactionPolicy=interactionModule?.create({root,isActive:()=>active||immersive?.getState().open||account.getState().panelOpen});
    const unsubscribeQueue=player.subscribe(event=>{if(event.type==='queue'||event.type==='song')library.queueChanged();});
    let mediaSignature='';
    const publishMedia=(withLyrics=false)=>{
      const audio=player.getAudio(),song=player.getSong();
      const position=audio.getAttribute('src')&&audio.readyState>0?Number(audio.currentTime)||0:player.getState().position||Number(song?.position)||0;
      const state=song?{id:song.id,title:song.title,artist:song.artist,coverURL:song.coverURL,playing:player.getState().remote?player.getState().phase==='playing':!audio.paused&&!audio.ended&&!audio.muted&&audio.volume>0,position:Math.floor(position*2)/2,duration:audio.getAttribute('src')&&Number.isFinite(audio.duration)?audio.duration:Number(song.duration)||0}:null;
      const key=JSON.stringify(state);if(key===mediaSignature&&!withLyrics)return;mediaSignature=key;
      if(state&&withLyrics===true)state.lines=lyrics.getLines();
      Promise.resolve(api('nowPlaying',state)).catch(()=>{});
    };
    const unsubscribeMedia=player.subscribe(()=>publishMedia());
    const unsubscribeMediaLyrics=lyrics.subscribe(event=>{if(event.type==='lines')publishMedia(true);});
    const mediaEvent=()=>publishMedia();
    for(const event of ['playing','pause','ended','volumechange','emptied'])player.getAudio().addEventListener(event,mediaEvent);
    const hostView=root.ownerDocument.defaultView;
    const unsubscribeControl=hostView.pulse?.onMusicControl?.(async command=>{
      let error=null;
      try{
        if(disposed||player.getState().disposed)throw new Error('播放器已关闭');
        if(String(player.getSong()?.id)!==String(command.songId))throw new Error('歌曲已切换，请重试');
        let result;
        if(command.action==='toggle')result=await player.toggle();
        else if(command.action==='previous')result=await player.previous();
        else if(command.action==='next')result=await player.next();
        else if(command.action==='seek')result=await player.seek(command.position);
        else throw new Error('无效的音乐控制');
        if(result?.ok!==true)throw new Error(result?.error||'播放控制未完成');
        if(disposed||player.getState().disposed)throw new Error('播放器已关闭');
        if(result.songId&&String(player.getSong()?.id)!==result.songId)throw new Error('歌曲已切换，请重试');
        publishMedia();
      }catch(value){error=value.message||'播放控制未完成';}
      hostView.pulse?.completeMusicControl?.(command.id,{ok:!error,error});
    });
    const unsubscribe=typeof subscribe==='function'?subscribe(value=>{if(disposed)return;for(const listener of listeners)listener(value);if((value?.profile||value?.state==='signedOut')&&account.getState().activeProvider==='netease'){library.authChanged();if(active)workspace.refresh();}}):null;
    function suspend(cancelRequests){
      if(disposed)return;
      active=false;feedback.clear();immersive?.deactivate();library.deactivate();account.deactivate();
      workspace.deactivate();player.deactivate();lyrics.deactivate();playbackSession?.flush();
      if(cancelRequests)Promise.resolve(api('deactivate',{})).catch(()=>{});
    }
    return {
      async activate(){if(disposed)return;active=true;lyrics.activate();player.activate();library.activate();immersive?.activate();await Promise.all([account.activate(),workspace.activate(),playbackSession?.activate()]);},
      deactivate(){suspend(true);},
      background(){suspend(false);},
      flushPlayback:()=>playbackSession?.flush(),
      open:()=>account.open(),close:()=>account.close(),
      getState:()=>({...account.getState(),workspace:workspace.getState(),player:player.getState(),library:library.getState(),immersive:immersive?.getState(),lyrics:lyrics.getState(),disposed}),
      dispose(){if(disposed)return;interactionPolicy?.dispose();playbackSession?.dispose();active=false;immersive?.dispose();unsubscribeQueue();unsubscribeMedia();unsubscribeMediaLyrics();unsubscribeControl?.();for(const event of ['playing','pause','ended','volumechange','emptied'])player.getAudio().removeEventListener(event,mediaEvent);Promise.resolve(api('nowPlaying',null)).catch(()=>{});library.dispose();workspace.dispose();player.dispose();lyrics.dispose();account.dispose();feedback.dispose();disposed=true;if(typeof unsubscribe==='function')unsubscribe();listeners.clear();Promise.resolve(api('stopAudio',{})).catch(()=>{});root.replaceChildren();root.classList.remove('music-view');}
    };
  }
  return {create,PLATFORMS:accountModule.PLATFORMS,safeImage:accountModule.safeImage};
});
