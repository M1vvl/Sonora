'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createQishuiStream}=require('../src/music/qishui-stream.cjs');
const box=(name,...parts)=>{const body=Buffer.concat(parts),header=Buffer.alloc(8);header.writeUInt32BE(body.length+8);header.write(name,4);return Buffer.concat([header,body]);};
const numbers=(...values)=>{const out=Buffer.alloc(values.length*4);values.forEach((value,i)=>out.writeUInt32BE(value,i*4));return out;};
const full=(name,...parts)=>box(name,Buffer.alloc(4),...parts);
function fixture({subsample=false,flac=false,drm=false,badMapping=false,co64=false}={}){
  const key=Buffer.from('00112233445566778899aabbccddeeff','hex'),samples=[Buffer.alloc(37,23),Buffer.alloc(31,71),Buffer.alloc(19,119)];
  const ivs=samples.map((_,i)=>{const value=Buffer.alloc(16);value.writeUInt32BE(i+15,4);return value;});
  const encrypted=samples.map((sample,i)=>{const cipher=crypto.createCipheriv('aes-128-ctr',key,ivs[i]);return Buffer.concat([cipher.update(sample),cipher.final()]);});
  const ftyp=box('ftyp',Buffer.from('M4A '),numbers(0),Buffer.from('isomM4A ')),gap=Buffer.alloc(11,4);
  const first=ftyp.length+8,offsets=[first,first+37+31+gap.length],mdat=box('mdat',encrypted[0],encrypted[1],gap,encrypted[2]);
  const tencData=Buffer.alloc(24);tencData[6]=1;tencData[7]=8;
  const sinf=box('sinf',box('frma',Buffer.from(flac?'fLaC':'mp4a')),full('schm',Buffer.from('cenc'),numbers(0)),box('schi',box('tenc',tencData)));
  const description=Buffer.alloc(28);description.writeUInt16BE(2,16);description.writeUInt16BE(16,18);
  const stsd=full('stsd',numbers(1),box('enca',description,full('esds',Buffer.from([3,0])),sinf));
  const stsz=full('stsz',numbers(0,samples.length,...samples.map(value=>value.length)));
  const stsc=full('stsc',numbers(2,1,2,1,2,badMapping?2:1,1));
  const chunkOffsets=co64?Buffer.concat(offsets.map(offset=>{const value=Buffer.alloc(8);value.writeBigUInt64BE(BigInt(offset));return value;})):numbers(...offsets);
  const chunkBox=full(co64?'co64':'stco',numbers(offsets.length),chunkOffsets);
  const senc=full('senc',numbers(samples.length),...ivs.map(value=>value.subarray(0,8)));if(subsample)senc[11]=2;
  const handler=Buffer.alloc(20);handler.write('soun',8);
  const moov=box('moov',box('trak',box('mdia',box('hdlr',handler),box('minf',box('stbl',stsd,stsz,stsc,chunkBox,senc)))),...(drm?[box('pssh',Buffer.alloc(20))]:[]));
  const bytes=Buffer.concat([ftyp,mdat,moov]),expected=Buffer.from(bytes),calls=[];
  samples[0].copy(expected,first);samples[1].copy(expected,first+37);samples[2].copy(expected,offsets[1]);
  for(const type of ['enca','sinf','senc']){const at=expected.indexOf(Buffer.from(type),ftyp.length+mdat.length);expected.write(type==='enca'?'mp4a':'free',at,4,'ascii');}
  let cancellations=0;
  const fetchImpl=async(url,options)=>{
    const match=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);assert(match);const start=Number(match[1]),end=Math.min(bytes.length-1,Number(match[2]));calls.push({start,end,signal:options.signal});
    let cursor=start,closed=false;
    const body=new ReadableStream({pull(output){if(options.signal.aborted){output.error(new Error('aborted'));return;}if(cursor>end){output.close();return;}const count=Math.min(7+(cursor%23),end-cursor+1);output.enqueue(bytes.subarray(cursor,cursor+count));cursor+=count;},cancel(){closed=true;cancellations++;}});
    void closed;
    return new Response(body,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,ETag:'fixture'}});
  };
  const stream=createQishuiStream({url:'https://audio.test.invalid/a.m4a',authorization:key.toString('hex'),fetchImpl});
  return {stream,bytes,expected,calls,key,first,offsets,cancellations:()=>cancellations};
}
test('authorized M4A streams exact stsc chunks with gaps and byte-boundary CTR seeks',async()=>{
  for(const co64 of [false,true]){
    const f=fixture({co64});try{
      await f.stream.ready();assert(f.stream.getStatus().metadataBytes<2*1024*1024);assert.equal(f.stream.getStatus().samples,3);
      const start=f.first+17,end=f.offsets[1]+11;
      const response=await f.stream.handle(new Request('https://local.test/audio',{headers:{Range:`bytes=${start}-${end}`}}));
      assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${f.bytes.length}`);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.expected.subarray(start,end+1));
      const complete=await f.stream.handle(new Request('https://local.test/audio'));
      assert.deepEqual(Buffer.from(await complete.arrayBuffer()),f.expected);
      assert(f.calls.every(call=>call.end-call.start+1<=2*1024*1024||call.start===0&&call.end===f.bytes.length-1));
      const suffix=await f.stream.handle(new Request('https://local.test/audio',{headers:{Range:'bytes=-29'}}));
      assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),f.expected.subarray(-29));
    }finally{f.stream.dispose();}
  }
});
test('unsupported subsamples, FLAC, DRM and inconsistent sample tables fail before audio transfer',async()=>{
  for(const setting of [{subsample:true},{flac:true},{drm:true},{badMapping:true}]){const f=fixture(setting);try{await assert.rejects(f.stream.ready(),/汽水/);const response=await f.stream.handle(new Request('https://local.test/audio'));assert.equal(response.status,415);assert(!f.calls.some(call=>call.start===0&&call.end===f.bytes.length-1));}finally{f.stream.dispose();}}
});
test('HEAD and invalid ranges expose no samples; disposal aborts active audio and prevents reuse',async()=>{
  const f=fixture();await f.stream.ready();const before=f.calls.length;
  const head=await f.stream.handle(new Request('https://local.test/audio',{method:'HEAD'}));assert.equal(head.headers.get('content-length'),String(f.bytes.length));assert.equal(f.calls.length,before);
  assert.equal((await f.stream.handle(new Request('https://local.test/audio',{headers:{Range:'bytes=999999-'}}))).status,416);
  const response=await f.stream.handle(new Request('https://local.test/audio'));const reader=response.body.getReader();await reader.read();f.stream.dispose();assert(f.calls.at(-1).signal.aborted);await reader.cancel().catch(()=>{});assert.equal(f.stream.getStatus().disposed,true);assert.equal((await f.stream.handle(new Request('https://local.test/audio'))).status,410);
});
test('an upstream server that ignores Range cannot trigger a full-song initialization buffer',async()=>{
  let cancelled=false;const stream=createQishuiStream({url:'https://audio.test.invalid/a',authorization:Buffer.alloc(16),fetchImpl:async()=>new Response(new ReadableStream({pull(){},cancel(){cancelled=true;}}),{status:200})});
  try{await assert.rejects(stream.ready(),/Range/);assert(cancelled);}finally{stream.dispose();}
});
test('disposal cancels pending metadata readiness instead of retaining a live credential or request',async()=>{
  let signal;const stream=createQishuiStream({url:'https://audio.test.invalid/a',authorization:Buffer.alloc(16),fetchImpl:(_url,options)=>new Promise((_resolve,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(new Error('metadata aborted')),{once:true});})});
  const ready=stream.ready();await new Promise(setImmediate);stream.dispose();await assert.rejects(ready,/aborted/);assert(signal.aborted);assert.equal(stream.getStatus().active,0);assert.equal(stream.getStatus().metadataBytes,0);
});
