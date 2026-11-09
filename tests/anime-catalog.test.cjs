'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCatalog,pagination}=require('../src/anime/catalog.cjs');
const subject=id=>({id,name_cn:'番剧 '+id,rating:{score:8},images:{large:'https://lain.bgm.tv/'+id+'.jpg'}});
const page=(start,count)=>Array.from({length:count},(_,index)=>subject(start+index));
const settings=()=>({bangumi:'mirror'});

test('keyword search queries the full Bangumi catalog without leaking UI tab labels or previous tags',async()=>{
  const calls=[],catalog=createCatalog({json:async(url,options)=>{calls.push({url,options});return {data:[{id:1428,name_cn:'钢之炼金术师 FULLMETAL ALCHEMIST'}],total:1,limit:20,offset:0};}},settings);
  const result=await catalog.list({category:'搜索',query:'钢之炼金术士'});
  assert.equal(result.items[0].id,1428);assert.equal(result.total,1);assert.equal(result.hasMore,false);
  assert.match(calls[0].url,/limit=20&offset=0$/);assert.equal(calls[0].options.ech,true);
  const request=JSON.parse(calls[0].options.body);assert.equal(request.keyword,'钢之炼金术士');assert.deepEqual(request.filter.tag,[]);assert.deepEqual(request.filter.type,[2]);
  await catalog.list({category:'悬疑',query:'钢之炼金术士'});assert.equal(calls.length,1,'same global search does not inherit a category and shares its cache');
});
test('mirror pages with no total continue by raw count even when IDs overlap or records are malformed',async()=>{
  const calls=[],catalog=createCatalog({json:async(url)=>{calls.push(url);const offset=Number(new URL(url).searchParams.get('offset'));return offset===0?{data:[...page(1,22),subject(22),null]}:{data:page(22,24)};}},settings);
  const first=await catalog.list({category:'日常'});assert.equal(first.items.length,23);assert.equal(first.rawCount,24);assert.equal(first.nextOffset,24);assert.equal(first.total,null);assert.equal(first.hasMore,true);
  const second=await catalog.list({category:'日常',offset:first.nextOffset});assert.equal(second.nextOffset,48);assert.equal(second.hasMore,true);assert.equal(new URL(calls[1]).searchParams.get('offset'),'24');assert.equal(new URL(calls[1]).searchParams.get('tag'),'日常');
  assert(first.items.some(a=>second.items.some(b=>a.id===b.id)),'overlap must not corrupt the server offset');
});
test('pagination honors an enforced server limit, known zero and actual exhaustion without fabricating an infinite list',()=>{
  assert.deepEqual(pagination({data:page(1,20),total:50,limit:20},0,24),{items:page(1,20).map(subject=>({id:subject.id,title:subject.name_cn,originalTitle:'',summary:'',cover:subject.images.large,coverLarge:subject.images.large,score:8,rank:0,votes:0,popularity:null,tags:[],airDate:'',episodeCount:0,url:'https://bangumi.tv/subject/'+subject.id})),total:50,offset:0,nextOffset:20,hasMore:true,rawCount:20,limit:20});
  assert.equal(pagination({data:page(41,10),total:50,limit:20},40,24).hasMore,false);
  assert.equal(pagination({data:[],total:0},0,24).total,0);assert.equal(pagination({data:[],total:0},0,24).hasMore,false);
  assert.equal(pagination({data:page(1,23)},0,24).hasMore,false);
  assert.equal(pagination([],24,24).nextOffset,24);assert.equal(pagination([],24,24).hasMore,false);
  assert.throws(()=>pagination({error:'unavailable'},0,24),/无效的列表/);
});
test('categories do not invent filters and errors remain retryable at the same offset',async()=>{
  let calls=0;const catalog=createCatalog({json:async url=>{calls++;if(calls===1)throw new Error('HTTP 503');assert.equal(new URL(url).searchParams.get('offset'),'48');assert.equal(new URL(url).searchParams.has('tag'),false);return {data:page(49,24)};}},settings);
  await assert.rejects(catalog.list({category:'热门',offset:48}),/503/);const result=await catalog.list({category:'热门',offset:48});assert.equal(result.nextOffset,72);assert.equal(calls,2);
  await assert.rejects(catalog.list({offset:Number.MAX_SAFE_INTEGER}),/翻页位置/);
});
test('changing network settings invalidates pending cache generations without erasing a newer in-flight request',async()=>{
  const resolvers=[];const catalog=createCatalog({json:()=>new Promise(resolve=>resolvers.push(resolve))},settings);
  const old=catalog.list({category:'热门'});catalog.clear();const next=catalog.list({category:'热门'});
  resolvers[0]({data:page(1,24)});await assert.rejects(old,{name:'AbortError'});assert.equal(catalog.getStatus().pending,1);
  resolvers[1]({data:page(25,24)});const result=await next;assert.equal(result.items[0].id,25);assert.equal(catalog.getStatus().pending,0);assert.equal(catalog.getStatus().entries,1);
  assert.equal((await catalog.list({category:'热门'})).items[0].id,25);
});
test('navigation cancellation keeps successful pages cached but never reuses an aborted same-key promise',async()=>{
  let count=0;const resolvers=[];
  const catalog=createCatalog({json:url=>{count++;if(new URL(url).searchParams.get('tag')==='日常')return Promise.resolve({data:page(1,24)});return new Promise(resolve=>resolvers.push(resolve));}},settings);
  await catalog.list({category:'日常'});
  const aborted=catalog.list({category:'热门'});catalog.cancelPending();
  const retry=catalog.list({category:'热门'});assert.equal(resolvers.length,2);
  resolvers[0]({data:page(1,24)});await assert.rejects(aborted,{name:'AbortError'});
  resolvers[1]({data:page(25,24)});assert.equal((await retry).items[0].id,25);
  assert.equal((await catalog.list({category:'日常'})).items[0].id,1);assert.equal(count,3,'navigation does not discard completed page caches');
});

