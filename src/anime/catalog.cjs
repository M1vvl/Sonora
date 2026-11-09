'use strict';
const {UA,CATEGORIES}=require('./config.cjs');

const MIRROR='https://api.kazumi.fyi';
const BROWSE_LIMIT=24,SEARCH_LIMIT=20;
const BROWSE_TAGS=new Set(CATEGORIES.filter(category=>!['主页','热门'].includes(category)));
function normalizeSubject(raw) {
  const r=raw.subject||raw,rating=r.rating||{},collection=r.collection||{},images=r.images||{};
  return {id:Number(r.id),title:r.name_cn||r.nameCN||r.name||'',originalTitle:r.name||'',summary:r.summary||r.info||'',cover:images.common||images.large||images.medium||r.image||'',coverLarge:images.large||images.common||images.medium||r.image||'',score:Number(rating.score)||0,rank:Number(rating.rank)||0,votes:Number(rating.total)||0,
    popularity:Number.isFinite(Number(collection.doing))?Number(collection.doing):null,tags:[...new Set([...(r.metaTags||[]),...(r.tags||[]).map(t=>typeof t==='string'?t:t.name)].filter(Boolean))].slice(0,15),airDate:r.date||r.airtime?.date||'',episodeCount:Number(r.eps||r.total_episodes)||0,url:'https://bangumi.tv/subject/'+r.id};
}
function pagination(data,offset,requestedLimit) {
  const raw=Array.isArray(data)?data:data?.data;
  if(!Array.isArray(raw))throw new Error('番剧目录返回了无效的列表');
  // The public API may enforce a smaller limit than the caller requests. Keep
  // the raw server cursor separate from deduplicated/filtered display counts.
  const suppliedLimit=Number(data?.limit),limit=Number.isSafeInteger(suppliedLimit)&&suppliedLimit>0?suppliedLimit:requestedLimit;
  const suppliedTotal=data?.total,total=suppliedTotal!=null&&Number.isSafeInteger(Number(suppliedTotal))&&Number(suppliedTotal)>=0?Number(suppliedTotal):null;
  const rawCount=raw.length,nextOffset=offset+rawCount;
  const items=[];
  for(const entry of raw){try{if(!entry||typeof entry!=='object')continue;const item=normalizeSubject(entry);if(Number.isSafeInteger(item.id)&&item.id>0&&item.title)items.push(item);}catch{}}
  const hasMore=rawCount>0&&(total===null?rawCount>=limit:nextOffset<total);
  return {items,total,offset,nextOffset,hasMore,rawCount,limit};
}
function createCatalog(network,getSettings) {
  const cache=new Map(),pending=new Map(),categoryRoutes=new Map();let generation=0;
  function cached(key,loader,ttl=5*60*1000){
    const hit=cache.get(key);if(hit&&Date.now()-hit.time<ttl)return Promise.resolve(hit.value);
    if(pending.has(key))return pending.get(key);
    const token=generation;
    const promise=loader().then(value=>{
      if(token!==generation)throw Object.assign(new Error('目录请求已取消'),{name:'AbortError'});
      cache.set(key,{time:Date.now(),value});while(cache.size>64)cache.delete(cache.keys().next().value);return value;
    }).finally(()=>{if(pending.get(key)===promise)pending.delete(key);});
    pending.set(key,promise);return promise;
  }
  async function officialSearch(query,tag,offset,mode) {
    const data=await network.json('https://api.bgm.tv/v0/search/subjects?limit='+SEARCH_LIMIT+'&offset='+offset,{method:'POST',ech:mode!=='direct',headers:{'content-type':'application/json','user-agent':UA},body:JSON.stringify({keyword:query,sort:'heat',filter:{type:[2],tag:tag?[tag]:[],rank:['>=0','<=99999'],nsfw:false}})});
    return {...pagination(data,offset,SEARCH_LIMIT),notice:mode==='mirror'?'搜索使用 Bangumi 官方公开接口与 ECH；Kazumi 镜像搜索需要其发行版签名。':undefined};
  }
  async function list({category='热门',query='',offset=0}={}) {
    query=String(query).trim().slice(0,200);
    const numericOffset=Number(offset);offset=Number.isFinite(numericOffset)?Math.max(0,Math.trunc(numericOffset)):0;
    if(!Number.isSafeInteger(offset)||offset>2147483647)throw new Error('番剧目录翻页位置无效');
    // A plain keyword search is independent of the currently displayed tab.
    // In particular, the UI label “搜索” is never a Bangumi tag filter.
    const tag=!query&&BROWSE_TAGS.has(category)?category:'',mode=getSettings().bangumi,routeGeneration=generation;
    return cached(JSON.stringify([mode,tag,query,offset]),async()=>{
      if(!query&&mode==='mirror') {
        if(tag&&categoryRoutes.get(tag)==='official')return officialSearch('',tag,offset,mode);
        const url=new URL(MIRROR+'/kazumi/v1/popular/subjects');url.searchParams.set('limit',String(BROWSE_LIMIT));url.searchParams.set('offset',String(offset));if(tag)url.searchParams.set('tag',tag);
        let result;
        try{result=pagination(await network.json(url.toString()),offset,BROWSE_LIMIT);}catch(error){
          if(error.name==='AbortError'||!tag||offset!==0)throw error;
          const fallback=await officialSearch('',tag,0,mode);if(routeGeneration===generation)categoryRoutes.set(tag,'official');return fallback;
        }
        // The mirror implements only part of Bangumi's tag vocabulary. An
        // empty first category page is not evidence that the category is empty.
        if(tag&&offset===0&&result.rawCount===0){const fallback=await officialSearch('',tag,0,mode);if(routeGeneration===generation)categoryRoutes.set(tag,'official');return fallback;}
        return result;
      }
      return officialSearch(query,tag,offset,mode);
    });
  }
  async function detail(id){id=Number(id);if(!Number.isSafeInteger(id)||id<=0)throw new Error('无效的番剧编号');const mode=getSettings().bangumi;return cached('detail:'+mode+':'+id,async()=>{const url=(mode==='mirror'?MIRROR+'/p1':'https://api.bgm.tv/v0')+'/subjects/'+id;return normalizeSubject(await network.json(url,{ech:mode==='ech'}));},15*60*1000);}
  function cancelPending(){generation++;pending.clear();}
  return {list,detail,cancelPending,clear(){cancelPending();cache.clear();categoryRoutes.clear();},getStatus:()=>({entries:cache.size,pending:pending.size})};
}
module.exports={createCatalog,normalizeSubject,pagination};
