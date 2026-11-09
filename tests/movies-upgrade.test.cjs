'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createMoviesService}=require('../src/movies/index.cjs');
test('new provider defaults join old profiles once without replacing custom URLs, choices or deleted old sources',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pulse-source-upgrade-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dataDir,'movies-state.json'),JSON.stringify({version:1,sources:[{id:'ry',name:'自定义如意',url:'https://custom.example/api',enabled:false}],settings:{adFilter:false},history:[]}));
  const service=createMoviesService({dataDir,fetchImpl:async()=>{throw Error('No background calls');}});
  const initial=await service.request('bootstrap');assert.deepEqual(initial.rules.map(x=>x.id),['ry','jszy','mdzy']);assert.equal(initial.rules[0].url,'https://custom.example/api');assert.equal(initial.rules[0].enabled,false);assert.equal(initial.settings.adFilter,false);
  await service.request('sourceDelete',{id:'jszy'});await service.dispose();
  const again=createMoviesService({dataDir,fetchImpl:async()=>{throw Error('No background calls');}});try{const restored=await again.request('bootstrap');assert.deepEqual(restored.rules.map(x=>x.id),['ry','mdzy']);}finally{await again.dispose();}
});
