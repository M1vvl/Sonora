'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {jsonPath,template,renderValue,normalizeUrl,apiRequest,xpathRequest,parseSearch,parseChapters,validateRule}=require('../src/anime/rule-engine.cjs');
const {NETWORK_DEFAULTS,validateNetwork,repositoryUrl,imageRequest,safeHttpUrl}=require('../src/anime/config.cjs');
const {createNetwork}=require('../src/anime/network.cjs');
const {createAnimeService}=require('../src/anime/index.cjs');
const defaults=require('../src/anime/default-rules.json');
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pulse-anime-'));

test('installed 18-rule snapshot validates all API levels and unchanged source templates',()=>{
  assert.equal(defaults.length,18);for(const rule of defaults){const result=validateRule(rule);assert.equal(result.name,rule.name);assert.equal(result.searchURL,rule.searchURL);assert.equal(result.searchMode,rule.searchMode);assert.deepEqual(result.searchApiConfig,rule.searchApiConfig);}
});
test('restricted JSONPath reads only named children, wildcard, quoted key and index; refuses code',()=>{
  const value={data:[{id:1},{id:2}],"a.b":{x:3}};
  assert.deepEqual(jsonPath(value,'$.data[*].id'),[1,2]);assert.deepEqual(jsonPath(value,"$['a.b'].x"),[3]);assert.deepEqual(jsonPath(value,'$.data[1].id'),[2]);
  assert.throws(()=>jsonPath(value,'$.data[?(@.id)]'));
  assert.deepEqual(jsonPath({},'$.__proto__'),[]);
});
test('templates preserve types in whole-variable bodies and encode URL variables once',()=>{
  assert.deepEqual(renderValue({name:'@keyword',page:'@page',enabled:true}, {keyword:'葬送 A&B',page:2}),{name:'葬送 A&B',page:2,enabled:true});
  assert.equal(template('/search/@keyword',{keyword:'A&B 中文'},{encoded:true}),'/search/A%26B%20%E4%B8%AD%E6%96%87');assert.throws(()=>template('@missing',{}));
  const request=apiRequest(defaults.find(r=>r.name==='TvTFun').searchApiConfig.request,{keyword:'A&B'});assert.equal(new URL(request.url).searchParams.get('keyword'),'A&B');
});
test('XPath search scopes // relative to each matched node and never executes embedded scripts',()=>{
  const rule={searchMode:'xpath',searchList:'//ul/li',searchName:'//h2/a',searchResult:'//h2/a'};
  const html='<ul><li><h2><a href="/a">甲</a></h2></li><li><h2><a href="/b">乙</a></h2></li></ul><script>throw new Error("executed")</script>';
  assert.deepEqual(parseSearch(rule,html),[{title:'甲',url:'/a'},{title:'乙',url:'/b'}]);
});
test('XPath text node search and multi-road chapter names preserve Kazumi semantics',()=>{
  const rule={baseURL:'https://anime.example/base/',chapterRoads:'//ul',chapterResult:'//li/a'};
  assert.deepEqual(parseChapters(rule,'<ul><li><a href="/e1">第 1 集</a></li></ul><ul><li><a href="//anime.example/e2/">第二集</a></li></ul>','/a'),[{name:'播放线路1',episodes:[{title:'第1集',url:'https://anime.example/e1'}]},{name:'播放线路2',episodes:[{title:'第二集',url:'https://anime.example/e2'}]}]);
  assert.deepEqual(parseSearch({searchList:'//li',searchName:'//span/text()',searchResult:'//a'},'<li><span>文字</span><a href="a"></a></li>'),[{title:'文字',url:'a'}]);
});
test('API search keeps scalar IDs and applies sourceTemplate without double encoding',()=>{
  const rule=defaults.find(r=>r.name==='TvTFun');assert.deepEqual(parseSearch(rule,JSON.stringify({data:{items:[{name:'番剧',slug:'abc-2'}]}})),[{title:'番剧',url:'https://www.tvtfun.net/watch/abc-2/1'}]);
});
test('nested API episodes render source and episodeUrl plus both zero and one-based indices',()=>{
  const rule=defaults.find(r=>r.name==='sorani'),lines=parseChapters(rule,JSON.stringify({data:{episodes:[{episodeLabel:'第1集',episodeOrder:1},{episodeLabel:'第2集',episodeOrder:2}]}}),'42');
  assert.equal(lines[0].episodes[1].url,'https://www.sorani.net/anime/mal/42/episode/2');
});
test('delimited API handles embedded dollar URL components and skips missing separators',()=>{
  const rule=defaults.find(r=>r.name==='giriGiriLove');
  const lines=parseChapters(rule,JSON.stringify({info:{vod_play_from:'线路A$$$线路B',vod_play_url:'第1集$https://media.example/a?x=$1#坏条目$$$第2集$/b'}}),'1');
  assert.equal(lines.length,2);assert.equal(lines[0].episodes[0].url,'https://media.example/a?x=$1');assert.equal(lines[1].episodes[0].url,'https://ani.girigirilove.com/b');
});
test('POST legacy requests use form query, relative URL keeps cross-site scheme and canonical path',()=>{
  const request=xpathRequest({searchURL:'https://anime.example/find?q=@keyword',usePost:true},'A B',true);assert.equal(request.url,'https://anime.example/find');assert.equal(request.options.body,'q=A+B');
  assert.equal(normalizeUrl('https://a.example/base/','http://a.example/a/'),'https://a.example/a');assert.equal(normalizeUrl('https://a.example/','http://b.example/a/'),'http://b.example/a');
});
test('network modes match original Kazumi defaults and ECH image source rules',()=>{
  assert.deepEqual(validateNetwork(),NETWORK_DEFAULTS);assert.throws(()=>validateNetwork({images:'fake'}));
  assert.equal(repositoryUrl('index.json','ghProxy'),'https://gh-proxy.org/https://raw.githubusercontent.com/Predidit/KazumiRules/main/index.json');
  assert.deepEqual(imageRequest('http://lain.bgm.tv/pic/a.jpg','ech'),{url:'https://lain.bgm.tv/pic/a.jpg',ech:true});
  assert.equal(new URL(imageRequest('https://lain.bgm.tv/a.gif','mirror').url).searchParams.get('n'),'-1');
  assert.equal(imageRequest('https://other.example/a.jpg','ech').ech,false);
  assert.throws(()=>safeHttpUrl('file:///c:/secret'));assert.throws(()=>safeHttpUrl('http://127.0.0.1/'));
});
test('request pool caps concurrency, rejects oversized response, cancel frees active and queued work',async()=>{
  let active=0,max=0;const fetchImpl=async(_url,{signal})=>{active++;max=Math.max(max,active);await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,20);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'));},{once:true});});active--;return new Response('ok');};
  const network=createNetwork({fetchImpl,concurrency:2});await Promise.all(Array.from({length:5},()=>network.text('https://example.com/')));assert.equal(max,2);
  const pending=Array.from({length:5},()=>network.text('https://example.com/'));network.cancel();const result=await Promise.allSettled(pending);assert(result.every(x=>x.status==='rejected'));assert.equal(network.getStatus().queued,0);network.dispose();
  const large=createNetwork({fetchImpl:async()=>new Response('123456'),maxBytes:4});await assert.rejects(large.text('https://example.com/'),/大小限制/);large.dispose();
});
test('network cancellation is distinguishable from timeout and real upstream failures',async()=>{
  const hanging=async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Error')),{once:true}));
  const cancelled=createNetwork({fetchImpl:hanging,concurrency:1}),active=cancelled.text('https://example.com/'),queued=cancelled.text('https://example.com/');cancelled.cancel();
  await assert.rejects(active,error=>error.name==='AbortError'&&error.message==='请求已取消');await assert.rejects(queued,{name:'AbortError'});cancelled.dispose();
  const timeout=createNetwork({fetchImpl:hanging,timeout:5}),keepAlive=setTimeout(()=>{},1000);
  try{await assert.rejects(timeout.text('https://example.com/'),error=>error.name==='TimeoutError'&&error.message.includes('请求超时'));}finally{clearTimeout(keepAlive);timeout.dispose();}
  const failed=createNetwork({fetchImpl:async()=>new Response('unavailable',{status:503})});await assert.rejects(failed.text('https://example.com/'),/HTTP 503/);failed.dispose();
});
test('service imports original rules once, history is blank until actual progress and state round-trips',async()=>{
  const dir=fixture(),installedRulesPath=path.join(dir,'absent.json');let requests=0;
  const fetchImpl=async(url)=>{requests++;if(url.includes('/subjects/42'))return Response.json({id:42,name:'Test',images:{large:'https://img.example/a.jpg'},rating:{score:8,rank:2,total:10},summary:'说明'});if(url.includes('get_detail'))return Response.json({info:{vod_play_from:'线路1',vod_play_url:'第1集$https://media.example/e1.m3u8'}});throw new Error('unexpected '+url);};
  let service=createAnimeService({dataDir:dir,installedRulesPath,fetchImpl});let result=await service.request('bootstrap');assert.equal(result.rules.length,18);assert.deepEqual(result.history,[]);assert.equal(requests,0);
  await service.request('detail',{id:42});await service.request('episodes',{ruleId:'giriGiriLove',url:'1'});
  const playback=await service.request('play',{id:42,ruleId:'giriGiriLove',episode:{url:'https://media.example/e1.m3u8'}});assert.equal(playback.episode.name,'第1集');assert.equal((await service.request('history')).history.length,0);
  await assert.rejects(service.request('play',{id:42,ruleId:'giriGiriLove',episode:{url:'https://evil.example/arbitrary'}}),/先从当前来源/);
  await service.request('historyProgress',{subject:playback.subject,ruleId:'giriGiriLove',episodeName:'第1集',episodeUrl:playback.episode.url,position:35,duration:1400});await service.request('networkSave',{images:'mirror'});await service.dispose();
  service=createAnimeService({dataDir:dir,installedRulesPath,fetchImpl});result=await service.request('bootstrap');assert.equal(result.history[0].position,35);assert.equal(result.history[0].subject.title,'Test');assert.equal(result.network.images,'mirror');await service.dispose();fs.rmSync(dir,{recursive:true,force:true});
});
test('rule modifications persist independently, reject invalid reorder and retain complete inactive API config',async()=>{
  const dir=fixture(),service=createAnimeService({dataDir:dir,installedRulesPath:path.join(dir,'absent')});const all=(await service.request('bootstrap')).rules;
  await assert.rejects(service.request('ruleReorder',{ids:all.map(()=>all[0].id)}));
  await service.request('ruleReorder',{ids:all.map(r=>r.id).reverse()});assert.equal((await service.request('rules')).rules[0].name,all.at(-1).name);
  const rule={...all.find(x=>x.name==='TvTFun'),searchMode:'xpath',searchURL:'https://example.com/?q=@keyword',searchList:'//li',searchName:'//a',searchResult:'//a'};
  await service.request('ruleSave',{rule});assert.deepEqual((await service.request('rules')).rules.find(x=>x.name==='TvTFun').searchApiConfig,rule.searchApiConfig);
  await service.dispose();fs.rmSync(dir,{recursive:true,force:true});
});
