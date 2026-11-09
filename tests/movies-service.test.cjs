'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createMoviesService}=require('../src/movies/index.cjs');
const {parseLines,parsePage,groupItems}=require('../src/movies/cms.cjs');
const {createCache}=require('../src/movies/cache.cjs');
const seeds=[{id:'a',name:'Alpha',url:'https://alpha.example/api.php/provide/vod'},{id:'b',name:'Beta',url:'https://beta.example/api.php/provide/vod'}];
const vod=(id,name='片名',year='2026',play='第01集$https://media.example/1.m3u8#第02集$https://media.example/2.m3u8')=>({vod_id:id,vod_name:name,vod_year:year,vod_pic:'https://images.example/poster.jpg',type_name:'动作片',vod_play_url:play,vod_play_from:'线路A',vod_content:'<p>真实简介</p>'});
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
async function fixture(t,{fetchImpl,sources=seeds}={}){const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pulse-movies-'));const changes=[],calls=[];const api=fetchImpl||(async(url,init)=>{calls.push(String(url));const u=new URL(url);if(u.hostname==='movie.douban.com')return new Response('blocked',{status:403});if(u.hostname==='images.example')return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});if(u.searchParams.get('ac')==='list')return json({class:[{type_id:1,type_name:'电影'},{type_id:6,type_name:'动作片'}]});return json({page:Number(u.searchParams.get('pg'))||1,pagecount:2,total:2,list:[vod(u.searchParams.get('ids')||u.searchParams.get('pg')||'1')]});});
  const service=createMoviesService({dataDir,fetchImpl:api,sources:sources===null?undefined:sources,onHistoryChange:value=>changes.push(value)});t.after(async()=>{await service.dispose();await fs.rm(dataDir,{recursive:true,force:true});});return {service,dataDir,calls,changes};}

test('CMS parser preserves named roads and dollar URL data, ignores non-video redirects and adult categories',()=>{
  const lines=parseLines('中转$https://source.example/share/1$$$正片$https://media.example/a$part.m3u8?token=x#第二集$https://media.example/b.mp4','iframe$$$direct');
  assert.equal(lines.length,1);assert.equal(lines[0].name,'direct');assert.equal(lines[0].episodes[0].url,'https://media.example/a$part.m3u8?token=x');
  const result=parsePage({list:[vod('1','同名','2020'),vod('2','同名','2021'),{...vod('3'),type_name:'伦理片'}]},seeds[0]);assert.equal(result.items.length,2);assert.equal(groupItems([...result.items,{...result.items[0],sourceId:'b',vodId:'9'}]).length,2);
  assert.throws(()=>parsePage({list:{}},seeds[0]),/无效/);assert.equal(parseLines(Array.from({length:5100},(_,n)=>n+'$https://cdn.example/'+n+'.mp4').join('#'))[0].episodes.length,5000);
});

test('fresh portable service loads bundled sources without source folders or a server runtime',async t=>{
  const f=await fixture(t,{sources:null});const bootstrap=await f.service.request('bootstrap');assert.deepEqual(bootstrap.categories.slice(0,4),['主页','热门','电影','电视剧']);assert.equal(bootstrap.rules.length,6);assert.equal(bootstrap.history.length,0);assert.equal(bootstrap.settings.adFilter,true);assert(f.calls.length===0,'bootstrap performs no background request');
});

test('full search aggregates same title/year across providers and includes results beyond recommendations',async t=>{
  const f=await fixture(t);const result=await f.service.request('catalog',{query:'钢之炼金术士',category:'喜剧'});assert(result.items.length>0);assert.equal(result.items.length,1);assert.equal(result.items[0].alternatives.length,4);assert(f.calls.every(value=>!value.includes('movie.douban.com')));assert(f.calls.filter(value=>new URL(value).searchParams.get('wd')==='钢之炼金术士').length===4);assert(!Object.hasOwn(result.items[0],'lines'));
});

test('recommendation failure falls back to provider catalogs and source pagination follows pagecount',async t=>{
  const f=await fixture(t);const home=await f.service.request('home');assert.equal(home.hot.length,1);assert.equal(home.featured.length,1);const next=await f.service.request('catalog',{category:'热门',offset:24});assert.equal(next.hasMore,false);assert.equal(next.nextOffset,48);assert(f.calls.some(value=>new URL(value).searchParams.get('pg')==='2'));
  const action=await f.service.request('catalog',{category:'动作'});assert(action.items.length>0);assert(f.calls.some(value=>new URL(value).searchParams.get('t')==='6'));
});

