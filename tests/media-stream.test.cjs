'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createStreamGateway,rewritePlaylist,safeRemoteURL}=require('../src/media-stream/gateway.cjs');
const {stripAdGroups}=require('../src/media-stream/libretv-m3u8.cjs');
test('playlist rewriting covers variants, keys, maps and relative segments without deleting regular boundaries',()=>{
  const source='#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-STREAM-INF:BANDWIDTH=12000\n720/index.m3u8\n#EXT-X-DISCONTINUITY\n#EXTINF:100,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:100,\nb.ts\n#EXT-X-ENDLIST';
  const mapped=[],out=rewritePlaylist(source,'https://cdn.example/path/main.m3u8',url=>{mapped.push(url);return '/token/'+mapped.length;},{adFilter:false});
  assert.deepEqual(mapped,['https://cdn.example/path/key.bin','https://cdn.example/path/init.mp4','https://cdn.example/path/720/index.m3u8','https://cdn.example/path/a.ts','https://cdn.example/path/b.ts']);assert(out.includes('URI="/token/1"'));assert.equal((out.match(/#EXT-X-DISCONTINUITY/g)||[]).length,2);
});
test('LibreTV conservative filtering preserves regular grouped video and required decryption declarations',()=>{
  let regular='#EXTM3U\n';for(let group=0;group<5;group++){regular+='#EXT-X-DISCONTINUITY\n';for(let i=0;i<5;i++)regular+=`#EXTINF:6,\nseg-${group}-${i}.ts\n`;}
  assert.equal((stripAdGroups(regular).match(/seg-/g)||[]).length,25);
  const ad='#EXTM3U\n#EXT-X-DISCONTINUITY\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:10,\nad.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:120,\nfeature.ts\n#EXT-X-ENDLIST';
  const clean=stripAdGroups(ad);assert(!clean.includes('\nad.ts'));assert(clean.includes('feature.ts'));assert(clean.includes('key.bin'));
});
test('stream gateway is lazy, token scoped, forwards ranges and releases listener at stop',async()=>{
  const calls=[],gateway=createStreamGateway({fetchImpl:async(url,init)=>{
    calls.push({url,range:init.headers.Range});
    if(url.endsWith('.m3u8'))return new Response('#EXTM3U\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
    return new Response(Uint8Array.of(1,2,3),{status:206,headers:{'content-type':'video/mp2t','content-length':'3','content-range':'bytes 0-2/3'}});
  }});
  try{
    assert.equal(gateway.getStatus().listening,false);
    const plan=await gateway.prepare({episode:{url:'https://cdn.example/main.m3u8'},rule:{}});
    const url=plan.media.url,manifest=await fetch(url),text=await manifest.text(),segment=text.split('\n').find(line=>line.startsWith('http'));
    assert(text.startsWith('#EXTM3U'));assert(segment.startsWith('http://127.0.0.1:'));
    const bytes=await fetch(segment,{headers:{Range:'bytes=0-2'}});assert.equal(bytes.status,206);assert.equal(calls[1].range,'bytes=0-2');assert.deepEqual([...new Uint8Array(await bytes.arrayBuffer())],[1,2,3]);
    assert.equal((await fetch(url.replace(/\/[a-f0-9]{48}\//,'/invalid/'))).status,404);
    await gateway.stop();assert.equal(gateway.getStatus().listening,false);assert.equal(gateway.getStatus().entries,0);await assert.rejects(fetch(url));
  }finally{await gateway.dispose();}
});
test('disabled filtering does not open a listener and invalid protocols/private literals are rejected',async()=>{
  const gateway=createStreamGateway();try{const plan={episode:{url:'https://cdn.example/a.m3u8'},rule:{}};assert.equal(await gateway.prepare(plan,{adFilter:false}),plan);assert(!gateway.getStatus().listening);for(const url of ['file:///a.ts','http://127.0.0.1/a','http://192.168.1.1/a','https://user:pass@example.com/a'])assert.throws(()=>safeRemoteURL(url));}finally{await gateway.dispose();}
});

test('implicit AES IV playlists preserve segment sequence when an ad heuristic would remove segments',()=>{
  const {filterM3u8}=require('../src/media-stream/ad-filter.cjs');
  const text='#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-DISCONTINUITY\n#EXTINF:10,\nad.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:120,\nfeature.ts\n#EXT-X-ENDLIST';
  assert.equal(filterM3u8(text),text);
  const explicit=text.replace('URI="key.bin"','URI="key.bin",IV=0x1');assert(!filterM3u8(explicit).includes('\nad.ts'));
});
