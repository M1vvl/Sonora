(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulsePlaylistLoader=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Only metadata is paged here. Audio stays in the existing streaming player.
  // A failed/stalled page must never turn a partial list into a complete queue.
  const MAX_SONGS=10000;
  async function read({request,id,current=()=>true,onProgress=()=>{}}={}){
    const songs=[],seen=new Set();let offset=0,first=null,total=0;
    const check=()=>{if(!current()){const error=new Error('歌单读取已取消');error.code='CANCELLED';throw error;}};
    for(let page=0;page<MAX_SONGS;page++){
      check();const result=await request('playlist',{id,offset,limit:50});check();
      if(result?.error)throw new Error(result.error);
      first ||= result||{};
      const values=Array.isArray(result?.songs)?result.songs:[],before=songs.length;
      for(const song of values){if(!song?.id||seen.has(String(song.id)))continue;seen.add(String(song.id));songs.push(song);}
      total=Math.max(total,Number(result?.total)||0,songs.length);
      if(songs.length>MAX_SONGS||total>MAX_SONGS)throw new Error('歌单超过 10000 首在线队列上限，请分成较小的歌单播放');
      onProgress({loaded:songs.length,total});
      if(result?.hasMore!==true)return {...first,...result,playlist:result?.playlist||first.playlist,songs,total,hasMore:false};
      const next=Number(result.nextOffset);
      if(!Number.isSafeInteger(next)||next<=offset||next>MAX_SONGS||!values.length||songs.length===before)throw new Error(`歌单读取在 ${songs.length} 首处中断，请重试`);
      offset=next;
    }
    throw new Error('歌单分页未能正常结束，请重试');
  }
  return {read,MAX_SONGS};
});
