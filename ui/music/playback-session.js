(function(host,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicPlaybackSession=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function create({player,api,flushSync,now=()=>Date.now()}){
    const view=player.getRoot().ownerDocument.defaultView;let loaded=false,disposed=false,dirty=false,timer=null,last=0,revision=0,loading=null;
    function snapshot(){const state=player.getState(),audio=player.getAudio();return {queue:player.getQueue().songs,song:player.getSong(),mode:state.mode,position:audio.getAttribute('src')?Number(audio.currentTime)||0:state.position,volume:audio.volume,muted:audio.muted};}
    function flush(sync=false){if(timer!==null)view.clearTimeout(timer);timer=null;if(!loaded||disposed)return;dirty=false;last=now();const value=snapshot();if(sync&&flushSync){try{const result=flushSync(value);if(result?.saved===true)return result;}catch{}}return Promise.resolve(api('playbackState',{state:value})).then(result=>{if(result?.error)throw new Error(result.error);return result;}).catch(()=>{dirty=true;});}
    const unsubscribe=player.subscribe(event=>{if(event.type!=='time'||player.getSong())revision++;if(!loaded||disposed)return;dirty=true;if(event.type==='time'&&now()-last<5000)return;if(timer!==null)view.clearTimeout(timer);timer=view.setTimeout(()=>flush(),event.type==='time'?0:180);});
    const beforeUnload=()=>flush(true);view.addEventListener('beforeunload',beforeUnload);
    return {async activate(){if(loaded||disposed)return;if(loading)return loading;const ticket=revision;loading=Promise.resolve(api('playbackState',{})).then(result=>{if(disposed)return;loaded=true;last=now();if(ticket===revision&&!player.getSong()&&result?.state)player.restorePlayback(result.state);}).catch(()=>{loaded=true;}).finally(()=>{loading=null;});return loading;},flush:()=>flush(true),getState:()=>({loaded,dirty,pending:timer!==null}),dispose(){if(disposed)return;flush(true);disposed=true;if(timer!==null)view.clearTimeout(timer);unsubscribe();view.removeEventListener('beforeunload',beforeUnload);}};
  }
  return {create};
});
