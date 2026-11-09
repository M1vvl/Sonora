'use strict';
// Public catalog metadata only: no account, no song/audio request, no cache file.
const fs=require('node:fs'),path=require('node:path');
const {createNeteaseClient}=require('../src/music/netease.cjs'),{createCatalog}=require('../src/music/catalog.cjs');
const args=process.argv.slice(2),at=args.indexOf('--output'),output=path.resolve(at<0?'artifacts/v020-hot-playlists':args[at+1]);
(async()=>{fs.mkdirSync(output,{recursive:true});const client=createNeteaseClient(),pages=[],original=client.topPlaylists;client.topPlaylists=options=>{pages.push({offset:options.offset,limit:options.limit});return original(options);};
 const catalog=createCatalog({client,getAuth:()=>({state:'signedOut',cookie:{},profile:null})}),report={checkedAt:new Date().toISOString(),anonymous:true,accountRead:false,audioDownloaded:false,checks:{}};
 const check=(key,value)=>{report.checks[key]=!!value;if(!value)throw new Error('Recommendation check failed: '+key);};
 try{const first=await catalog.home({refreshPlaylists:true}),stable=await catalog.home(),second=await catalog.home({refreshPlaylists:true});
  const ids=value=>value.playlists.map(item=>item.id),known=new Set(ids(first));report.pages=pages;report.counts={first:first.playlists.length,second:second.playlists.length,changed:second.playlists.filter(item=>!known.has(item.id)).length};
  check('threeOrFewerBoundedHotPages',pages.length>0&&pages.length<=3&&pages.every(value=>value.offset<=100&&value.limit===50));
  check('eighteenRealUniquePlaylists',first.playlists.length===18&&new Set(ids(first)).size===18&&first.playlists.every(item=>item.playCount>0));
  check('modePlaylistsExcluded',first.playlists.every(item=>!/每日推荐|私人雷达|私人漫游|私人FM|心动模式|相似歌曲|我喜欢的音乐/.test(item.title)));
  check('stableWithinVisit',JSON.stringify(ids(stable))===JSON.stringify(ids(first)));
  check('newVisitSamplesDifferentTitles',report.counts.changed>0&&JSON.stringify(ids(second))!==JSON.stringify(ids(first)));
  check('dailySongsNotChangedByPlaylistSampling',JSON.stringify(first.songs)===JSON.stringify(second.songs));
  check('officialCoverURLsRetained',first.playlists.every(item=>/^https:\/\/p\d+(?:c)?\.music\.126\.net\//.test(item.coverURL||'')));
 }catch(error){report.error={code:error.code,message:error.message};process.exitCode=1;}finally{await catalog.dispose();fs.writeFileSync(path.join(output,'recommendations-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();
