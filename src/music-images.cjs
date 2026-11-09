'use strict';

// Covers use a small CDN thumbnail, shared work and a bounded warm cache.
function thumbnailURL(value,size=384){
  const url=require('./music/media-policy.cjs').imageURL(value);
  if(!url)throw new Error('Invalid image');
  // These official album variants share the same artwork identity. Request
  // Spotify's 640px source so the stage and metal card do not enlarge 64px art.
  if(url.hostname==='i.scdn.co')url.pathname=url.pathname.replace(/^\/image\/ab67616d(?:00004851|00001e02|0000aa54)([a-f0-9]{24})$/i,'/image/ab67616d0000b273$1');
  if(!/\.music\.126\.net$/.test(url.hostname))return url.href;
  const existing=/^(\d+)y(\d+)$/.exec(url.searchParams.get('param')||'');
  const side=Math.max(32,Math.min(512,existing?Math.min(size,Math.max(Number(existing[1]),Number(existing[2]))):size));
  url.searchParams.set('param',`${side}y${side}`);return url.href;
}
function createMusicImages({fetchImpl,concurrency=4,queueLimit=64,cacheBytes=8*1024*1024,cacheEntries=64}={}){
  const cache=new Map(),jobs=new Set(),queue=[],inflight=new Map(),byteLimit=2*1024*1024;
  let active=0,disposed=false;
  const headers=type=>({'Content-Type':type,'Cache-Control':'private, max-age=1800','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'});
  const respond=item=>new Response(item.bytes,{headers:headers(item.type)});
  function cached(key){const item=cache.get(key);if(!item)return null;if(Date.now()-item.at>=1800000){cache.delete(key);return null;}cache.delete(key);cache.set(key,item);return item;}
  function pump(){while(!disposed&&active<concurrency&&queue.length){const job=queue.shift();if(job.controller.signal.aborted){job.reject(new Error('Canceled image'));continue;}job.controller.signal.removeEventListener('abort',job.cancelQueued);active++;job.started=true;job.resolve();}}
  function acquire(job){return new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;job.cancelQueued=()=>{const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);job.controller.signal.removeEventListener('abort',job.cancelQueued);reject(new Error('Canceled image'));};if(disposed||job.controller.signal.aborted){reject(new Error('Canceled image'));return;}job.controller.signal.addEventListener('abort',job.cancelQueued,{once:true});queue.push(job);pump();});}
  async function load(key,job){
    const {controller}=job;let timer;
    try{
      await acquire(job);if(disposed||controller.signal.aborted)throw new Error('Canceled image');const hit=cached(key);if(hit)return hit;
      timer=setTimeout(()=>controller.abort(),10000);let result;
      for(let attempt=0;attempt<2;attempt++){
        try{result=await fetchImpl(key,{signal:controller.signal,redirect:'error',credentials:'omit'});if(result.status>=500&&attempt===0){await result.body?.cancel().catch(()=>{});continue;}break;}
        catch(error){if(attempt!==0||controller.signal.aborted)throw error;}
      }
      if(result.status===404&&job.fallback){await result.body?.cancel().catch(()=>{});result=await fetchImpl(job.fallback,{signal:controller.signal,redirect:'error',credentials:'omit'});}
      const declaredType=result.headers.get('content-type')?.split(';')[0].trim().toLowerCase(),type=declaredType==='image/jpg'?'image/jpeg':declaredType;
      if(!result.ok||!['image/png','image/jpeg','image/webp','image/gif'].includes(type)||Number(result.headers.get('content-length'))>byteLimit){await result.body?.cancel().catch(()=>{});throw new Error('Invalid image');}
      const reader=result.body?.getReader();if(!reader)throw new Error('Missing image');const chunks=[];let length=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;if(controller.signal.aborted)throw new Error('Canceled image');length+=value.length;if(length>byteLimit)throw new Error('Image too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
      const bytes=Buffer.concat(chunks);if(!bytes.length||disposed||controller.signal.aborted)throw new Error('Empty image');const item={at:Date.now(),bytes,type};cache.delete(key);cache.set(key,item);
      while(cache.size>cacheEntries||[...cache.values()].reduce((sum,value)=>sum+value.bytes.length,0)>cacheBytes)cache.delete(cache.keys().next().value);return item;
    }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',job.cancelQueued);jobs.delete(job);if(job.started)active--;if(inflight.get(key)===job)inflight.delete(key);pump();}
  }
  async function handle(request){
    if(request.method!=='GET'||disposed)return new Response(null,{status:405});let key,fallback;
    try{const value=new URL(request.url).searchParams.get('url');if(!value||value.length>4096)throw new Error();key=thumbnailURL(value);const original=require('./music/media-policy.cjs').imageURL(value);if(original.hostname==='i.scdn.co'&&original.href!==key)fallback=original.href;}catch{return new Response(null,{status:400});}
    if(request.signal?.aborted)return new Response(null,{status:502});const hit=cached(key);if(hit)return respond(hit);let job=inflight.get(key);
    if(!job){if(queue.length>=queueLimit)return new Response(null,{status:429});job={controller:new AbortController(),started:false,consumers:new Set(),fallback};jobs.add(job);inflight.set(key,job);job.promise=load(key,job);}
    const consumer={};job.consumers.add(consumer);let cancel;
    const aborted=new Promise((_resolve,reject)=>{cancel=()=>{job.consumers.delete(consumer);if(!job.consumers.size)job.controller.abort();reject(new Error('Canceled image'));};request.signal?.addEventListener('abort',cancel,{once:true});});
    try{return respond(await Promise.race([job.promise,aborted]));}catch{return new Response(null,{status:502});}finally{request.signal?.removeEventListener('abort',cancel);job.consumers.delete(consumer);}
  }
  return {handle,getStatus:()=>({imageCount:cache.size,active,queued:queue.length}),dispose(){if(disposed)return;disposed=true;for(const job of jobs)job.controller.abort();cache.clear();}};
}
module.exports={createMusicImages,thumbnailURL};
