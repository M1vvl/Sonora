'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createCipheriv}=require('node:crypto');
const {createQualityProbe,parseVariants,mediaInfo,qualityLabel}=require('../src/media-stream/quality-probe.cjs');
const {createNetwork}=require('../src/anime/network.cjs');
const {parseMp4VideoResolution}=require('../src/media-stream/libretv-codec.cjs');
const base='https://cdn.example/movie/index.m3u8';
function box(type,payload=Buffer.alloc(0)){const bytes=Buffer.alloc(8+payload.length);bytes.writeUInt32BE(bytes.length);bytes.write(type,4,4,'ascii');payload.copy(bytes,8);return bytes;}
function mp4(width=1920,height=1080){
  const sample=Buffer.alloc(40);sample.writeUInt16BE(width,24);sample.writeUInt16BE(height,26);
  const stsd=box('stsd',Buffer.concat([Buffer.from([0,0,0,0,0,0,0,1]),box('avc1',sample)]));
  return Buffer.concat([box('ftyp',Buffer.from('isom')),box('moov',box('trak',box('mdia',box('minf',box('stbl',stsd)))))]);
}
const response=(url,value)=>({url,bytes:Buffer.isBuffer(value)?value:Buffer.from(value),contentType:'application/octet-stream'});
const abortError=()=>Object.assign(new Error('cancelled'),{name:'AbortError'});

test('master variants rank actual dimensions and never infer 4K from bitrate alone',async()=>{
  const text='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=90000000\nunknown.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=10000000,RESOLUTION=3840x2160\n4k.m3u8';
  const variants=parseVariants(text,base);assert.equal(variants[0].url,'https://cdn.example/movie/4k.m3u8');assert.equal(variants.at(-1).width,undefined);
  let calls=0;const probe=createQualityProbe({request:async url=>{calls++;return response(url,text);}});
  try{const result=await probe.probe(base);assert.equal(result.width,3840);assert.equal(result.height,2160);assert.equal(result.method,'manifest');assert.match(result.label,/4K/);assert.equal(calls,1);}finally{probe.dispose();}
});

test('bandwidth-only masters remain unknown when selected media has no measurable codec header',async()=>{
  const requests=[],probe=createQualityProbe({request:async(url,options)=>{requests.push({url,options});if(url===base)return response(url,'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=99000000\nvariant.m3u8');if(url.endsWith('variant.m3u8'))return response(url,'#EXTM3U\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST');return response(url,Buffer.alloc(200));}});
  try{const result=await probe.probe(base);assert.equal(result.width,null);assert.equal(result.height,null);assert.equal(result.method,'unknown');assert.doesNotMatch(result.label,/4K|1080p/);assert.equal(requests.at(-1).options.responsePrefixBytes,96*1024);}finally{probe.dispose();}
});

test('codec header dimensions and fMP4 init are measured without fetching an entire video',async()=>{
  const fixture=mp4(2560,1440);assert.deepEqual(parseMp4VideoResolution(fixture),{width:2560,height:1440});
  const calls=[],probe=createQualityProbe({request:async(url,options)=>{calls.push({url,options});return response(url,url===base?'#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nsegment.m4s\n#EXT-X-ENDLIST':fixture);}});
  try{const result=await probe.probe(base);assert.equal(result.method,'segment');assert.equal(result.width,2560);assert.equal(result.height,1440);assert.equal(calls.length,2);assert(calls[1].url.endsWith('/init.mp4'));assert.equal(calls[1].options.responsePrefixBytes,64*1024);assert.match(calls[1].options.headers.Range,/^bytes=0-65535$/);}finally{probe.dispose();}
});

