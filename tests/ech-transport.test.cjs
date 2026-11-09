'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {normalizeRequest,parseHeaders,readRoute,redirectRequest}=require('../src/ech-transport/protocol.cjs');
const {decodeEvent}=require('../src/ech-transport/native.cjs');
const {createEchTransport}=require('../src/ech-transport/index.cjs');
test('ECH requests preserve bounded headers/body and refuse unsupported authorities',()=>{
  const request=normalizeRequest('https://api.bgm.tv/v0/search/subjects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(request.body.toString(),'{}');assert.match(request.headers,/content-type: application\/json/);
  assert.throws(()=>normalizeRequest('https://unrelated.test/'));assert.throws(()=>normalizeRequest('http://lain.bgm.tv/a'));assert.throws(()=>normalizeRequest('https://api.bgm.tv/',{body:'x'}));
  const response=parseHeaders(Buffer.from('HTTP/2 200\r\ncontent-type: image/jpeg\r\nx-test: a:b\r\n\r\n'));
  assert.equal(response.status,200);assert.deepEqual(response.headers[1],['x-test','a:b']);
});
test('ECH route requires published HTTPS ech config; redirects strip credentials on origin changes',()=>{
  assert.throws(()=>readRoute({Status:0,Answer:[]}));
  const route=readRoute({Status:0,Answer:[{type:65,TTL:900,data:'1 . alpn="h2" ech="ABCD=="'}]});assert.equal(route.config,'ABCD==');assert.equal(route.ttl,300);assert.equal(route.addresses.length,3);
  const old=normalizeRequest('https://api.bgm.tv/a',{method:'POST',body:'hello',headers:{Authorization:'Bearer test','Content-Type':'text/plain'}});
  const next=redirectRequest(old,{status:303},'https://lain.bgm.tv/b');assert.equal(next.method,'GET');assert.equal(next.body.length,0);assert.doesNotMatch(next.headers,/authorization|content-type/);
});
test('Dart native callback decodes validated temporary bytes by copying, with strict 256 KiB bound',()=>{
  const pointer=()=>new Map(),message=pointer(),list=pointer(),payload=Buffer.from('abc');
  const fields=Array.from({length:5},pointer);message.set('0:int32_t',6);message.set('8:intptr_t',5);message.set('16:void *',list);
  fields.forEach((f,i)=>list.set(`${i*8}:void *`,f));[2,200,1,0].forEach((v,i)=>{fields[i].set('0:int32_t',2);fields[i].set('8:int32_t',v);});
  fields[4].set('0:int32_t',7);fields[4].set('8:int32_t',2);fields[4].set('16:intptr_t',3);fields[4].set('24:void *',payload);
  const koffi={decode:(ptr,offset,type)=>ptr.get(`${offset}:${type}`)},copy=(dst,src)=>src.copy(dst);
  const decoded=decodeEvent(koffi,message,copy);payload.fill(0);assert.equal(decoded.payload.toString(),'abc');assert.equal(decoded.echAccepted,true);
  fields[4].set('16:intptr_t',262145);assert.throws(()=>decodeEvent(koffi,message,copy),/bound/);
});
test('transport loads only for ECH, bounds concurrency, aborts queued jobs and releases its worker',async()=>{
  let instance,created=0,plain=0,inflight=0,max=0;
  class Worker extends EventEmitter{constructor(){super();created++;instance=this;setImmediate(()=>this.emit('message',{type:'ready',version:'fixture'}));}postMessage(m){if(m.type==='fetch'){inflight++;max=Math.max(max,inflight);setTimeout(()=>{inflight--;this.emit('message',{type:'result',id:m.id,result:{status:200,statusText:'OK',headers:[],body:new Uint8Array([111,107]),url:m.request.url,echAccepted:true,echRetries:0}});},20);}else if(m.type==='dispose')setImmediate(()=>this.emit('exit',0));}}
  const transport=createEchTransport({dllPath:require('node:path').resolve('native/ech/ech_http.dll'),workerFactory:()=>new Worker(),maxConcurrent:2,fetchImpl:async()=>{plain++;return new Response('plain');}});
  await transport.fetch('https://example.com');assert.equal(created,0);assert.equal(plain,1);
  const controller=new AbortController();const pending=Array.from({length:4},()=>transport.fetch('https://lain.bgm.tv/a',{ech:true}));const aborted=transport.fetch('https://lain.bgm.tv/b',{ech:true,signal:controller.signal});controller.abort();await assert.rejects(aborted,{name:'AbortError'});
  const responses=await Promise.all(pending);assert(responses.every(r=>r.echAccepted));assert.equal(await responses[0].text(),'ok');assert.equal(max,2);assert.equal(created,1);await transport.dispose();assert.equal(instance.listenerCount('message'),1);assert.equal(transport.status().running,false);
});