test('unsupported mirror categories use the exact official tag and keep that provider cursor for later pages',async()=>{
  for(const tag of ['科幻','冒险','运动','音乐']){
    const calls=[],catalog=createCatalog({json:async(url,options)=>{calls.push({url,options});if(url.includes('api.kazumi.fyi'))return {data:[]};return {data:page(Number(new URL(url).searchParams.get('offset'))+1,20),limit:20,total:60};}},settings);
    const first=await catalog.list({category:tag});assert.equal(first.items.length,20);assert.equal(first.nextOffset,20);assert.equal(first.hasMore,true);
    assert.equal(JSON.parse(calls[1].options.body).filter.tag[0],tag);assert.equal(calls[1].options.ech,true);
    await catalog.list({category:tag,offset:first.nextOffset});assert.equal(calls.length,3);assert(calls[2].url.includes('api.bgm.tv'));assert.equal(new URL(calls[2].url).searchParams.get('offset'),'20');
    catalog.clear();await catalog.list({category:tag});assert(calls[3].url.includes('api.kazumi.fyi'),'a settings reset re-evaluates the category route');
  }
});

test('a mirror category error falls back precisely, while normal mirror exhaustion never restarts another provider',async()=>{
  const calls=[],catalog=createCatalog({json:async(url,options)=>{calls.push({url,options});if(url.includes('api.kazumi.fyi'))throw new Error('HTTP 503');return {data:[subject(7)],total:1,limit:20};}},settings);
  const result=await catalog.list({category:'科幻'});assert.equal(result.items[0].id,7);assert.deepEqual(JSON.parse(calls[1].options.body).filter.tag,['科幻']);
  let official=0;const ending=createCatalog({json:async(url)=>{if(url.includes('api.bgm.tv'))official++;return Number(new URL(url).searchParams.get('offset'))===0?{data:page(1,24)}:{data:[]};}},settings);
  await ending.list({category:'日常'});const end=await ending.list({category:'日常',offset:24});assert.equal(end.hasMore,false);assert.equal(official,0);
});


test('catalog preserves separate large artwork for a hero without enlarging list thumbnails',()=>{const {normalizeSubject}=require('../src/anime/catalog.cjs');const result=normalizeSubject({id:123,name:'高清番剧',images:{common:'https://lain.bgm.tv/r/400/pic/cover/l/a.jpg',large:'https://lain.bgm.tv/pic/cover/l/a.jpg'}});assert.equal(result.cover,'https://lain.bgm.tv/r/400/pic/cover/l/a.jpg');assert.equal(result.coverLarge,'https://lain.bgm.tv/pic/cover/l/a.jpg');});
