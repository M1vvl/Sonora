'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAnimeService}=require('../src/anime/index.cjs');
function fixture(fetchImpl){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-images-'));const service=createAnimeService({dataDir:dir,installedRulesPath:path.join(dir,'absent'),fetchImpl});return {service,async close(){await service.dispose();fs.rmSync(dir,{recursive:true,force:true});}};}
const response=value=>new Response(value,{headers:{'content-type':'image/jpeg'}}),url='https://lain.bgm.tv/pic/test.jpg';

test('anime cover MIME validation accepts the CDN image/jpg alias',async()=>{
  const f=fixture(async()=>new Response('cover',{headers:{'content-type':'image/jpg; charset=binary'}}));
  try{assert.equal((await f.service.image(url)).contentType,'image/jpeg');}finally{await f.close();}
});

test('transient image errors retry once with identical ECH policy and share pending/cache',async()=>{
  const calls=[],f=fixture(async(target,options)=>{calls.push({target,ech:options.ech});if(calls.length===1)return new Response('temporary',{status:503});return response('image');});
  try{const [a,b]=await Promise.all([f.service.image(url),f.service.image(url)]);assert.equal(a,b);assert.equal((await f.service.image(url)),a);assert.deepEqual(calls,[{target:url,ech:true},{target:url,ech:true}]);const status=f.service.getStatus().images;assert.equal(status.retries,1);assert.equal(status.lastErrors[0].error,'来源返回 HTTP 503');assert.equal(status.cached,1);}finally{await f.close();}
});
test('404, verification challenges, invalid image responses and ECH acceptance failures never retry',async()=>{
  for(const [fetch,error] of [
    [async()=>new Response('missing',{status:404}),/HTTP 404/],
    [async()=>new Response('verify',{headers:{'cf-mitigated':'challenge'}}),/人工完成验证/],
    [async()=>new Response('html',{headers:{'content-type':'text/html'}}),/支持的图片/],
    [async()=>{throw new Error('ECH acceptance was not verified');},/acceptance/]
  ]){let count=0;const f=fixture(async(...args)=>{count++;return fetch(...args);});try{await assert.rejects(f.service.image(url),error);assert.equal(count,1);assert.equal(f.service.getStatus().images.retries,0);}finally{await f.close();}}
});
test('cancelled image completion cannot cache stale pixels or delete a new same-key pending request',async()=>{
  const finishes=[];let calls=0;const f=fixture(()=>{calls++;return new Promise(resolve=>finishes.push(resolve));});
  try{const old=f.service.image(url);await f.service.request('cancel');const fresh=f.service.image(url);finishes[0](response('old'));await assert.rejects(old,{name:'AbortError'});const reused=f.service.image(url);assert.equal(calls,2);assert.equal(f.service.getStatus().images.cached,0);finishes[1](response('new'));assert.equal((await reused).bytes.toString(),'new');await fresh;assert.equal(f.service.getStatus().images.retries,0);assert.equal(f.service.getStatus().images.lastErrors.length,0);}finally{await f.close();}
});
test('network change invalidates in-flight images and retries stop after one failure',async()=>{
  let finish,calls=0;const f=fixture(async()=>{calls++;if(calls===1)return new Promise(resolve=>finish=resolve);return new Response('temporary',{status:502});});
  try{const old=f.service.image(url);await f.service.request('networkSave',{images:'direct'});finish(response('old'));await assert.rejects(old,{name:'AbortError'});assert.equal(f.service.getStatus().images.cached,0);await assert.rejects(f.service.image(url),/HTTP 502/);assert.equal(calls,3);assert.equal(f.service.getStatus().images.retries,1);assert.equal(f.service.getStatus().images.cached,0);}finally{await f.close();}
});
test('image diagnostics retain only the last eight failures without query strings or image bytes',async()=>{
  const f=fixture(async()=>new Response('missing',{status:404}));
  try{for(let i=0;i<10;i++)await assert.rejects(f.service.image(url+'?secret='+i));const status=f.service.getStatus().images;assert.equal(status.lastErrors.length,8);assert.equal(status.lastErrors[0].host,'lain.bgm.tv');assert.equal(status.lastErrors[0].path,'/pic/test.jpg');assert(!JSON.stringify(status).includes('secret'));assert(!JSON.stringify(status).includes('missing'));}finally{await f.close();}
});
test('compressed artwork LRU stays within 8 MiB and 32 entries, reuses hits and releases on dispose',async()=>{
  let calls=0;const f=fixture(async(target,options)=>{calls++;assert.equal(options.cache,'no-store');return response(Buffer.alloc(target.includes('large')?1024*1024:16));});
  try{
    for(let i=0;i<10;i++)await f.service.image(url+'?large='+i);
    let status=f.service.getStatus().images;assert.equal(status.bytes,8*1024*1024);assert.equal(status.cached,8);
    await f.service.image(url+'?large=2');assert.equal(calls,10);
    await f.service.image(url+'?large=0');assert.equal(calls,11);
    await f.service.request('networkSave',{images:'direct'});assert.equal(f.service.getStatus().images.bytes,0);
    for(let i=0;i<40;i++)await f.service.image(url+'?small='+i);
    status=f.service.getStatus().images;assert.equal(status.cached,32);assert.equal(status.bytes,32*16);
    await f.service.dispose();assert.equal(f.service.getStatus().images.bytes,0);assert.equal(f.service.getStatus().images.cached,0);
  }finally{await f.close();}
});
test('anime protocol and upstream session disable secondary HTTP caches',async()=>{
  const {installAnimeBridge}=require('../src/anime-bridge.cjs');let protocolHandler,partition;
  const bridge=installAnimeBridge({electron:{ipcMain:{handle(){},removeHandler(){}},protocol:{handle:(_name,value)=>protocolHandler=value,unhandle(){}},session:{fromPartition:(name,options)=>{partition={name,options};return {setPermissionRequestHandler(){},setPermissionCheckHandler(){},closeAllConnections(){}};}}},root:path.resolve(__dirname,'..'),dataDir:'unused',factories:{createTransport:()=>({dispose(){}}),createService:()=>({image:async()=>({bytes:Buffer.from('image'),contentType:'image/jpeg'}),dispose(){}})}});
  try{const result=await protocolHandler({method:'GET',url:'pulse-anime-image://image?url='+encodeURIComponent(url)});assert.equal(result.headers.get('cache-control'),'no-store');assert.deepEqual(partition,{name:'pulse-anime-api',options:{cache:false}});}finally{await bridge.dispose();}
});
