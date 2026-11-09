'use strict';
const path=require('node:path');
const {createState}=require('./state.cjs');
const {createHistory}=require('./history.cjs');
const {createNetwork}=require('./network.cjs');
const {createCatalog}=require('./catalog.cjs');
const {createSourceDiscovery}=require('./source-discovery.cjs');
const {createRuleEngine,validateRule,normalizeUrl}=require('./rule-engine.cjs');
const {NETWORK_OPTIONS,CATEGORIES,validateNetwork,repositoryUrl,imageRequest,safeHttpUrl}=require('./config.cjs');
const IMAGE_CACHE_BYTES=8*1024*1024,IMAGE_CACHE_ITEMS=32;

function createAnimeService(options={}) {
  if(!options.dataDir)throw new Error('番剧模块需要独立数据目录');
  const state=createState(options.dataDir,options),network=createNetwork(options),catalog=createCatalog(network,()=>state.data.network),engine=createRuleEngine(network);
  const discovery=createSourceDiscovery({engine,getRules:()=>state.data.rules});
  const knownSubjects=new Map(),knownEpisodes=new Map(),imageCache=new Map(),imagePending=new Map(),imageErrors=[];let disposed=false,sourceSearch=null,imageGeneration=0,imageRetries=0,imageCancellations=0,imageCacheBytes=0;
  const clone=value=>JSON.parse(JSON.stringify(value));
  function remember(items){for(const item of items){knownSubjects.set(Number(item.id),item);while(knownSubjects.size>256)knownSubjects.delete(knownSubjects.keys().next().value);}return items;}
  function ruleById(id){const rule=state.data.rules.find(r=>(r.id||r.name)===id);if(!rule)throw new Error('番剧来源规则不存在');return rule;}
  const history=createHistory(state,{ruleById,normalizeUrl,findSubject:id=>knownSubjects.get(id),onChange:options.onHistoryChange});
  function publicRules(){return state.data.rules.map(r=>({...r,id:r.name,enabled:r.enabled!==false}));}
  async function sourceResults(keyword) {
    keyword=String(keyword||'').trim().slice(0,200);if(!keyword)throw new Error('请输入番剧名称');
    // One UI search at a time, 3 source workers; an abandoned search never queues 18 more jobs.
    if(sourceSearch)sourceSearch.cancelled=true;const token={cancelled:false};sourceSearch=token;
    const rules=state.data.rules.filter(r=>r.enabled!==false),sources=new Array(rules.length);let next=0;
    async function worker(){while(next<rules.length&&!token.cancelled&&!disposed){const index=next++,rule=rules[index];try{sources[index]=await discovery.search(rule.name,keyword);}catch(error){sources[index]={ruleId:rule.name,name:rule.name,items:[],error:error.message};}}}
    await Promise.all(Array.from({length:Math.min(3,rules.length)},worker));
    if(token.cancelled||disposed)throw new Error('搜索已取消');if(sourceSearch===token)sourceSearch=null;
    return {sources:sources.filter(Boolean)};
  }
  async function repository(){
    const raw=await network.json(repositoryUrl('index.json',state.data.network.rules),{ech:state.data.network.rules==='ghProxy'});
    if(!Array.isArray(raw))throw new Error('规则仓库返回无效目录');
    return {items:raw.filter(x=>x&&typeof x.name==='string'&&x.name.length<=80&&!/[\x00-\x1f\\/]/.test(x.name)).slice(0,200).map(x=>({...x,installed:state.data.rules.some(r=>r.name.toLowerCase()===x.name.toLowerCase())}))};
  }
  async function install(name,{onlyNewer=false}={}){
    name=String(name||'');if(!name||name.length>80||/[\x00-\x1f\\/]/.test(name))throw new Error('规则名称无效');
    const rule=validateRule(await network.json(repositoryUrl(encodeURIComponent(name)+'.json',state.data.network.rules),{ech:state.data.network.rules==='ghProxy'}));
    if(rule.name.toLowerCase()!==name.toLowerCase())throw new Error('仓库规则名称不匹配');
    const at=state.data.rules.findIndex(r=>r.name.toLowerCase()===name.toLowerCase());
    if(at>=0&&onlyNewer&&compareVersion(rule.version,state.data.rules[at].version)<=0)return false;
    if(at>=0){rule.enabled=state.data.rules[at].enabled!==false;state.data.rules[at]=rule;}else state.data.rules.push(rule);
    await state.save();return true;
  }
  function compareVersion(a,b){const av=String(a).split('.').map(Number),bv=String(b).split('.').map(Number);for(let i=0;i<Math.max(av.length,bv.length);i++){const d=(av[i]||0)-(bv[i]||0);if(d)return d;}return 0;}
  function invalidateImages(clearCache=false){imageGeneration++;imagePending.clear();if(clearCache){imageCache.clear();imageCacheBytes=0;}}
  function transientImageError(error){
    if(error?.name==='AbortError')return false;
    return error?.name==='TimeoutError'||/^来源返回 HTTP 5\d\d$/.test(error?.message||'')||/^(无法连接来源|fetch failed|ECH (?:5|6|7|18|28|35|52|55|56|92):|ECH native request timed out|ECH request deadline exceeded|ECH DoH lookup failed|ECH DoH HTTP 5\d\d|ECH response ended without headers)/i.test(error?.message||'');
  }
  function imageFailure(url,mode,attempt,error){
    if(error?.name==='AbortError'){imageCancellations++;return;}
    const parsed=new URL(url);imageErrors.push({at:new Date().toISOString(),host:parsed.hostname,path:parsed.pathname.slice(0,300),mode,attempt,name:String(error?.name||'Error').slice(0,40),error:String(error?.message||error).slice(0,250)});
    if(imageErrors.length>8)imageErrors.shift();
  }
  async function image(url){
    if(disposed)throw Object.assign(new Error('封面请求已取消'),{name:'AbortError'});
    safeHttpUrl(url);const mode=state.data.network.images,key=mode+':'+url,hit=imageCache.get(key);if(hit){imageCache.delete(key);imageCache.set(key,hit);return hit;}
    if(imagePending.has(key))return imagePending.get(key);
    const ticket=imageGeneration,checkCurrent=()=>{if(disposed||ticket!==imageGeneration)throw Object.assign(new Error('封面请求已取消'),{name:'AbortError'});};
    const task=(async()=>{
      const request=imageRequest(url,mode);let result,completedAttempt=0;
      // A failed connection must not permanently replace a real cover with a
      // placeholder. Retry once through the same bounded pool and same ECH
      // policy; navigation/configuration invalidation always wins.
      for(let attempt=1;attempt<=2;attempt++){
        try{checkCurrent();result=await network.request(request.url,{ech:request.ech,cache:'no-store'});checkCurrent();completedAttempt=attempt;break;}
        catch(error){imageFailure(url,mode,attempt,error);checkCurrent();if(attempt!==1||!transientImageError(error))throw error;imageRetries++;}
      }
      const declaredType=result.contentType.split(';')[0].trim().toLowerCase(),type=declaredType==='image/jpg'?'image/jpeg':declaredType;if(!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)){const error=new Error('封面来源未返回支持的图片');imageFailure(url,mode,completedAttempt,error);throw error;}
      checkCurrent();const item={bytes:result.bytes,contentType:type};imageCache.set(key,item);imageCacheBytes+=item.bytes.length;while((imageCacheBytes>IMAGE_CACHE_BYTES||imageCache.size>IMAGE_CACHE_ITEMS)&&imageCache.size){const oldest=imageCache.keys().next().value;imageCacheBytes-=imageCache.get(oldest).bytes.length;imageCache.delete(oldest);}return item;
    })().finally(()=>{if(imagePending.get(key)===task)imagePending.delete(key);});imagePending.set(key,task);return task;
  }
  async function request(action,payload={}) {
    if(disposed)throw new Error('番剧模块已关闭');if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('无效的番剧请求');
    switch(action){
      case 'cancel':if(sourceSearch)sourceSearch.cancelled=true;catalog.cancelPending();discovery.cancel();invalidateImages();network.cancel();return {canceled:true};
      case 'bootstrap':return clone({rules:publicRules(),network:state.data.network,networkOptions:NETWORK_OPTIONS,...history.snapshot(),categories:CATEGORIES,importedFrom:state.importedFrom});
      case 'home':{const result=await catalog.list({category:'热门'}),hot=remember(result.items);const featured=[...hot].sort((a,b)=>b.score-a.score||a.rank-b.rank).slice(0,5);return clone({hot,featured,...history.snapshot(),notice:result.notice});}
      case 'catalog':{const result=await catalog.list(payload);remember(result.items);return clone(result);}
      case 'detail':{const item=await catalog.detail(payload.id);remember([item]);return clone({item});}
      case 'searchSources':return sourceResults(payload.keyword);
      case 'searchSource':{const rule=ruleById(payload.ruleId),keyword=String(payload.keyword||'').trim().slice(0,200);if(!keyword||rule.enabled===false)throw new Error('无效的来源搜索');try{return await discovery.search(rule.name,keyword);}catch(error){if(error.name==='AbortError')throw error;return {ruleId:rule.name,name:rule.name,items:[],error:error.message};}}
      case 'episodes':{const rule=ruleById(payload.ruleId),sourceUrl=String(payload.url||'').slice(0,4096);const lines=await discovery.chapters(rule,sourceUrl);lines.forEach((line,roadIndex)=>line.episodes.forEach((episode,episodeIndex)=>knownEpisodes.set(rule.name+'\n'+episode.url,{title:episode.title,url:episode.url,context:{episodes:line.episodes,roadIndex,episodeIndex,sourceUrl}})));while(knownEpisodes.size>30000)knownEpisodes.delete(knownEpisodes.keys().next().value);return {ruleId:rule.name,lines};}
      case 'play':{
        const rule=ruleById(payload.ruleId),raw=payload.episode||{},url=normalizeUrl(rule.baseURL,raw.url||payload.episodeUrl||'');
        const episode=knownEpisodes.get(rule.name+'\n'+url);if(!episode)throw new Error('请先从当前来源选择剧集');
        const id=Number(payload.id||payload.subject?.id),subject=knownSubjects.get(id)||state.data.history.find(h=>h.subject?.id===id)?.subject;if(!subject)throw new Error('请先打开番剧详情');
        return clone({subject:{id:subject.id,title:subject.title,cover:subject.cover},rule:{id:rule.name,name:rule.name,baseURL:rule.baseURL,userAgent:rule.userAgent||'',referer:rule.referer||'',useLegacyParser:!!rule.useLegacyParser,adBlocker:!!rule.adBlocker},episode:{name:episode.title,url},episodes:episode.context?.episodes||[{title:episode.title,url}],sourceUrl:episode.context?.sourceUrl||'',roadIndex:episode.context?.roadIndex??Math.max(0,Math.floor(Number(payload.roadIndex)||0)),episodeIndex:episode.context?.episodeIndex??Math.max(0,Math.floor(Number(payload.episodeIndex)||0))});
      }
      case 'continue':{const previous=state.data.history.find(h=>h.id===Number(payload.id));if(!previous)throw new Error('未找到观看历史');remember([previous.subject]);if(previous.sourceUrl)await request('episodes',{ruleId:previous.ruleId,url:previous.sourceUrl});else knownEpisodes.set(previous.ruleId+'\n'+previous.episodeUrl,{title:previous.episodeName,url:previous.episodeUrl});const result=await request('play',{id:previous.id,ruleId:previous.ruleId,episode:{url:previous.episodeUrl},roadIndex:previous.roadIndex,episodeIndex:previous.episodeIndex});return {...result,position:previous.position};}
      case 'rules':return clone({rules:publicRules()});
      case 'ruleSave':{const rule=validateRule(payload.rule),at=state.data.rules.findIndex(r=>r.name.toLowerCase()===rule.name.toLowerCase());if(at<0){if(state.data.rules.length>=200)throw new Error('规则数量已达上限');state.data.rules.push(rule);}else state.data.rules[at]=rule;await state.save();return {rules:publicRules()};}
      case 'ruleDelete':{ruleById(payload.id);state.data.rules=state.data.rules.filter(r=>(r.id||r.name)!==payload.id);await state.save();return {rules:publicRules()};}
      case 'ruleToggle':{ruleById(payload.id).enabled=payload.enabled!==false;await state.save();return {rules:publicRules()};}
      case 'ruleReorder':{const ids=payload.ids;if(!Array.isArray(ids)||ids.length!==state.data.rules.length||new Set(ids).size!==ids.length)throw new Error('规则顺序无效');state.data.rules=ids.map(ruleById);await state.save();return {rules:publicRules()};}
      case 'ruleRepository':return repository();
      case 'ruleInstall':await install(payload.name);return {rules:publicRules()};
      case 'ruleUpdateAll':{const remote=await repository();const candidates=remote.items.filter(x=>state.data.rules.some(r=>r.name.toLowerCase()===x.name.toLowerCase()&&compareVersion(x.version,r.version)>0));const result={updated:0,failed:[]};for(const item of candidates){try{if(await install(item.name,{onlyNewer:true}))result.updated++;}catch(error){result.failed.push({name:item.name,error:error.message});}}return {...result,rules:publicRules()};}
      case 'networkSave':{state.data.network=validateNetwork({...state.data.network,...payload});catalog.clear();discovery.clear();invalidateImages(true);await state.save();return {network:state.data.network};}
      case 'historyProgress':case 'historySave':return history.save(payload);
      case 'history':return history.snapshot();
      case 'historyClear':return history.clear();
      default:throw new Error('未知的番剧操作');
    }
  }
  return {request,image,dispose(){disposed=true;if(sourceSearch)sourceSearch.cancelled=true;discovery.dispose();invalidateImages(true);network.dispose();knownSubjects.clear();knownEpisodes.clear();catalog.clear();return state.flush();},getStatus(){return {network:network.getStatus(),catalog:catalog.getStatus(),images:{cached:imageCache.size,bytes:imageCacheBytes,maxBytes:IMAGE_CACHE_BYTES,maxItems:IMAGE_CACHE_ITEMS,pending:imagePending.size,retries:imageRetries,canceled:imageCancellations,lastErrors:clone(imageErrors)},rules:state.data.rules.length,history:state.data.history.length,disposed};}};
}
module.exports={createAnimeService};
