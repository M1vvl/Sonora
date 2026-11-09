'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMoviesService}=require('../src/movies/index.cjs');
test('movie covers share one pending request, retry transient response once and accept CDN jpg alias',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-movie-images-'));let calls=0;
  const service=createMoviesService({dataDir:dir,fetchImpl:async()=>{calls++;return calls===1?new Response('temporary',{status:503}):new Response('cover',{headers:{'content-type':'image/jpg; charset=binary'}});}});
  t.after(async()=>{await service.dispose();fs.rmSync(dir,{recursive:true,force:true});});
  const [a,b]=await Promise.all([service.image('https://example.org/cover.jpg'),service.image('https://example.org/cover.jpg')]);assert.equal(a,b);assert.equal(a.contentType,'image/jpeg');assert.equal(calls,2);assert.equal(await service.image('https://example.org/cover.jpg'),a);assert.equal(calls,2);
});
