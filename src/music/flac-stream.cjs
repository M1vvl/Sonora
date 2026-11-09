'use strict';

// Some authorized cloud FLACs contain picture tags Chromium's demuxer rejects.
// Keep STREAMINFO and the frame-relative seek table, then stream the original
// compressed frames. Only bounded metadata is retained, never the song bytes.
const {audioURL}=require('./media-policy.cjs');
const MAX_HEADER_BYTES=64*1024;
const MAX_METADATA_BYTES=32*1024*1024;
const MAX_BLOCKS=64;
const PREFIX_BYTES=8192;

async function boundedBytes(response,limit){
  const reader=response.body?.getReader();
  if(!reader)throw new Error('Missing FLAC metadata stream');
  const parts=[];
  let size=0;
  try{
    while(size<limit){
      const item=await reader.read();
      if(item.done)break;
      const bytes=Buffer.from(item.value).subarray(0,limit-size);
      parts.push(bytes);
      size+=bytes.length;
    }
    return Buffer.concat(parts,size);
  }finally{await reader.cancel().catch(()=>{});}
}

function contentRange(value){
  const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(value||'');
  if(!match)return null;
  const [start,end,total]=match.slice(1).map(Number);
  return [start,end,total].every(Number.isSafeInteger)&&start<=end&&end<total?{start,end,total}:null;
}

async function inspectFlac(fetchRange,signal){
  const first=await fetchRange(0,PREFIX_BYTES-1,signal);
  const range=contentRange(first.headers.get('content-range'));
  if(first.status!==206||range?.start!==0){await first.body?.cancel();throw new Error('FLAC source does not support byte ranges');}
  const prefix=await boundedBytes(first,PREFIX_BYTES);
  if(prefix.subarray(0,4).toString('ascii')!=='fLaC')throw new Error('Invalid FLAC signature');
  async function read(start,length){
    if(start+length<=prefix.length)return prefix.subarray(start,start+length);
    const response=await fetchRange(start,start+length-1,signal);
    const location=contentRange(response.headers.get('content-range'));
    if(response.status!==206||location?.start!==start||location.total!==range.total){await response.body?.cancel();throw new Error('Invalid FLAC metadata range');}
    const bytes=await boundedBytes(response,length);
    if(bytes.length!==length)throw new Error('Incomplete FLAC metadata');
    return bytes;
  }
  const blocks=[];
  let offset=4,keptBytes=4,last=false;
  for(let index=0;index<MAX_BLOCKS&&!last;index++){
    if(signal?.aborted)throw new Error('FLAC inspection canceled');
    const blockHeader=await read(offset,4);
    const type=blockHeader[0]&127,length=blockHeader.readUIntBE(1,3);
    last=!!(blockHeader[0]&128);
    if(index===0&&(type!==0||length!==34))throw new Error('Invalid FLAC STREAMINFO');
    if(type===127||offset+4+length>MAX_METADATA_BYTES||offset+4+length>=range.total)throw new Error('FLAC metadata limit exceeded');
    // Vorbis comments, embedded images, padding and application tags are not
    // required to decode frames. Song/cover information already comes via API.
    if(type===0||type===3&&keptBytes+4+length<=MAX_HEADER_BYTES){
      const bytes=Buffer.from(await read(offset,4+length));
      bytes[0]&=127;
      blocks.push(bytes);
      keptBytes+=bytes.length;
    }
    offset+=4+length;
  }
  if(!last)throw new Error('FLAC metadata block limit exceeded');
  blocks.at(-1)[0]|=128;
  const header=Buffer.concat([Buffer.from('fLaC'),...blocks],keptBytes);
  return {header,audioOffset:offset,removed:offset-header.length,total:range.total-(offset-header.length)};
}

function rangePlan(format,value){
  const match=value===null?null:/^bytes=(\d+)-(\d*)$/.exec(value||'');
  if(value!==null&&!match)return null;
  const start=match?Number(match[1]):0;
  const requestedEnd=match?.[2]?Number(match[2]):format.total-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||start<0||start>=format.total||requestedEnd<start)return null;
  const end=Math.min(requestedEnd,format.total-1);
  const prefix=start<format.header.length?format.header.subarray(start,Math.min(end+1,format.header.length)):Buffer.alloc(0);
  const sourceStart=end>=format.header.length?Math.max(start,format.header.length)+format.removed:null;
  return {start,end,prefix,sourceStart,sourceEnd:end+format.removed,length:end-start+1,status:match?206:200};
}

