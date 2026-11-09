'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMusicImages}=require('../src/music-images.cjs');
const request=(id,signal)=>new Request('pulse-music-image://image?url='+encodeURIComponent('https://p1.music.126.net/'+id+'.jpg'),{signal});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}});

test('Spotify artwork uses its 640px source, accepts actual recommendation CDN and bounds missing variant fallback',async t=>{
 const hash='6a7e6ceda5e779fbb6ec1ba8',small='https://i.scdn.co/image/ab67616d00004851'+hash,large='https://i.scdn.co/image/ab67616d0000b273'+hash,urls=[];
 const images=createMusicImages({fetchImpl:async url=>{urls.push(url);return response();}});t.after(()=>images.dispose());
 const req=url=>new Request('pulse-music-image://image?url='+encodeURIComponent(url));
 assert.equal((await images.handle(req(small))).status,200);assert.equal(urls[0],large);
 assert.equal((await images.handle(req('https://pickasso.spotifycdn.com/image/official.jpg'))).status,200);
 assert.equal((await images.handle(req('https://pickasso.spotifycdn.com.attacker.invalid/image.jpg'))).status,400);
 const fallback=[];const missing=createMusicImages({fetchImpl:async url=>{fallback.push(url);return url===large?new Response(null,{status:404}):response();}});t.after(()=>missing.dispose());
 assert.equal((await missing.handle(req(small))).status,200);assert.deepEqual(fallback,[large,small]);
});

test('covers request a bounded thumbnail and twenty-four loaded covers stay warm',async t=>{
  const urls=[],images=createMusicImages({fetchImpl:async url=>{urls.push(url);return response();}});t.after(()=>images.dispose());
  for(let id=0;id<24;id++)await images.handle(request(id));
  for(let id=0;id<24;id++)assert.equal((await images.handle(request(id))).status,200);
  assert.equal(urls.length,24);assert(urls.every(url=>new URL(url).searchParams.get('param')==='384y384'));
});

test('duplicate cover consumers share work and one cancellation does not cancel the other',async t=>{
  let resolve,calls=0,signal;const images=createMusicImages({fetchImpl:(_url,options)=>{calls++;signal=options.signal;return new Promise(done=>resolve=done);}});t.after(()=>images.dispose());
  const controller=new AbortController(),first=images.handle(request(1,controller.signal)),second=images.handle(request(1));await tick();
  assert.equal(calls,1);controller.abort();assert.equal((await first).status,502);assert.equal(signal.aborted,false);resolve(response());assert.equal((await second).status,200);
});

test('warm cache evicts by total bytes, not just by entry count',async t=>{
  let calls=0;const images=createMusicImages({cacheBytes:6,cacheEntries:10,fetchImpl:async()=>{calls++;return response();}});t.after(()=>images.dispose());
  for(let id=0;id<3;id++)await images.handle(request(id));assert.equal(images.getStatus().imageCount,2);
  await images.handle(request(0));assert.equal(calls,4);
});

test('official CDN image/jpg alias is accepted and served as image/jpeg',async t=>{
  let calls=0;const images=createMusicImages({fetchImpl:async()=>{calls++;return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpg'}});}});
  t.after(()=>images.dispose());
  for(let n=0;n<2;n++){const result=await images.handle(request(1));assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/jpeg');}
  assert.equal(calls,1);
});

test('a page of covers queues and all load while network concurrency stays at four',async t=>{
  let active=0,maxActive=0;const pending=[];
  const images=createMusicImages({fetchImpl:()=>new Promise(resolve=>{active++;maxActive=Math.max(maxActive,active);pending.push(()=>{active--;resolve(response());});})});
  t.after(()=>images.dispose());
  const tasks=Array.from({length:24},(_,index)=>images.handle(request(index)));
  await tick();assert.equal(pending.length,4);assert.equal(images.getStatus().queued,20);
  while(pending.length){pending.splice(0).forEach(finish=>finish());await tick();}
  assert.deepEqual((await Promise.all(tasks)).map(result=>result.status),Array(24).fill(200));
  assert.equal(maxActive,4);assert.deepEqual(images.getStatus(),{imageCount:24,active:0,queued:0});
});

test('canceling a queued cover does not start its network request or block the queue',async t=>{
  const pending=[],urls=[];
  const images=createMusicImages({concurrency:1,fetchImpl:url=>new Promise(resolve=>{urls.push(url);pending.push(()=>resolve(response()));})});
  t.after(()=>images.dispose());
  const controller=new AbortController(),first=images.handle(request(1)),canceled=images.handle(request(2,controller.signal)),last=images.handle(request(3));
  await tick();controller.abort();assert.equal((await canceled).status,502);
  assert.equal(images.getStatus().queued,1);pending.shift()();await first;await tick();
  assert.equal(urls.length,2);assert(new URL(urls[1]).pathname.endsWith('/3.jpg'));pending.shift()();assert.equal((await last).status,200);
});

test('queue overflow is bounded and disposing aborts active and waiting covers',async()=>{
  const images=createMusicImages({concurrency:1,queueLimit:2,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true}))});
  const tasks=[images.handle(request(1)),images.handle(request(2)),images.handle(request(3))];
  assert.equal((await images.handle(request(4))).status,429);await tick();
  images.dispose();assert.deepEqual((await Promise.all(tasks)).map(result=>result.status),[502,502,502]);
  assert.deepEqual(images.getStatus(),{imageCount:0,active:0,queued:0});
});
