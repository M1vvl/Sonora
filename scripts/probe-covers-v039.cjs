'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createEchTransport}=require('../src/ech-transport/index.cjs');
const {createAnimeService}=require('../src/anime/index.cjs');
const {imageRequest}=require('../src/anime/config.cjs');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-cover-probe-'));
  const events=[],transport=createEchTransport({dllPath:path.join(ROOT,'native/ech/ech_http.dll')});
  const service=createAnimeService({dataDir,installedRulesPath:path.join(dataDir,'absent'),fetchImpl:async(url,options)=>{
    const started=Date.now();try{const response=await transport.fetch(url,options);events.push({url,ech:!!options.ech,status:response.status,finalUrl:response.url,contentType:response.headers.get('content-type'),ms:Date.now()-started});return response;}catch(error){events.push({url,ech:!!options.ech,error:error.message,name:error.name,ms:Date.now()-started});throw error;}
  }});
  try{
    const home=await service.request('home'),subjects=[...new Map([...home.featured,...home.hot.slice(0,5)].map(item=>[item.id,item])).values()].slice(0,10);
    const covers=await Promise.all(subjects.map(async item=>{try{const result=await service.image(item.cover);return {id:item.id,title:item.title,url:item.cover,request:imageRequest(item.cover,'ech'),bytes:result.bytes.length,contentType:result.contentType,ok:true};}catch(error){return {id:item.id,title:item.title,url:item.cover,request:imageRequest(item.cover,'ech'),ok:false,error:error.message};}}));
    const report={time:new Date().toISOString(),covers,events,transport:transport.status(),images:service.getStatus().images};
    const out=path.join(ROOT,'artifacts/kazumi-rea/v0.3.9/covers-probe.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await service.dispose();await transport.dispose();fs.rmSync(dataDir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
