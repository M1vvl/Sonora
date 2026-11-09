'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createAnimeService}=require('../src/anime/index.cjs');
const {createEchTransport}=require('../src/ech-transport/index.cjs');
const root=path.join(__dirname,'..'),out=path.join(root,'artifacts/kazumi-rea');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const transport=createEchTransport({dllPath:path.join(root,'native/ech/ech_http.dll')});
  const service=createAnimeService({dataDir:path.join(root,'artifacts/anime-network-profile'),fetchImpl:transport.fetch});
  const result={startedAt:new Date().toISOString(),checks:{}};
  try{
    result.bootstrap=await service.request('bootstrap');result.home=await service.request('home');
    result.detail=await service.request('detail',{id:result.home.featured[0].id});
    const image=await service.image(result.home.featured[0].cover);result.image={type:image.contentType,bytes:image.bytes.length};
    result.catalog=await service.request('catalog',{category:'日常'});
    result.search=await service.request('catalog',{query:'葬送的芙莉莲'});
    result.repository=await service.request('ruleRepository');
    result.subject=await service.request('detail',{id:400602});
    result.source=await service.request('searchSource',{ruleId:'giriGiriLove',keyword:'葬送的芙莉莲'});
    const match=result.source.items.find(item=>item.title==='葬送的芙莉莲');
    if(!match)throw new Error('No matching public source returned');
    result.episodes=await service.request('episodes',{ruleId:result.source.ruleId,url:match.url});
    result.play=await service.request('play',{id:400602,ruleId:result.source.ruleId,episode:result.episodes.lines[0].episodes[0]});
    result.checks={rules18:result.bootstrap.rules.length===18,homeFeatures5:result.home.featured.length===5,realCover:image.bytes.length>1000,
      category:result.catalog.items.length>0,search:result.search.items.some(item=>item.id===400602),repository18:result.repository.items.length===18,
      realEpisodes:result.episodes.lines[0].episodes.length>0,verifiedECH:transport.status().verifiedRequests>=2,
      noPrematureHistory:(await service.request('history')).history.length===0};
  }catch(error){result.error=error.stack;process.exitCode=1;}
  finally{result.transport=transport.status();await service.dispose();await transport.dispose();fs.writeFileSync(path.join(out,'live-network.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks,episode:result.play?.episode,error:result.error}));if(Object.values(result.checks).some(value=>value!==true))process.exitCode=1;}
})();
