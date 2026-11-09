'use strict';

// One durable owner for watched progress. Notifications follow the file write,
// so an embedded player and a cached home page observe the same history.
function createHistory(state,{ruleById,normalizeUrl,findSubject,onChange,normalizeId=value=>{const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null;}}={}){
  const clone=value=>JSON.parse(JSON.stringify(value));
  const snapshot=()=>clone({history:state.data.history,revision:state.data.historyRevision});
  async function publish(){
    const result=snapshot();
    try{await onChange?.(result);}catch{/* A closed renderer must not invalidate a successful write. */}
    return result;
  }
  async function save(payload){
    const id=normalizeId(payload.subject?.id||payload.item?.id),subject=findSubject(id)||payload.subject||payload.item;
    if(id==null||!subject?.title)throw new Error('无效的播放历史');
    const position=Number(payload.position),rawDuration=Number(payload.duration||0);
    if(!Number.isFinite(position)||position<1)throw new Error('播放后才能保存观看历史');
    if(!Number.isFinite(rawDuration)||rawDuration<0)throw new Error('无效的视频时长');
    const rule=ruleById(payload.ruleId),episodeUrl=normalizeUrl(rule.baseURL,payload.episodeUrl||payload.episode?.url||'');
    if(!episodeUrl)throw new Error('播放历史缺少剧集地址');
    const sourceUrl=String(payload.sourceUrl||'').slice(0,4096);
    const item={id,subject:{id,title:String(subject.title).slice(0,300),cover:String(subject.cover||'').slice(0,4096)},ruleId:rule.name,sourceUrl,
      episodeName:String(payload.episodeName||payload.episode?.name||payload.episode?.title||'').slice(0,100),episodeUrl,
      position:Math.min(position,365*24*3600),duration:Math.min(rawDuration,365*24*3600),
      roadIndex:Math.max(0,Math.floor(Number(payload.roadIndex)||0)),episodeIndex:Math.max(0,Math.floor(Number(payload.episodeIndex)||0)),updatedAt:Date.now()};
    // A history update is a transaction over one serial queue. A later caller
    // cannot publish an older captured list after a newer write completes.
    return state.updateHistory(current=>[item,...current.filter(entry=>entry.id!==id)].slice(0,100),publish);
  }
  return {snapshot,save,clear:()=>state.updateHistory(()=>[],publish)};
}
module.exports={createHistory};
