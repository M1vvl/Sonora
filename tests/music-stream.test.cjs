'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMusicStream}=require('../src/music-stream.cjs');
test('music stream accepts only official HTTPS CDN addresses and keeps one opaque current track',async()=>{
  const service=createMusicStream({fetchImpl:async()=>new Response('bytes')});
  for(const url of ['http://m7.music.126.net/a','https://evil.test/a','https://music.126.net.evil.test/a','https://user:pass@m7.music.126.net/a','https://m7.music.126.net:8443/a'])assert.throws(()=>service.prepare(url),/官方/);
  const first=service.prepare('https://m7.music.126.net/a'),second=service.prepare('https://m7.music.126.net/b');
  assert(!first.includes('music.126.net'));assert.equal((await service.handle(new Request(first))).status,404);
  assert.equal(await (await service.handle(new Request(second))).text(),'bytes');service.dispose();assert.throws(()=>service.prepare('https://m7.music.126.net/a'),/关闭/);
});
test('music stream forwards one valid Range and bounded redirects without account cookies',async()=>{
  const calls=[];const service=createMusicStream({fetchImpl:async(url,init)=>{calls.push({url,init});return calls.length===1?new Response(null,{status:302,headers:{location:'https://m8.music.126.net/file'}}):new Response('abc',{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 5-7/20','content-length':'3'}});}});
  const url=service.prepare('https://m7.music.126.net/entry'),response=await service.handle(new Request(url,{headers:{Range:'bytes=5-7'}}));
  assert.equal(response.status,206);assert.equal(response.headers.get('Cache-Control'),'no-store, max-age=0');assert.equal(response.headers.get('Pragma'),'no-cache');assert.equal(response.headers.get('content-range'),'bytes 5-7/20');assert.equal(await response.text(),'abc');
  assert(calls.every(call=>call.init.cache==='no-store'&&call.init.headers['Cache-Control']==='no-store'&&call.init.headers.Pragma==='no-cache'&&call.init.credentials==='omit'&&call.init.headers.Range==='bytes=5-7'));assert.equal(service.getStatus().active,0);
  assert.equal((await service.handle(new Request(url,{headers:{Range:'bytes=1-2,5-6'}}))).status,416);service.dispose();
});
test('music stream refuses redirection to an unrelated origin',async()=>{
  let calls=0;const service=createMusicStream({fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.test/music'}});}});
  const url=service.prepare('https://m7.music.126.net/entry');assert.equal((await service.handle(new Request(url))).status,502);assert.equal(calls,1);assert.equal(service.getStatus().active,0);service.dispose();
});
test('Kugou Android CDN links upgrade to HTTPS before streaming and preserve the authorized query',async()=>{
  const requests=[];
  const service=createMusicStream({fetchImpl:async(url,options)=>{requests.push({url,options});return new Response(new Uint8Array([255,251,144,0]),{status:206,headers:{'Content-Type':'application/octet-stream','Content-Range':'bytes 0-3/1000'}});}});
  try{
    const url=service.prepare('http://fsandroid.tx.kugou.com/authorized.mp3?key=synthetic&offset=0');
    const response=await service.handle(new Request(url,{headers:{Range:'bytes=0-3'}}));
    assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,4);
    assert.equal(requests[0].url,'https://fsandroid.tx.kugou.com/authorized.mp3?key=synthetic&offset=0');
    assert.equal(requests[0].options.credentials,'omit');
    assert.throws(()=>service.prepare('http://fsandroid.tx.kugou.com.attacker.test/authorized.mp3'),/官方/);
  }finally{service.dispose();}
});
test('music streaming stops live requests on track replacement and does not buffer whole songs',async()=>{
  let signal,reads=0;const service=createMusicStream({fetchImpl:async(_url,init)=>{signal=init.signal;return new Response(new ReadableStream({pull(output){reads++;if(reads===1)output.enqueue(new Uint8Array([1,2,3]));}}),{headers:{'content-type':'audio/mpeg'}});}});
  const url=service.prepare('https://m7.music.126.net/entry'),response=await service.handle(new Request(url)),reader=response.body.getReader();
  assert.deepEqual([...(await reader.read()).value],[1,2,3]);assert(reads<=3);assert.equal(service.getStatus().active,1);
  service.prepare('https://m7.music.126.net/next');assert(signal.aborted);await reader.cancel();assert.equal(service.getStatus().active,0);service.dispose();
});
