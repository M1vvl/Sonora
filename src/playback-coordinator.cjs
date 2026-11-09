'use strict';
// A single player owns native HWND, GPU work and player IPC for both catalogs.
// Close persists through the previous catalog's callbacks before owner changes.
function createPlaybackCoordinator({createPlayer,...options}){
  let player=null,context=null,tail=Promise.resolve(),disposed=false;
  const queue=job=>{const result=tail.catch(()=>{}).then(job);tail=result.catch(()=>{});return result;};
  const closed=()=>({open:false,phase:'closed',embedded:true});
  function ensure(){
    if(!player)player=(createPlayer||require('./anime-player.cjs').createAnimePlayer)({...options,
      onProgress:value=>context?.onProgress?.(value),onClosed:()=>context?.onClosed?.(),onEpisode:async(plan,index)=>{const previous=context,next=await previous?.onEpisode?.(plan,index);if(context===previous&&next)context.episodeIndex=index;return next;}});
    return player;
  }
  return {
    open(owner,plan,callbacks){return queue(async()=>{
      if(disposed)throw new Error('播放器已关闭');
      const current=player?.getStatus(),same=context?.owner===owner&&context?.subject===plan.subject.id;
      const position=same&&context.episodeIndex===plan.episodeIndex&&current?.video?.position>=1?current.video.position:plan.position;
      await player?.close();
      context={owner,subject:plan.subject.id,episodeIndex:plan.episodeIndex||0,...callbacks};
      return ensure().open({...plan,position});
    });},
    close(owner){return queue(async()=>{if(!owner||context?.owner===owner){await player?.close();context=null;}});},
    getStatus:owner=>!owner||context?.owner===owner?player?.getStatus()||closed():closed(),
    async dispose(){if(disposed)return;disposed=true;await queue(async()=>{await player?.dispose();player=null;context=null;});}
  };
}
module.exports={createPlaybackCoordinator};
