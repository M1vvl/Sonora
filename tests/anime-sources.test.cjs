const test=require('node:test'),assert=require('node:assert/strict');
const {createSourceDiscovery}=require('../src/anime/source-discovery.cjs');
test('title matches without episodes never become selectable playback sources',async()=>{
  let chapters=0;const rule={name:'example',version:'1'},module=createSourceDiscovery({getRules:()=>[rule],engine:{search:async()=>[{title:'有正片',url:'/1'},{title:'空页',url:'/2'},{title:'站点错误',url:'/3'}],chapters:async(_rule,url)=>{chapters++;if(url==='/3')throw new Error('HTTP 503');return url==='/1'?[{name:'线路',episodes:[{title:'1',url:'https://media.test/1.mp4'}]}]:[];}}});
  const result=await module.search('example','中文番剧');assert.equal(result.items.length,1);assert.equal(result.items[0].verifiedEpisodes,true);assert.equal(result.unavailable,2);
  await module.chapters(rule,'/1');assert.equal(chapters,3,'selecting a verified source reuses the original chapter parse');module.dispose();
});
test('cancellation discards old search results and rule version invalidates chapter cache',async()=>{
  let finish,count=0;const rule={name:'example',version:'1'},module=createSourceDiscovery({getRules:()=>[rule],engine:{search:()=>new Promise(resolve=>finish=resolve),chapters:async()=>{count++;return [{episodes:[{url:'https://media.test/1'}]}];}}});
  const pending=module.search('example','keyword');module.cancel();finish([{url:'/1'}]);await assert.rejects(pending,/已取消/);assert.equal(count,0);
  await module.chapters(rule,'/1');await module.chapters(rule,'/1');rule.version='2';await module.chapters(rule,'/1');assert.equal(count,2);module.dispose();
});
test('old cancelled chapter cleanup cannot delete a new same-key request',async()=>{
  const finishes=[];let count=0;const rule={name:'example'},module=createSourceDiscovery({getRules:()=>[rule],engine:{chapters:()=>{count++;return new Promise(resolve=>finishes.push(resolve));}}});
  const old=module.chapters(rule,'/1');module.cancel();const fresh=module.chapters(rule,'/1');
  finishes[0]([{episodes:[{url:'https://media.test/old'}]}]);await assert.rejects(old,{name:'AbortError'});
  const reused=module.chapters(rule,'/1');assert.equal(count,2);
  finishes[1]([{episodes:[{url:'https://media.test/new'}]}]);assert.deepEqual(await reused,await fresh);module.dispose();
});
test('chapter cache bounds retained episode graphs while oversized seasons still return in full',async()=>{
  let count=0;const rule={name:'example'},module=createSourceDiscovery({maxCachedEpisodes:3,getRules:()=>[rule],engine:{chapters:async(_rule,url)=>{count++;return [{episodes:Array.from({length:url==='/big'?4:2},(_,n)=>({url:'https://media.test/'+n}))}];}}});
  await module.chapters(rule,'/a');await module.chapters(rule,'/b');await module.chapters(rule,'/a');assert.equal(count,3);
  assert.equal((await module.chapters(rule,'/big'))[0].episodes.length,4);await module.chapters(rule,'/big');assert.equal(count,5);module.dispose();
});
test('single and aggregate service searches share chapter validation and cache',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createAnimeService}=require('../src/anime/index.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-sources-')),rule={name:'test',baseURL:'https://source.test',searchURL:'https://source.test/search?keyword=@keyword',searchList:'//li',searchName:'//a',searchResult:'//a',chapterRoads:'//ul',chapterResult:'//a'};
  fs.writeFileSync(path.join(dir,'anime-state.json'),JSON.stringify({rules:[rule],history:[]}));let chapters=0;
  const service=createAnimeService({dataDir:dir,fetchImpl:async url=>{if(url.includes('/search?'))return new Response('<li><a href="/valid">有正片</a></li><li><a href="/empty">无集数</a></li>');chapters++;return new Response(url.endsWith('/valid')?'<ul><a href="/episode">第1集</a></ul>':'<div>暂无集数</div>');}});
  try{const single=await service.request('searchSource',{ruleId:'test',keyword:'番剧'}),all=await service.request('searchSources',{keyword:'番剧'});assert.equal(single.items.length,1);assert.deepEqual(all.sources[0].items,single.items);assert.equal(chapters,2);}finally{await service.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});