test('empty chapter matches are never selectable and valid episodes create direct native playback plans',async t=>{
  const f=await fixture(t,{fetchImpl:async(url)=>{const u=new URL(url);return json({pagecount:1,list:u.hostname==='alpha.example'?[vod('no','空条目','','网页$https://example.org/share/1')]:[vod('ok')]});}});
  const missing=await f.service.request('searchSource',{ruleId:'a',keyword:'片名'}),valid=await f.service.request('searchSource',{ruleId:'b',keyword:'片名'});assert.equal(missing.items.length,0);assert.equal(valid.items.length,1);
  await f.service.request('episodes',{ruleId:'b',url:valid.items[0].url});const catalog=await f.service.request('catalog',{query:'片名'});await f.service.request('detail',{id:catalog.items[0].id});const plan=await f.service.request('play',{id:catalog.items[0].id,ruleId:'b',episode:{url:'https://media.example/1.m3u8'}});assert.equal(plan.kind,'movies');assert.equal(plan.media.format,'hls');assert.equal(plan.episodeIndex,0);assert(plan.subject.id.startsWith('film:'));await assert.rejects(f.service.request('play',{id:plan.subject.id,ruleId:'b',episode:{url:'https://evil.example/unknown.m3u8'}}),/先从/);
});

test('real playback progress persists atomically, publishes after commit and resumes after a new service',async t=>{
  const f=await fixture(t);const result=await f.service.request('catalog',{query:'片名'}),subject=result.items[0];const found=await f.service.request('searchSource',{ruleId:'a',keyword:subject.title});await f.service.request('episodes',{ruleId:'a',url:found.items[0].url});const plan=await f.service.request('play',{id:subject.id,ruleId:'a',episode:{url:'https://media.example/1.m3u8'}});
  await assert.rejects(f.service.request('historyProgress',{subject:plan.subject,ruleId:'a',position:0,episodeUrl:plan.episode.url}),/播放后/);await f.service.request('historyProgress',{subject:plan.subject,ruleId:'a',position:43.25,duration:600,episodeName:plan.episode.name,episodeUrl:plan.episode.url,sourceUrl:plan.sourceUrl});
  assert.equal(f.changes.length,1);const disk=JSON.parse(await fs.readFile(path.join(f.dataDir,'movies-state.json'),'utf8'));assert.equal(disk.history[0].position,43.25);assert.equal(disk.historyRevision,1);
  const second=createMoviesService({dataDir:f.dataDir,sources:[],fetchImpl:async()=>json({list:[vod('1')]})});try{const resumed=await second.request('continue',{id:subject.id});assert.equal(resumed.position,43.25);assert.equal(resumed.media.url,plan.media.url);}finally{await second.dispose();}
});

test('source edits and playback writes serialize without losing either preference or history',async t=>{
  const f=await fixture(t);const result=await f.service.request('catalog',{query:'片名'}),subject=result.items[0];await Promise.all([f.service.request('settingsSave',{adFilter:false}),f.service.request('sourceSave',{source:{name:'Gamma',url:'https://gamma.example/api.php/provide/vod'}}),f.service.request('historyProgress',{subject,ruleId:'a',position:5,episodeUrl:'https://media.example/1.m3u8'})]);
  const boot=await f.service.request('bootstrap');assert.equal(boot.rules.length,3);assert.equal(boot.settings.adFilter,false);assert.equal(boot.history.length,1);await f.service.request('sourceToggle',{id:'a',enabled:false});assert.equal((await f.service.request('rules')).rules[0].enabled,false);await assert.rejects(f.service.request('sourceSave',{source:{name:'private',url:'http://127.0.0.1/'}}),/本地/);
});

test('cancel aborts active and queued requests, disposed services release caches and reject future work',async t=>{
  const pending=[];const f=await fixture(t,{fetchImpl:async(url,init)=>new Promise((resolve,reject)=>{pending.push(init.signal);init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});})});
  const first=f.service.request('searchSource',{ruleId:'a',keyword:'pending'});await new Promise(resolve=>setTimeout(resolve,5));await f.service.request('cancel');await assert.rejects(first,{name:'AbortError'});assert(pending.every(signal=>signal.aborted));await f.service.dispose();assert.equal(f.service.getStatus().network.active,0);await assert.rejects(f.service.request('bootstrap'),/已关闭/);
});