function encryptedProbe({ivHex,sequence='9'}={}){
  const key=Buffer.from('00112233445566778899aabbccddeeff','hex'),iv=Buffer.alloc(16);
  if(ivHex)Buffer.from(ivHex.padStart(32,'0'),'hex').copy(iv);else iv.writeBigUInt64BE(BigInt(sequence),8);
  const source=mp4(1920,1080),plain=Buffer.alloc(Math.ceil(source.length/16)*16);source.copy(plain);
  const cipher=createCipheriv('aes-128-cbc',key,iv);cipher.setAutoPadding(false);const bytes=Buffer.concat([cipher.update(plain),cipher.final()]);
  const playlist='#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:'+sequence+'\n#EXT-X-KEY:METHOD=AES-128,URI="key-one.bin"'+(ivHex?',IV=0x'+ivHex:'')+'\n#EXTINF:6,\nfirst.ts\n#EXT-X-KEY:METHOD=AES-128,URI="key-two.bin",IV=0xffffffffffffffffffffffffffffffff\n#EXTINF:6,\nsecond.ts\n#EXT-X-ENDLIST';
  const calls=[],probe=createQualityProbe({request:async(url,options)=>{calls.push({url,options});if(url===base)return response(url,playlist);if(url.endsWith('/key-one.bin'))return response(url,key);if(url.endsWith('/first.ts'))return response(url,bytes);throw new Error('Later key/segment must not be used');}});
  return {probe,calls,playlist};
}

test('AES probe uses the key active for the first segment and derives default IV from sequence',async()=>{
  const f=encryptedProbe();try{
    const info=mediaInfo(f.playlist,base);assert.equal(info.key,'https://cdn.example/movie/key-one.bin');assert.equal(info.segment,'https://cdn.example/movie/first.ts');assert.equal(String(info.sequence),'9');
    const result=await f.probe.probe(base,{adFilter:false});assert.equal(result.width,1920);assert.equal(result.height,1080);assert(!f.calls.some(item=>/key-two|second/.test(item.url)));assert.equal(f.calls.find(item=>item.url.endsWith('key-one.bin')).options.responsePrefixBytes,16);
  }finally{f.probe.dispose();}
});

test('explicit short hexadecimal IV is left padded and must not be replaced with the media sequence',async()=>{
  const f=encryptedProbe({ivHex:'1',sequence:'9'});try{const result=await f.probe.probe(base,{adFilter:false});assert.equal(result.width,1920);assert.equal(result.height,1080);}finally{f.probe.dispose();}
});

test('default IV preserves an HLS sequence beyond Number safe integer precision',async()=>{
  const f=encryptedProbe({sequence:'9007199254740993'});try{assert.equal(BigInt(mediaInfo(f.playlist,base).sequence),9007199254740993n);const result=await f.probe.probe(base,{adFilter:false});assert.equal(result.width,1920);assert.equal(result.height,1080);}finally{f.probe.dispose();}
});

test('quality labels expose exact cropped dimensions and do not call 1080 portrait native 4K',()=>{
  assert.match(qualityLabel({width:1920,height:756}),/1920×756/);assert.match(qualityLabel({width:1920,height:756}),/宽幅/);
  assert.match(qualityLabel({width:1080,height:1920}),/1080p/);assert.doesNotMatch(qualityLabel({width:1080,height:1920}),/4K/);assert.match(qualityLabel({width:3840,height:2160}),/4K/);
});

test('prefix requests accept a huge upstream content length but cancel after the bounded first chunk',async()=>{
  let reads=0,cancels=0,releases=0;const chunk=new Uint8Array(1024*1024).fill(7);
  const network=createNetwork({maxBytes:6*1024*1024,fetchImpl:async()=>({ok:true,url:base,headers:new Headers({'Content-Type':'video/mp2t','Content-Length':String(100*1024*1024)}),body:{getReader:()=>({async read(){reads++;return {done:false,value:chunk};},async cancel(){cancels++;},releaseLock(){releases++;}})}})});
  try{const result=await network.request(base,{responsePrefixBytes:96*1024,headers:{Range:'bytes=0-98303'}});assert.equal(result.bytes.length,96*1024);assert.equal(reads,1);assert.equal(cancels,1);assert.equal(releases,1);assert(result.bytes.every(byte=>byte===7));}finally{network.dispose();}
});

