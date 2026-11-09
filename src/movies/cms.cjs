'use strict';
// Apple CMS parsing adapted from LibreSpark/LibreTV v2.21.1
// src/lib/cms-parser.ts (AGPL-3.0-or-later); retained source/road semantics.
const {createHash}=require('node:crypto');
const {safeHttpUrl}=require('../anime/config.cjs');
const text=(value,limit=4096)=>String(value??'').trim().slice(0,limit);
const plain=value=>text(value,20000).replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
const adult=/(?:伦理片|倫理|福利片|日本福利|擦边|里番|无码|有码|色情|成人视频|传媒|制服诱惑|SWAG|国产自拍|成人视频)/i;
function httpURL(value){const input=text(value,4096);if(!input)throw new Error('缺少地址');return safeHttpUrl(input);}
function playableURL(value){try{const url=httpURL(value),path=new URL(url).pathname;return /\.(?:m3u8|mp4|m4v|webm|mkv|mov)$/i.test(path)?url:null;}catch{return null;}}
function identity(title,year=''){return 'film:'+createHash('sha256').update(text(title,300).normalize('NFKC').toLocaleLowerCase().replace(/[\s·・]/g,'')+'\n'+text(year,8)).digest('hex').slice(0,24);}
function parseLines(value,names=''){
  const roads=text(value,2*1024*1024).split('$$$'),labels=text(names).split('$$$');
  let budget=5000;
  return roads.slice(0,30).map((road,index)=>({name:labels[index]||`线路 ${index+1}`,episodes:road.split('#').slice(0,budget).map((entry,n)=>{
    const separator=entry.indexOf('$'),url=playableURL(separator>=0?entry.slice(separator+1):entry);return url?{title:text(separator>=0?entry.slice(0,separator):`第${n+1}集`,100),url}:null;
  }).filter(Boolean).filter(()=>budget-->0)})).filter(line=>line.episodes.length).sort((a,b)=>Number(b.episodes.some(ep=>/\.m3u8(?:\?|$)/i.test(ep.url)))-Number(a.episodes.some(ep=>/\.m3u8(?:\?|$)/i.test(ep.url))));
}
function parseVod(raw,source){
  if(!raw||typeof raw!=='object'||adult.test(text(raw.type_name)))return null;
  const vodId=text(raw.vod_id,120),title=plain(raw.vod_name).slice(0,300);if(!vodId||!title)return null;
  const year=text(raw.vod_year,8);let cover='';try{cover=httpURL(raw.vod_pic);}catch{}
  const lines=parseLines(raw.vod_play_url,raw.vod_play_from);
  return {id:identity(title,year),title,cover,summary:plain(raw.vod_content||raw.vod_blurb),year,score:Number(raw.vod_douban_score)||0,tags:[text(raw.type_name,60),year,text(raw.vod_area,60)].filter(Boolean),
    vodId,sourceId:source.id,sourceName:source.name,sourceUrl:source.url,remarks:text(raw.vod_remarks,100),lines};
}
function parsePage(data,source){
  if(!data||typeof data!=='object'||(data.list!=null&&!Array.isArray(data.list)))throw new Error('片源返回了无效的数据');
  return {items:(data.list||[]).slice(0,1000).map(raw=>parseVod(raw,source)).filter(Boolean),page:Math.max(1,parseInt(data.page)||1),pagecount:Math.min(100000,Math.max(1,parseInt(data.pagecount)||1)),total:Math.max(0,parseInt(data.total)||0),rawCount:(data.list||[]).length};
}
function groupItems(values){
  const groups=new Map();for(const item of values){let group=groups.get(item.id);if(!group){group={...item,alternatives:[]};groups.set(item.id,group);}if(!group.cover&&item.cover)group.cover=item.cover;if(!group.summary&&item.summary)group.summary=item.summary;group.score=Math.max(group.score||0,item.score||0);if(!group.alternatives.some(entry=>entry.sourceId===item.sourceId&&entry.vodId===item.vodId))group.alternatives.push({sourceId:item.sourceId,vodId:item.vodId});}
  return [...groups.values()];
}
function apiURL(source,params){const url=new URL(httpURL(source.url));for(const [name,value]of Object.entries(params))if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(name,String(value));return url.href;}
module.exports={httpURL,playableURL,identity,parseLines,parseVod,parsePage,groupItems,apiURL,text};
