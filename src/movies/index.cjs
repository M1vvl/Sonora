'use strict';
// Desktop adapter for LibreTV's source aggregation and CMS protocols. No web
// server, Next.js runtime or Docker daemon is loaded by this module.
const {createNetwork}=require('../anime/network.cjs'),{createHistory}=require('../anime/history.cjs');
const {BROWSER_UA}=require('../anime/config.cjs');
const {createState,normalizeSource}=require('./state.cjs');
const {httpURL,playableURL,parseVod,parsePage,groupItems,apiURL,text}=require('./cms.cjs');
const {createCache}=require('./cache.cjs');
const {resolveCategoryTypes,categoryPage,categoryHasMore,doubanCategory}=require('./categories.cjs');
const {createRecommendations}=require('./recommendations.cjs');
const CATEGORIES=['主页','热门','电影','电视剧','动作','喜剧','科幻','悬疑','爱情','恐怖','动画','纪录片'];
const clone=value=>structuredClone(value),abort=()=>Object.assign(new Error('影视请求已取消'),{name:'AbortError'});
function createMoviesService({dataDir,fetchImpl=globalThis.fetch,onHistoryChange,sources,now=Date.now}={}){
  const state=createState(dataDir,{sources}),known=new Map(),vods=createCache({maxEntries:160,maxBytes:8*1024*1024}),chapters=createCache({maxEntries:120,maxBytes:8*1024*1024}),cache=createCache({maxEntries:40,maxBytes:12*1024*1024}),health=new Map(),classCache=new Map(),categoryPaging=new Map(),catalogRoutes=new Map(),imageCache=new Map(),controllers=new Set();
  let disposed=false,generation=0;const imagePending=new Map();
  const network=createNetwork({timeout:10000,maxBytes:6*1024*1024,concurrency:4,fetchImpl:(url,init)=>{
    const {movieSignal,...options}=init;return fetchImpl(url,{...options,signal:movieSignal?AbortSignal.any([options.signal,movieSignal]):options.signal});
  }});
  const quality=require('../media-stream/quality-probe.cjs').createQualityProbe({request:(url,options)=>network.request(url,options),now});
  const recommendations=createRecommendations({remember,loadPage:async offset=>{
    const ticket=generation,limit=24;
    try{
      const url=`https://movie.douban.com/j/search_subjects?type=movie&tag=${encodeURIComponent('豆瓣高分')}&sort=rank&page_limit=${limit}&page_start=${offset}`;
      const data=await network.json(url,{headers:{'User-Agent':BROWSER_UA,Referer:'https://movie.douban.com/'}});check(ticket);
      if(!Array.isArray(data.subjects))throw new Error('推荐返回格式错误');
      const items=data.subjects.slice(0,limit).map(raw=>({id:'douban:'+text(raw.id,100),title:text(raw.title,300),cover:(()=>{try{return httpURL(raw.cover);}catch{return '';}})(),score:Number(raw.rate)||0,tags:['电影'],summary:'',alternatives:[]})).filter(item=>item.title);
      return {items,nextOffset:offset+data.subjects.length,hasMore:data.subjects.length===limit};
    }catch(error){if(error.name==='AbortError'||ticket!==generation)throw error;return catalog({category:'电影',offset});}
  }});
  const rules=()=>state.data.sources.map(source=>({...source,baseURL:source.url,version:'CMS',...health.get(source.id)}));
  const byId=id=>{const source=state.data.sources.find(entry=>entry.id===id);if(!source)throw new Error('片源不存在或已删除');return source;};
  const history=createHistory(state,{normalizeId:value=>typeof value==='string'&&value.length<=200?value:null,ruleById:id=>{const source=byId(id);return {...source,baseURL:source.url,name:source.id};},normalizeUrl:(_base,url)=>httpURL(url),findSubject:id=>known.get(id),onChange:onHistoryChange});
  function bounded(map,key,value,max=300){if(map.has(key))map.delete(key);map.set(key,value);if(typeof map.keys==='function')while(map.size>max)map.delete(map.keys().next().value);return value;}
  function publicItem(item){const {lines,...summary}=item;return summary;}
  function remember(items){for(const item of items){bounded(known,item.id,publicItem(item),600);if(item.sourceId&&item.vodId&&item.lines?.length)vods.set(item.sourceId+'\n'+item.vodId,item);}return items;}
  function check(ticket){if(disposed||ticket!==generation)throw abort();}
  function cached(key){const item=cache.get(key);if(item&&now()-item.at<10*60000)return clone(item.value);if(item)cache.delete(key);return null;}
  function saveCache(key,value){bounded(cache,key,{at:now(),value:clone(value)},40);return value;}
  async function context(source,job,{recordHealth=true}={}){
    const previous=health.get(source.id);
    if(recordHealth&&previous?.retryAt>now())throw new Error('片源暂时不可用，已暂停重复请求；稍后自动重试或在设置中测试片源');
    const ticket=generation,controller=new AbortController(),started=now();controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(Object.assign(new Error('片源请求超时'),{name:'TimeoutError'})),10000);timer.unref?.();
    const options={movieSignal:controller.signal,headers:{'user-agent':BROWSER_UA,Accept:'application/json','Referer':new URL(source.url).origin+'/'}};
    try{
      check(ticket);let value;
      try{value=await job(options);}catch(error){
        const transient=/HTTP 5\d\d|无法连接来源|fetch failed|ECONNRESET|ENETUNREACH|ETIMEDOUT/i.test(error.message||'');
        if(!transient||controller.signal.aborted||error.name==='AbortError'||error.name==='TimeoutError')throw error;
        check(ticket);value=await job(options);
      }
      check(ticket);if(recordHealth)health.set(source.id,{status:'available',latencyMs:Math.max(0,now()-started),failures:0});return value;
    }
    catch(error){
      // Electron can turn an individual fetch's merged-signal timeout into a
      // plain DOM AbortError. Only a changed navigation generation is a global
      // cancellation; one timed-out provider must not discard other results.
      const failure=error?.name==='AbortError'&&!disposed&&ticket===generation
        ?controller.signal.reason?.name==='TimeoutError'?controller.signal.reason:new Error('片源连接已中断，请稍后重试',{cause:error})
        :error;
      if(recordHealth&&failure.name!=='AbortError'){const failures=(health.get(source.id)?.failures||0)+1;health.set(source.id,{status:'unavailable',failures,error:text(failure.message,200),latencyMs:null,retryAt:failures>=3?now()+Math.min(24*3600000,1800000*2**Math.min(failures-3,5)):0});}throw failure;
    }
    finally{clearTimeout(timer);controllers.delete(controller);}
  }
  async function page(source,{query='',page=1,type}={},options){return parsePage(await network.json(apiURL(source,{ac:'videolist',wd:query,pg:page,t:type}),options),source);}
  async function detailVod(source,id,options){
    const key=source.id+'\n'+id,hit=chapters.get(key);if(hit&&now()-hit.at<10*60000)return hit.item;
    const data=await network.json(apiURL(source,{ac:'detail',ids:id}),options),item=parseVod(data?.list?.[0],source);if(!item)throw new Error('片源详情无效');
    remember([item]);bounded(chapters,key,{item,at:now()},120);return item;
  }
  async function mapSources(fn){const values=state.data.sources.filter(source=>source.enabled!==false),results=new Array(values.length);let next=0;await Promise.all(Array.from({length:Math.min(3,values.length)},async()=>{while(next<values.length){const index=next++,source=values[index];try{results[index]=await fn(source,index);}catch(error){if(error.name==='AbortError')throw error;results[index]={source,error:text(error.message,200)};}}}));return results;}
  async function searchOne(source,query,{allPages=false,verify=false}={}){
    const key=`search:${source.id}:${query}:${allPages}:${verify}`,hit=cached(key);if(hit)return hit;
    const started=now();
    return context(source,async options=>{
      const first=await page(source,{query},options),values=[...first.items];
      if(allPages)for(let pg=2;pg<=Math.min(first.pagecount,5);pg++){try{values.push(...(await page(source,{query,page:pg},options)).items);}catch(error){if(error.name==='AbortError'||error.name==='TimeoutError')throw error;}}
      let entries=remember(values);
      if(verify){const checked=[];for(const item of entries.slice(0,8)){try{const full=item.lines.length?item:await detailVod(source,item.vodId,options);if(full.lines.length)checked.push(full);}catch(error){if(error.name==='AbortError'||error.name==='TimeoutError')throw error;}}entries=checked;}
      return saveCache(key,{items:entries,latencyMs:Math.max(0,now()-started)});
    });
  }
  async function searchSource(payload){const source=byId(payload.ruleId),query=text(payload.keyword,120);if(!query||source.enabled===false)return {ruleId:source.id,name:source.name,items:[]};try{const result=await searchOne(source,query,{allPages:true,verify:true});return {ruleId:source.id,name:source.name,latencyMs:result.latencyMs,items:result.items.map(item=>({title:item.title,url:apiURL(source,{ac:'detail',ids:item.vodId})}))};}catch(error){if(error.name==='AbortError')throw error;return {ruleId:source.id,name:source.name,items:[],error:text(error.message,200)};}}
  async function classes(source,options){const hit=classCache.get(source.id);if(hit)return hit;const data=await network.json(apiURL(source,{ac:'list'}),options),values=Array.isArray(data.class)?data.class.slice(0,200):[];bounded(classCache,source.id,values,24);return values;}
  async function sourceCatalog(category,offset,limit){
    let logicalPage=Math.floor(offset/limit)+1,networkRounds=0;
    for(let step=0;step<128;step++){
      const results=await mapSources(source=>context(source,async options=>{
        const unfiltered=['热门','主页'].includes(category),types=unfiltered?['*']:resolveCategoryTypes(await classes(source,options),category);
        if(!types.length)return {items:[],rawCount:0,hasMore:false,eligible:false};
        const key=source.id+'\n'+category,signature=types.join(','),previous=categoryPaging.get(key);
        const paging=previous?.signature===signature?previous:{signature,counts:new Map()};bounded(categoryPaging,key,paging,288);
        const plan=categoryPage(types,logicalPage),knownCount=paging.counts.get(plan.type);
        if(knownCount!==undefined&&plan.page>knownCount)return {items:[],rawCount:0,hasMore:categoryHasMore(types,paging.counts,logicalPage),eligible:true,requested:false};
        const result=await page(source,{page:plan.page,type:unfiltered?undefined:plan.type},options);paging.counts.set(plan.type,result.pagecount);
        return {...result,eligible:true,requested:true,hasMore:categoryHasMore(types,paging.counts,logicalPage)};
      }));
      const good=results.filter(result=>!result.error&&result.eligible),all=good.flatMap(result=>result.items||[]);
      if(!good.length&&results.every(result=>result.error))throw new Error('当前片源暂时无法连接，请检查网络或在影视设置中测试片源');
      const hasMore=good.some(result=>result.hasMore),rawCount=good.reduce((sum,result)=>sum+(result.rawCount||0),0);
      if(rawCount||!hasMore){const items=remember(groupItems(all)).map(publicItem);return {items,rawCount,limit,nextOffset:logicalPage*limit,total:null,hasMore,notice:results.some(result=>result.error)?'部分片源暂时不可用，已显示其余来源的条目。':''};}
      if(good.some(result=>result.requested))networkRounds++;
      if(networkRounds>=3)throw new Error('该分类的部分分组暂未返回条目，请重试加载');
      logicalPage++;
    }
    throw new Error('分类目录翻页位置需要重新加载');
  }
  async function catalog(payload={}){
    const offset=Math.max(0,Math.floor(Number(payload.offset)||0)),limit=24,query=text(payload.query,120),category=CATEGORIES.includes(payload.category)?payload.category:'热门';
    if(query){const key='aggregate:'+query;let result=cached(key);if(!result){const responses=await mapSources(async source=>(await searchOne(source,query,{allPages:true})).items),good=responses.filter(Array.isArray);if(!good.length)throw new Error('当前片源暂时无法连接，请稍后重试');result=saveCache(key,remember(groupItems(good.flat())).map(publicItem));}
      return {items:result.slice(offset,offset+limit),total:result.length,rawCount:Math.min(limit,Math.max(0,result.length-offset)),limit,nextOffset:offset+limit,hasMore:offset+limit<result.length};
    }
    const key=`catalog:${category}:${offset}`,hit=cached(key);if(hit){remember(hit.items);return hit;}
    const route=catalogRoutes.get(category),specific=!['主页','热门'].includes(category),ticket=generation;
    const finish=(origin,result)=>{check(ticket);catalogRoutes.set(category,origin);return saveCache(key,result);};
    if(route==='cms')return finish('cms',await sourceCatalog(category,offset,limit));
    // Genre recommendations can contain only a tiny stale subset. The CMS tree
    // is the browsable catalog; do not query an empty parent category ID.
    if(specific&&!route){
      try{const result=await sourceCatalog(category,offset,limit);if(result.rawCount||result.hasMore)return finish('cms',result);}
      catch(error){if(error.name==='AbortError')throw error;}
    }
    try{
      const {type,tag}=doubanCategory(category);
      const url=`https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${limit}&page_start=${offset}`;
      const data=await network.json(url,{headers:{'User-Agent':BROWSER_UA,Referer:'https://movie.douban.com/'}});
      if(!Array.isArray(data.subjects))throw new Error('推荐返回格式错误');
      const items=data.subjects.slice(0,limit).map(raw=>({id:'douban:'+text(raw.id,100),title:text(raw.title,300),cover:(()=>{try{return httpURL(raw.cover);}catch{return '';}})(),score:Number(raw.rate)||0,tags:[category==='电视剧'?'电视剧':'电影',...(specific?[category]:[])],summary:'',alternatives:[]})).filter(item=>item.title);
      if(!items.length&&offset===0&&!route){const fallback=await sourceCatalog(category,offset,limit);return finish('cms',fallback);}
      remember(items);return finish('douban',{items,rawCount:items.length,limit,nextOffset:offset+items.length,total:null,hasMore:items.length===limit});
    }catch(error){if(error.name==='AbortError'||route==='douban')throw error;const result=await sourceCatalog(category,offset,limit);return finish('cms',result);}
  }
  async function episodes(payload){
    const source=byId(payload.ruleId),url=new URL(httpURL(payload.url));if(url.origin!==new URL(source.url).origin||url.pathname.replace(/\/$/,'')!==new URL(source.url).pathname.replace(/\/$/,''))throw new Error('请从当前来源选择影片');
    const id=text(url.searchParams.get('ids'),120);if(!id)throw new Error('缺少影片标识');
    const item=await context(source,options=>detailVod(source,id,options));return {ruleId:source.id,lines:clone(item.lines)};
  }
  function findEpisode(source,url){for(const entry of chapters.values()){if(entry.item.sourceId!==source.id)continue;for(let roadIndex=0;roadIndex<entry.item.lines.length;roadIndex++){const line=entry.item.lines[roadIndex],episodeIndex=line.episodes.findIndex(ep=>ep.url===url);if(episodeIndex>=0)return {item:entry.item,line,roadIndex,episodeIndex};}}for(const item of vods.values()){if(item.sourceId!==source.id)continue;for(let roadIndex=0;roadIndex<item.lines.length;roadIndex++){const line=item.lines[roadIndex],episodeIndex=line.episodes.findIndex(ep=>ep.url===url);if(episodeIndex>=0)return {item,line,roadIndex,episodeIndex};}}return null;}
  function play(payload){const source=byId(payload.ruleId),url=playableURL(payload.episode?.url||payload.episodeUrl),context=findEpisode(source,url);if(!context)throw new Error('请先从当前片源选择集数');const subject=known.get(String(payload.id))||context.item;
    const previous=state.data.history.find(item=>item.id===subject.id&&(item.episodeUrl===url||item.episodeIndex===context.episodeIndex)),episode=context.line.episodes[context.episodeIndex];
    return clone({kind:'movies',subject:{id:subject.id,title:subject.title,cover:subject.cover},rule:{id:source.id,name:source.name,baseURL:source.url,userAgent:BROWSER_UA,referer:new URL(source.url).origin+'/',adBlocker:state.data.settings.adFilter},episode:{name:episode.title,url},episodes:context.line.episodes,roadIndex:context.roadIndex,episodeIndex:context.episodeIndex,sourceUrl:apiURL(source,{ac:'detail',ids:context.item.vodId}),position:previous?.position||0,media:{url,format:/\.m3u8(?:\?|$)/i.test(url)?'hls':'video'}});
  }
  async function image(url){url=httpURL(url);const existing=imageCache.get(url);if(existing){imageCache.delete(url);imageCache.set(url,existing);return existing;}if(imagePending.has(url))return imagePending.get(url);
    const ticket=generation,task=(async()=>{
      let result;const options={headers:{Referer:/doubanio\.com$/i.test(new URL(url).hostname)?'https://movie.douban.com/':new URL(url).origin+'/'}};
      for(let attempt=0;attempt<2;attempt++){try{check(ticket);result=await network.request(url,options);break;}catch(error){check(ticket);if(attempt!==0||error.name==='AbortError'||!/HTTP 5\d\d|无法连接来源|fetch failed|ECONNRESET|ETIMEDOUT/i.test(error.message||''))throw error;}}
      check(ticket);const declaredType=result.contentType.split(';')[0].trim().toLowerCase(),type=declaredType==='image/jpg'?'image/jpeg':declaredType;if(!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(type))throw new Error('片源未返回封面图片');
      const value={bytes:result.bytes,contentType:type};imageCache.set(url,value);let bytes=0;for(const item of imageCache.values())bytes+=item.bytes.length;while((bytes>24*1024*1024||imageCache.size>60)&&imageCache.size){const oldest=imageCache.keys().next().value;bytes-=imageCache.get(oldest).bytes.length;imageCache.delete(oldest);}return value;
    })().finally(()=>{if(imagePending.get(url)===task)imagePending.delete(url);});imagePending.set(url,task);return task;
  }
  function cancel(){generation++;quality.cancel();recommendations.cancel();for(const controller of controllers)controller.abort(abort());network.cancel();imagePending.clear();}
  async function request(action,payload={}){
    if(disposed)throw new Error('影视模块已关闭');if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('无效的影视操作');
    switch(action){
      case 'cancel':cancel();return {canceled:true};
      case 'bootstrap':return {...history.snapshot(),rules:rules(),settings:clone(state.data.settings),categories:[...CATEGORIES],movie:true};
      case 'home':{const result=await catalog({category:'热门'});return {...result,hot:result.items.slice(0,12),featured:[...result.items].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,5),...history.snapshot()};}
      case 'catalog':return catalog(payload);
      case 'recommendations':return recommendations.request(payload);
      case 'detail':{const item=known.get(String(payload.id))||state.data.history.find(record=>record.id===payload.id)?.subject;if(!item)throw new Error('请先搜索或选择影片');remember([item]);return {item:clone(item)};}
      case 'searchSource':return searchSource(payload);
      case 'searchSources':return {sources:await mapSources(source=>searchSource({ruleId:source.id,keyword:payload.keyword}))};
      case 'episodes':return episodes(payload);
      case 'quality':{const source=byId(payload.ruleId),result=await episodes(payload),episode=result.lines.flatMap(line=>line.episodes)[0];if(!episode)throw new Error('该来源没有可检测的分集');return quality.probe(episode.url,{headers:{'User-Agent':BROWSER_UA,Referer:new URL(source.url).origin+'/'},adFilter:state.data.settings.adFilter});}
      case 'play':return play(payload);
      case 'continue':{const item=state.data.history.find(record=>record.id===String(payload.id));if(!item)throw new Error('未找到观看记录');remember([item.subject]);await episodes({ruleId:item.ruleId,url:item.sourceUrl});return {...play({id:item.id,ruleId:item.ruleId,episode:{url:item.episodeUrl}}),position:item.position};}
      case 'history':return history.snapshot();
      case 'historyProgress':return history.save(payload);
      case 'historyClear':return history.clear();
      case 'rules':return {rules:rules()};
      case 'settings':return {settings:clone(state.data.settings)};
      case 'settingsSave':await state.transaction(next=>{if(typeof payload.adFilter==='boolean')next.settings.adFilter=payload.adFilter;});return {settings:clone(state.data.settings)};
      case 'sourceSave':{const source=normalizeSource(payload.source);await state.transaction(next=>{const index=next.sources.findIndex(entry=>entry.id===source.id);if(index<0){if(next.sources.length>=24)throw new Error('最多保留 24 个片源');next.sources.push(source);}else next.sources[index]=source;});health.delete(source.id);cancel();cache.clear();chapters.clear();classCache.clear();categoryPaging.clear();catalogRoutes.clear();return {rules:rules()};}
      case 'sourceToggle':byId(payload.id);await state.transaction(next=>{next.sources.find(entry=>entry.id===payload.id).enabled=payload.enabled!==false;});cancel();cache.clear();classCache.clear();categoryPaging.clear();catalogRoutes.clear();return {rules:rules()};
      case 'sourceDelete':byId(payload.id);await state.transaction(next=>{next.sources=next.sources.filter(entry=>entry.id!==payload.id);});cancel();cache.clear();classCache.clear();categoryPaging.clear();catalogRoutes.clear();return {rules:rules()};
      case 'probeSources':{const results=await mapSources(async source=>{health.delete(source.id);const start=now();await context(source,options=>page(source,{},options));return {id:source.id,ok:true,latencyMs:now()-start};});return {rules:rules(),results};}
      default:throw new Error('不支持的影视操作');
    }
  }
  return {request,image,getStatus:()=>({loaded:true,disposed,sources:state.data.sources.length,enabled:state.data.sources.filter(source=>source.enabled).length,network:network.getStatus(),items:known.size,chapterCache:chapters.size,metadataBytes:cache.bytes+chapters.bytes+vods.bytes,imageCache:imageCache.size,imagePending:imagePending.size,recommendations:recommendations.getStatus()}),async dispose(){if(disposed)return;disposed=true;cancel();quality.dispose();recommendations.dispose();network.dispose();await state.flush();known.clear();vods.clear();chapters.clear();cache.clear();classCache.clear();categoryPaging.clear();catalogRoutes.clear();imageCache.clear();}};
}
module.exports={createMoviesService,CATEGORIES};
