'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMusicStream}=require('../src/music-stream.cjs');
const {inspectFlac,MAX_METADATA_BYTES}=require('../src/music/flac-stream.cjs');

function block(type,bytes,last=false){
  const header=Buffer.alloc(4);
  header[0]=type|(last?128:0);
  header.writeUIntBE(bytes.length,1,3);
  return Buffer.concat([header,bytes]);
}
function fixture(){
  const info=block(0,Buffer.alloc(34,1));
  const seek=block(3,Buffer.alloc(36,2));
  const picture=block(6,Buffer.alloc(420000,3));
  const comment=block(4,Buffer.from('unneeded-comment'));
  const padding=block(1,Buffer.alloc(64),true);
  const frames=Buffer.alloc(4096);
  for(let at=0;at<frames.length;at++)frames[at]=at%251;
  const original=Buffer.concat([Buffer.from('fLaC'),info,seek,picture,comment,padding,frames]);
  const retainedSeek=Buffer.from(seek);retainedSeek[0]|=128;
  return {original,frames,expected:Buffer.concat([Buffer.from('fLaC'),info,retainedSeek,frames])};
}
function server(original){
  const calls=[];
  return {calls,async fetchImpl(url,options){
    assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');
    assert(!options.headers.cookie);
    const match=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
    assert(match);
    const start=Number(match[1]),end=Math.min(Number(match[2]),original.length-1);
    calls.push({url,start,end,signal:options.signal});
    if(start>end)return new Response(null,{status:416});
    return new Response(original.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${original.length}`,'content-length':String(end-start+1),'content-type':'audio/mpeg'}});
  }};
}

test('a cloud FLAC drops optional malformed picture tags and preserves compressed frames byte-for-byte',async()=>{
  const {original,expected}=fixture(),upstream=server(original),stream=createMusicStream(upstream);
  const url=stream.prepare('https://m803.music.126.net/owned.flac');
  const response=await stream.handle(new Request(url));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'audio/flac');
  assert.equal(response.headers.get('content-length'),String(expected.length));
  assert.equal(response.headers.get('content-range'),null);
  assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
  // Header discovery skips the embedded image by range instead of reading it.
  assert(upstream.calls.slice(0,-1).reduce((sum,row)=>sum+row.end-row.start+1,0)<9000);
  stream.dispose();
});

test('virtual byte ranges, header-only requests and end-clamping preserve browser seeking',async()=>{
  const {original,expected}=fixture(),upstream=server(original),stream=createMusicStream(upstream);
  const url=stream.prepare('https://m803.music.126.net/owned.flac');
  for(const [start,end] of [[0,25],[30,100],[78,100],[100,300],[expected.length-32,expected.length+100]]){
    const response=await stream.handle(new Request(url,{headers:{Range:`bytes=${start}-${end}`}}));
    const boundedEnd=Math.min(end,expected.length-1);
    assert.equal(response.status,206);
    assert.equal(response.headers.get('content-range'),`bytes ${start}-${boundedEnd}/${expected.length}`);
    assert.equal(response.headers.get('content-length'),String(boundedEnd-start+1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected.subarray(start,boundedEnd+1));
  }
  const calls=upstream.calls.length;
  const head=await stream.handle(new Request(url,{method:'HEAD'}));
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(expected.length));
  assert.equal(upstream.calls.length,calls);
  for(const range of ['bytes=0-1,5-8','bytes=-20',`bytes=${expected.length}-`,'bytes=12-2']){
    assert.equal((await stream.handle(new Request(url,{headers:{Range:range}}))).status,416);
  }
  stream.dispose();
});

test('FLAC redirects cannot escape provider CDN policy',async()=>{
  let calls=0;
  const stream=createMusicStream({fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://untrusted.example/track.flac'}});}});
  const url=stream.prepare('https://m803.music.126.net/owned.flac');
  assert.equal((await stream.handle(new Request(url))).status,502);
  assert.equal(calls,1);stream.dispose();
});

test('an unbounded or invalid FLAC metadata chain is rejected without reading its tag payload',async()=>{
  const prefix=Buffer.concat([Buffer.from('fLaC'),block(0,Buffer.alloc(34)),Buffer.from([6,255,255,255])]);
  let calls=0;
  await assert.rejects(inspectFlac(async start=>{
    calls++;
    return new Response(start===0?prefix:Buffer.from([6,255,255,255]),{status:206,headers:{'content-range':`bytes ${start}-${start+(start===0?prefix.length:4)-1}/${MAX_METADATA_BYTES*4}`}});
  },new AbortController().signal),/limit|Incomplete/);
  assert(calls<=3);
});

test('track replacement cancels pending FLAC initialization and invalidates the old opaque address',async()=>{
  let pendingSignal;
  const stream=createMusicStream({fetchImpl:async(_url,options)=>{
    pendingSignal=options.signal;
    return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('canceled')),{once:true}));
  }});
  const url=stream.prepare('https://m803.music.126.net/owned.flac');
  const pending=stream.handle(new Request(url));
  await Promise.resolve();
  stream.prepare('https://m803.music.126.net/next.mp3');
  assert(pendingSignal.aborted);
  assert.equal((await pending).status,502);
  assert.equal((await stream.handle(new Request(url))).status,404);
  stream.dispose();
});

test('concurrent FLAC range requests share initialization and retain the three-request limit',async()=>{
  const {original,expected}=fixture(),upstream=server(original);
  let releaseInitial;
  const gate=new Promise(resolve=>{releaseInitial=resolve;});
  const stream=createMusicStream({fetchImpl:async(url,options)=>{
    if(options.headers.Range==='bytes=0-8191')await gate;
    return upstream.fetchImpl(url,options);
  }});
  const url=stream.prepare('https://m803.music.126.net/owned.flac');
  const pending=[0,100,500].map(start=>stream.handle(new Request(url,{headers:{Range:`bytes=${start}-${start+20}`}})));
  assert.equal((await stream.handle(new Request(url))).status,429);
  releaseInitial();
  const responses=await Promise.all(pending);
  for(let at=0;at<responses.length;at++){
    assert.equal(responses[at].status,206);
    const start=[0,100,500][at];
    assert.deepEqual(Buffer.from(await responses[at].arrayBuffer()),expected.subarray(start,start+21));
  }
  assert.equal(upstream.calls.filter(row=>row.start===0&&row.end===8191).length,1);
  stream.dispose();
});
