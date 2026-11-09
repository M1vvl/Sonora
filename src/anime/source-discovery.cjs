'use strict';

// A search match is only a title-page candidate. Keep it out of the source
// picker until the same rule successfully extracts at least one episode.
function createSourceDiscovery({engine,getRules,maxEntries=120,maxCachedEpisodes=20000,ttlMs=10*60*1000}){
  const chapterCache=new Map(),pending=new Map();let generation=0,disposed=false,cachedEpisodes=0;
  const cancelled=()=>Object.assign(new Error('来源搜索已取消'),{name:'AbortError'});
  const key=(rule,url)=>JSON.stringify([rule.name,rule.version,rule.chapterMode,rule.chapterApiConfig,rule.chapterRoads,rule.chapterResult,rule.baseURL,rule.userAgent,rule.referer,url]);
  function removeCached(id){const entry=chapterCache.get(id);if(entry){cachedEpisodes-=entry.count;chapterCache.delete(id);}}
  function cachedChapters(rule,url){
    if(disposed)return Promise.reject(cancelled());
    const id=key(rule,url),hit=chapterCache.get(id);
    if(hit&&Date.now()-hit.time<ttlMs){chapterCache.delete(id);chapterCache.set(id,hit);return Promise.resolve(hit.lines);}
    removeCached(id);
    if(pending.has(id))return pending.get(id);
    const ticket=generation;
    const promise=engine.chapters(rule,url).then(lines=>{
      if(disposed||ticket!==generation)throw cancelled();
      const valid=lines.flatMap(line=>{const episodes=Array.isArray(line.episodes)?line.episodes.filter(episode=>typeof episode.url==='string'&&episode.url):[];return episodes.length?[{...line,episodes}]:[];}),count=valid.reduce((n,line)=>n+line.episodes.length,0);
      // Keep a large season usable without retaining an unbounded multi-source
      // episode graph. Oversized results are returned but not cached.
      if(count<=maxCachedEpisodes){removeCached(id);chapterCache.set(id,{time:Date.now(),lines:valid,count});cachedEpisodes+=count;while(chapterCache.size>maxEntries||cachedEpisodes>maxCachedEpisodes)removeCached(chapterCache.keys().next().value);}
      return valid;
    }).finally(()=>{if(pending.get(id)===promise)pending.delete(id);});pending.set(id,promise);return promise;
  }
  async function search(ruleId,keyword){
    if(disposed)throw new Error('播放源检索已关闭');
    const rule=getRules().find(value=>(value.id||value.name)===ruleId);
    if(!rule||rule.enabled===false)throw new Error('来源规则不存在或已关闭');
    const ticket=generation,candidates=await engine.search(rule,keyword),items=[],failures=[];
    // Specific-title lookups normally return one or two matches. Bound broad
    // queries so 18 rules cannot create thousands of chapter requests at once.
    for(const candidate of candidates.slice(0,12)){
      if(disposed||ticket!==generation)throw cancelled();
      try{const lines=await cachedChapters(rule,candidate.url),episodeCount=lines.reduce((count,line)=>count+line.episodes.length,0);if(episodeCount)items.push({...candidate,episodeCount,verifiedEpisodes:true});}
      catch(error){if(/abort|cancel|已取消|已关闭/i.test(error.name+' '+error.message))throw error;failures.push(String(error.message||error).slice(0,160));}
    }
    if(disposed||ticket!==generation)throw cancelled();
    return {ruleId:rule.name,name:rule.name,items,checked:Math.min(12,candidates.length),unavailable:Math.max(0,Math.min(12,candidates.length)-items.length),...(candidates.length>12?{notice:'已核对前 12 个匹配条目，可使用更准确的名称缩小范围。'}:{}),...(!items.length&&failures.length?{error:failures[0]}:{})};
  }
  function clear(){generation++;chapterCache.clear();pending.clear();cachedEpisodes=0;}
  return {search,chapters:cachedChapters,cancel(){generation++;pending.clear();},clear,dispose(){disposed=true;clear();}};
}
module.exports={createSourceDiscovery};