function createFlacStream({url,fetchImpl}){
  const source=audioURL(url);
  if(!source)throw new Error('Invalid FLAC audio host');
  let disposed=false,preflight=null,formatPromise=null,activeRequests=0;
  const controllers=new Set();
  async function fetchRange(start,end,signal,method='GET'){
    let target=source;
    for(let redirects=0;redirects<=3;redirects++){
      const response=await fetchImpl(target.href,{method,headers:{Range:`bytes=${start}-${end}`,'Cache-Control':'no-store',Pragma:'no-cache'},signal,redirect:'manual',credentials:'omit',cache:'no-store'});
      if(![301,302,303,307,308].includes(response.status))return response;
      await response.body?.cancel();
      target=audioURL(new URL(response.headers.get('location')||'',target).href);
      if(!target)throw new Error('Untrusted FLAC redirect');
    }
    throw new Error('Too many FLAC redirects');
  }
  function ready(){
    if(!formatPromise){
      preflight=new AbortController();
      const controller=preflight,timer=setTimeout(()=>controller.abort(),8000);
      formatPromise=inspectFlac(fetchRange,controller.signal).finally(()=>{clearTimeout(timer);if(preflight===controller)preflight=null;});
    }
    return formatPromise;
  }
  async function handle(request){
    if(disposed)return new Response(null,{status:404});
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    const requestedRange=request.headers.get('range');
    if(requestedRange&&!/^bytes=\d+-\d*$/.test(requestedRange))return new Response(null,{status:416});
    if(activeRequests>=3)return new Response(null,{status:429});
    activeRequests++;
    const controller=new AbortController();
    controllers.add(controller);
    const abort=()=>controller.abort();
    request.signal?.addEventListener('abort',abort,{once:true});
    if(request.signal?.aborted)abort();
    let timer=setTimeout(abort,12000),reader,released=false;
    function release(){
      if(released)return;
      released=true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort',abort);
      controllers.delete(controller);
      activeRequests--;
    }
    try{
      const format=await ready();
      if(disposed||controller.signal.aborted)throw new Error('FLAC stream canceled');
      const plan=rangePlan(format,requestedRange);
      if(!plan){release();return new Response(null,{status:416,headers:{'Content-Range':`bytes */${format.total}`}});}
      const headers=new Headers({'Content-Type':'audio/flac','Content-Length':String(plan.length),'Accept-Ranges':'bytes','Cache-Control':'no-store, max-age=0',Pragma:'no-cache',Expires:'0','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
      if(plan.status===206)headers.set('Content-Range',`bytes ${plan.start}-${plan.end}/${format.total}`);
      if(request.method==='HEAD'){release();return new Response(null,{status:plan.status,headers});}
      if(plan.sourceStart===null){release();return new Response(plan.prefix,{status:plan.status,headers});}
      const response=await fetchRange(plan.sourceStart,plan.sourceEnd,controller.signal);
      const location=contentRange(response.headers.get('content-range'));
      if(response.status!==206||location?.start!==plan.sourceStart||location.end!==plan.sourceEnd||location.total!==format.total+format.removed){await response.body?.cancel();throw new Error('Invalid FLAC payload range');}
      reader=response.body?.getReader();
      if(!reader)throw new Error('Missing FLAC payload');
      clearTimeout(timer);timer=null;
      let prefix=plan.prefix,remaining=plan.length-prefix.length;
      const body=new ReadableStream({
        async pull(output){
          try{
            if(prefix.length){output.enqueue(prefix);prefix=Buffer.alloc(0);return;}
            const item=await reader.read();
            if(item.done){if(remaining!==0)throw new Error('Incomplete FLAC payload');release();output.close();return;}
            const bytes=item.value.subarray(0,remaining);
            remaining-=bytes.byteLength;
            if(bytes.byteLength)output.enqueue(bytes);
            if(!remaining){await reader.cancel();release();output.close();}
          }catch(error){release();output.error(error);}
        },
        async cancel(){controller.abort();release();await reader.cancel().catch(()=>{});}
      });
      return new Response(body,{status:plan.status,headers});
    }catch{controller.abort();release();await reader?.cancel().catch(()=>{});return new Response(null,{status:502});}
  }
  return {handle,dispose(){if(disposed)return;disposed=true;preflight?.abort();for(const controller of controllers)controller.abort();controllers.clear();formatPromise=null;}};
}

module.exports={createFlacStream,inspectFlac,rangePlan,contentRange,MAX_HEADER_BYTES,MAX_METADATA_BYTES,MAX_BLOCKS};
