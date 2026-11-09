'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),https=require('node:https');
const {createProviderHTTP}=require('../src/music/providers/http.cjs');
test('platform metadata transport bounds hosts, concurrency, pending work and disposal',async t=>{
 const requests=[];
 t.mock.method(https,'request',(url,options,callback)=>{const request=new EventEmitter();request.url=url;request.options=options;request.write=()=>{};request.end=()=>{};request.destroy=error=>queueMicrotask(()=>request.emit('error',error));request.respond=body=>{const response=new EventEmitter();response.statusCode=200;callback(response);response.emit('data',Buffer.from(body));response.emit('end');};requests.push(request);return request;});
 const client=createProviderHTTP({domains:['qq.com'],maxActive:2,maxQueue:2});
 try{
  await assert.rejects(client.requestText('https://qq.com.attacker.invalid/'),/无效/);assert.equal(requests.length,0);
  const a=client.requestText('https://u.y.qq.com/one'),b=client.requestText('https://u.y.qq.com/two'),c=client.requestText('https://u.y.qq.com/three');assert.equal(requests.length,2);assert.equal(client.getStatus().queued,1);
  requests[0].respond('{"code":0}');assert.equal(await a,'{"code":0}');assert.equal(requests.length,3);assert.equal(requests[2].options.headers['Cache-Control'],'no-store');
  const caught=Promise.allSettled([b,c]);client.dispose();const result=await caught;assert(result.every(value=>value.status==='rejected'));assert.deepEqual(client.getStatus(),{active:0,queued:0,disposed:true});
 }finally{client.dispose();}
});
test('binary QQ collection responses preserve bytes instead of passing through UTF-8 decoding',async t=>{
 const bytes=Buffer.from([0,255,140,65]);
 t.mock.method(https,'request',(_url,_options,callback)=>{
  const request=new EventEmitter();request.write=()=>{};request.destroy=error=>request.emit('error',error);
  request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=200;callback(response);response.emit('data',bytes);response.emit('end');});return request;
 });
 const client=createProviderHTTP({domains:['qq.com']});
 try{assert.deepEqual(await client.requestText('https://u6.y.qq.com/cgi-bin/musics.fcg',{responseType:'buffer'}),bytes);}finally{client.dispose();}
});