test('range-ignoring 200 responses still stop at the requested prefix',async()=>{
  let cancelled=false;
  const network=createNetwork({fetchImpl:async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(4000));},cancel(){cancelled=true;}}),{status:200,headers:{'Content-Type':'video/mp4'}})});
  try{const result=await network.request(base,{responsePrefixBytes:5000});assert.equal(result.bytes.length,5000);assert(cancelled);}finally{network.dispose();}
});

test('non-streaming responses cannot fall back to an unbounded full arrayBuffer for a prefix probe',async()=>{
  let loaded=false;const network=createNetwork({fetchImpl:async()=>({ok:true,url:base,headers:new Headers({'Content-Length':String(100*1024*1024)}),arrayBuffer:async()=>{loaded=true;return new ArrayBuffer(100*1024*1024);}})});
  try{await assert.rejects(network.request(base,{responsePrefixBytes:16}));assert.equal(loaded,false);}finally{network.dispose();}
});

test('external abort cancels the active fetch rather than waiting for the network timeout',async()=>{
  let activeSignal,calls=0;const network=createNetwork({fetchImpl:async(_url,options)=>new Promise((_resolve,reject)=>{calls++;activeSignal=options.signal;activeSignal.addEventListener('abort',()=>reject(activeSignal.reason),{once:true});})});
  try{const controller=new AbortController(),pending=network.request(base,{responsePrefixBytes:16,signal:controller.signal});assert.equal(calls,1);controller.abort(abortError());await assert.rejects(pending,{name:'AbortError'});assert.equal(activeSignal.aborted,true);}finally{network.dispose();}
});

test('cancelled stale completion cannot cache old metadata or delete a newer same-key request',async()=>{
  const finishes=[],probe=createQualityProbe({request:(url)=>new Promise(resolve=>finishes.push(value=>resolve(response(url,value))))});
  try{
    const old=probe.probe(base);probe.cancel();const current=probe.probe(base);
    finishes[0]('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\na.m3u8');await assert.rejects(old,{name:'AbortError'});assert.equal(probe.getStatus().cached,0);assert.equal(probe.getStatus().pending,1);
    const same=probe.probe(base);assert.equal(finishes.length,2);finishes[1]('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nb.m3u8');assert.equal((await current).width,1920);assert.equal((await same).width,1920);assert.equal(probe.getStatus().cached,1);
    probe.dispose();assert.equal(probe.getStatus().cached,0);await assert.rejects(probe.probe(base),/已关闭/);
  }finally{probe.dispose();}
});

test('unknown codec results have a short retry lifetime while successful metadata stays cached',async()=>{
  let now=0,calls=0;const probe=createQualityProbe({now:()=>now,request:async url=>{calls++;return response(url,Buffer.alloc(100));}});
  try{await probe.probe(base);await probe.probe(base);assert.equal(calls,1);now=60001;await probe.probe(base);assert.equal(calls,2);}finally{probe.dispose();}
});

test('changing a returned result cannot poison the cached source dimensions',async()=>{
  let calls=0;const probe=createQualityProbe({request:async url=>{calls++;return response(url,'#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\n1080.m3u8');}});
  try{const first=await probe.probe(base);first.width=3840;first.variants[0].height=2160;const cached=await probe.probe(base);assert.equal(calls,1);assert.equal(cached.width,1920);assert.equal(cached.variants[0].height,1080);}finally{probe.dispose();}
});

test('disposing an in-flight probe aborts its request and cannot publish a late result',async()=>{
  let finish,signal;const probe=createQualityProbe({request:async(url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=value=>resolve(response(url,value));});}});
  const pending=probe.probe(base);assert.equal(signal.aborted,false);probe.dispose();assert.equal(signal.aborted,true);
  finish('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=3840x2160\n4k.m3u8');await assert.rejects(pending,{name:'AbortError'});assert.equal(probe.getStatus().cached,0);assert.equal(probe.getStatus().pending,0);
});