test('an individual Electron AbortError does not cancel successful search results from other providers',async t=>{
  const f=await fixture(t,{fetchImpl:async url=>{
    const u=new URL(url);if(u.hostname==='alpha.example')throw new DOMException('The operation was aborted','AbortError');
    return json({pagecount:1,list:[vod('good','流浪地球')]});
  }});
  const result=await f.service.request('catalog',{query:'流浪地球'});
  assert.equal(result.items.length,1);assert.equal(result.items[0].title,'流浪地球');
  const rules=(await f.service.request('rules')).rules;
  assert.equal(rules.find(rule=>rule.id==='a').status,'unavailable');assert.match(rules.find(rule=>rule.id==='a').error,/中断/);
  assert.equal(rules.find(rule=>rule.id==='b').status,'available');
});

test('JSON cache enforces byte and entry budgets without retaining oversized values',()=>{const cache=createCache({maxEntries:2,maxBytes:30});cache.set('a','abc');cache.set('b','def');cache.get('a');cache.set('c','ghi');assert.equal(cache.get('b'),undefined);cache.set('huge','x'.repeat(40));assert.equal(cache.get('huge'),undefined);assert(cache.bytes<=30);cache.clear();assert.equal(cache.bytes,0);});

test('switching providers resumes the same episode position rather than restarting a film',async t=>{
  const f=await fixture(t,{fetchImpl:async url=>{const parsed=new URL(url),prefix=parsed.hostname==='beta.example'?'b':'a';return json({pagecount:1,list:[vod('1','同一影片','2026',`正片$https://media.example/${prefix}.m3u8`)]});}});
  const catalog=await f.service.request('catalog',{query:'同一影片'}),subject=catalog.items[0];
  for(const source of ['a','b']){const result=await f.service.request('searchSource',{ruleId:source,keyword:'同一影片'});await f.service.request('episodes',{ruleId:source,url:result.items[0].url});}
  await f.service.request('historyProgress',{subject,ruleId:'a',position:81.5,duration:900,episodeIndex:0,episodeUrl:'https://media.example/a.m3u8'});
  const switched=await f.service.request('play',{id:subject.id,ruleId:'b',episode:{url:'https://media.example/b.m3u8'}});assert.equal(switched.position,81.5);assert.equal(switched.media.url,'https://media.example/b.m3u8');
});

test('shared poster requests coalesce and cancellation cannot cache an obsolete completion',async t=>{
  let imageCalls=0,complete;
  const f=await fixture(t,{fetchImpl:async()=>{imageCalls++;await new Promise(resolve=>complete=resolve);return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});}});
  const first=f.service.image('https://images.example/a.png'),second=f.service.image('https://images.example/a.png');assert.equal(imageCalls,1);
  await f.service.request('cancel');complete();const result=await Promise.allSettled([first,second]);assert(result.every(item=>item.status==='rejected'&&item.reason.name==='AbortError'));assert.equal(f.service.getStatus().imageCache,0);assert.equal(f.service.getStatus().imagePending,0);
});

test('transient source failures retry once, repeated failures cool down and manual probing recovers',async t=>{
  let calls=0,broken=true;
  const f=await fixture(t,{sources:[seeds[0]],fetchImpl:async()=>{calls++;return broken?new Response('unavailable',{status:503}):json({list:[vod('ok')],pagecount:1});}});
  for(let i=0;i<3;i++){const result=await f.service.request('searchSource',{ruleId:'a',keyword:'失败'+i});assert.equal(result.items.length,0);}
  assert.equal(calls,6);const stopped=await f.service.request('searchSource',{ruleId:'a',keyword:'暂停'});assert.match(stopped.error,/暂停重复请求/);assert.equal(calls,6);
  const rules=await f.service.request('rules');assert(rules.rules[0].retryAt>Date.now());
  broken=false;await f.service.request('probeSources');const recovered=await f.service.request('searchSource',{ruleId:'a',keyword:'恢复'});assert.equal(recovered.items.length,1);assert(calls>6);
});
