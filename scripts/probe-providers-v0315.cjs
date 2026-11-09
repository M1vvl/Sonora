'use strict';
// Bounded public-source research only. Does not edit product source lists.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/libretv-rea/v0.3.15');fs.mkdirSync(out,{recursive:true});
const local='C:/新建文件夹/DownLoad/LibreTV-main/LibreTV-main';
const codecSource=fs.readFileSync(path.join(local,'src/lib/codec-parse.ts'),'utf8');
const erasable=codecSource.replace('constructor(private readonly data: Uint8Array) {}','constructor(data: Uint8Array) { this.data = data; }');
const transpiled=require('node:module').stripTypeScriptTypes(erasable,{mode:'strip'}).replace("import { createDecipheriv } from 'node:crypto';","const {createDecipheriv}=require('node:crypto');").replace(/^export /mg,'');
const codecFile=path.join(out,'codec-from-libretv.cjs');fs.writeFileSync(codecFile,"'use strict';\n// LibreTV 2.21.1 AGPL-3.0-or-later; research-only TypeScript transpilation.\n"+transpiled+'\nmodule.exports={parseTsVideoResolution,parseMp4VideoResolution,looksLikeMp4,decryptAes128CbcPrefix};\n');
const codec=require(codecFile),{stripAdGroups}=require('../src/media-stream/libretv-m3u8.cjs');
const providers=[
['ry','如意','https://cj.rycjapi.com/api.php/provide/vod'],['bf','暴风','https://bfzyapi.com/api.php/provide/vod'],['zy360','360','https://360zy.com/api.php/provide/vod'],['zuid','最大','https://api.zuidapi.com/api.php/provide/vod'],
['dyttzy','电影天堂','http://caiji.dyttzyapi.com/api.php/provide/vod'],['tyyszy','天涯','https://tyyszy.com/api.php/provide/vod'],['ffzy','非凡','http://ffzy5.tv/api.php/provide/vod'],['heimuer','黑木耳','https://json.heimuer.xyz/api.php/provide/vod'],['iqiyi','iqiyi资源','https://www.iqiyizyapi.com/api.php/provide/vod'],['wolong','卧龙','https://wolongzyw.com/api.php/provide/vod'],['hwba','华为吧','https://cjhwba.com/api.php/provide/vod'],['jisu','极速','https://jszyapi.com/api.php/provide/vod'],['dbzy','豆瓣','https://dbzy.com/api.php/provide/vod'],['mozhua','魔爪','https://mozhuazy.com/api.php/provide/vod'],['mdzy','魔都','https://www.mdzyapi.com/api.php/provide/vod'],['yinghua','樱花','https://m3u8.apiyhzy.com/api.php/provide/vod'],['baidu','百度云','https://api.apibdzy.com/api.php/provide/vod'],['wujin','无尽','https://api.wujinapi.me/api.php/provide/vod'],['wwzy','旺旺短剧','https://wwzy.tv/api.php/provide/vod'],['ikun','iKun','https://ikunzyapi.com/api.php/provide/vod']];
const ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36';
function urlFor(base,params){const url=new URL(base);for(const[k,v]of Object.entries(params))url.searchParams.set(k,v);return url.href;}
async function request(url,{limit=2*1024*1024,range=false,referer,timeout=10000}={}){
 const begin=performance.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);let response,bytes,firstByteMs;
 try{response=await fetch(url,{signal:controller.signal,headers:{'User-Agent':ua,...(range?{Range:'bytes=0-'+(limit-1)}:{}),...(referer?{Referer:referer}:{} )}});if(!response.ok)throw new Error('HTTP '+response.status);const reader=response.body.getReader(),parts=[];let total=0;
 try{for(;;){const next=await reader.read();if(next.done)break;if(firstByteMs==null)firstByteMs=performance.now()-begin;const remain=limit-total,part=next.value.subarray(0,remain);parts.push(Buffer.from(part));total+=part.length;if(total>=limit){await reader.cancel();break;}}}finally{reader.releaseLock();}bytes=Buffer.concat(parts,total);
 return {url:response.url||url,status:response.status,bytes,contentType:response.headers.get('content-type'),firstByteMs:Math.round(firstByteMs||0),elapsedMs:Math.round(performance.now()-begin)};
 }finally{clearTimeout(timer);}
}
function episodes(raw){return String(raw.vod_play_url||'').split('$$$').flatMap(road=>road.split('#')).map(entry=>{const at=entry.indexOf('$');return {name:at>=0?entry.slice(0,at):'',url:at>=0?entry.slice(at+1):entry};}).filter(ep=>/^https?:\/\//.test(ep.url)&&/\.(m3u8|mp4)(\?|$)/i.test(ep.url));}
async function videoProbe(url,source){
 const result={url},referer=new URL(source).origin+'/';let manifest=await request(url,{limit:256*1024,referer,timeout:12000});
 result.manifestMs=manifest.elapsedMs;result.manifestBytes=manifest.bytes.length;
 if(/\.mp4(?:\?|$)/i.test(url)){result.segmentStatus=manifest.status;result.segmentBytes=manifest.bytes.length;result.resolution=codec.parseMp4VideoResolution(manifest.bytes)||null;return result;}
 let text=manifest.bytes.toString('utf8');if(!text.trimStart().startsWith('#EXTM3U'))throw new Error('Not HLS');const variants=[];let pending;
 for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(line.startsWith('#EXT-X-STREAM-INF:')){const dims=/RESOLUTION=(\d+)x(\d+)/.exec(line);pending={bandwidth:Number(/(?:^|,)BANDWIDTH=(\d+)/.exec(line.slice(18))?.[1]||0),resolution:dims?{width:Number(dims[1]),height:Number(dims[2])}:null};}else if(line&&!line.startsWith('#')&&pending){variants.push({...pending,url:new URL(line,manifest.url).href});pending=null;}}
 if(variants.length){variants.sort((a,b)=>((b.resolution?.width||0)*(b.resolution?.height||0)-(a.resolution?.width||0)*(a.resolution?.height||0))||b.bandwidth-a.bandwidth);result.variants=variants;result.resolution=variants[0].resolution;manifest=await request(variants[0].url,{limit:256*1024,referer,timeout:12000});text=manifest.bytes.toString('utf8');}
 text=stripAdGroups(text);const lines=text.split(/\r?\n/).map(v=>v.trim()),first=lines.find(v=>v&&!v.startsWith('#'));if(!first)throw new Error('No segment');
 const segmentURL=new URL(first,manifest.url).href,segment=await request(segmentURL,{limit:96*1024,range:true,referer,timeout:12000});
 result.segmentStatus=segment.status;result.segmentBytes=segment.bytes.length;result.segmentMs=segment.elapsedMs;result.firstByteMs=segment.firstByteMs;result.prefixKiBPerSecond=Math.round(segment.bytes.length/1024/Math.max(.001,segment.elapsedMs/1000));result.encrypted=/#EXT-X-KEY:METHOD=(?!NONE)/.test(text);
 let prefix=segment.bytes;const keyLine=lines.find(v=>v.startsWith('#EXT-X-KEY:'));
 if(keyLine&&/METHOD=AES-128/.test(keyLine)){const uri=/URI="([^"]+)"/.exec(keyLine)?.[1];if(uri){const key=(await request(new URL(uri,manifest.url).href,{limit:17,referer})).bytes;if(key.length===16){const ivText=/IV=0x([a-f0-9]+)/i.exec(keyLine)?.[1];let iv=Buffer.alloc(16);if(ivText)iv=Buffer.from(ivText.padStart(32,'0'),'hex');else{const sequence=BigInt(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)?.[1]||0);iv.writeBigUInt64BE(sequence,8);}prefix=Buffer.from(codec.decryptAes128CbcPrefix(prefix.subarray(0,Math.floor(prefix.length/16)*16),key,iv));}}}
 const map=/^#EXT-X-MAP:.*URI="([^"]+)"/m.exec(text)?.[1];let decoded;
 if(map){const init=await request(new URL(map,manifest.url).href,{limit:64*1024,range:true,referer});decoded=codec.parseMp4VideoResolution(init.bytes);}
 decoded||=codec.looksLikeMp4(prefix)?codec.parseMp4VideoResolution(prefix):codec.parseTsVideoResolution(prefix);
 if(decoded){result.resolution=decoded;result.resolutionMethod='codec-prefix';}else result.resolutionMethod=result.resolution?'master-resolution':'unknown';result.resolution||=null;
 return result;
}
async function probe(provider){const[id,name,api]=provider,result={id,name,api,checkedAt:new Date().toISOString()};try{
 const response=await request(urlFor(api,{ac:'videolist',wd:'流浪地球'})),data=JSON.parse(response.bytes.toString('utf8'));result.apiMs=response.elapsedMs;result.matches=Array.isArray(data.list)?data.list.length:0;const raw=data.list?.find(item=>item.vod_name==='流浪地球')||data.list?.find(item=>String(item.vod_name).includes('流浪地球'));
 if(!raw){result.error='No matching movie';return result;}const detail=JSON.parse((await request(urlFor(api,{ac:'detail',ids:String(raw.vod_id)}))).bytes.toString('utf8')).list?.[0]||raw;
 result.title=detail.vod_name;result.vodId=String(detail.vod_id);result.episodeCount=episodes(detail).length;const episode=episodes(detail)[0];if(!episode)throw new Error('No playable episode');result.media=await videoProbe(episode.url,api);result.ok=true;
 try{const tv=JSON.parse((await request(urlFor(api,{ac:'videolist',wd:'狂飙'}))).bytes.toString('utf8'));const series=tv.list?.find(item=>item.vod_name==='狂飙');result.tv={keyword:'狂飙',matches:tv.list?.length||0,exactMatch:!!series,episodeCount:series?episodes(series).length:0};}catch(error){result.tv={error:error.message};}
 }catch(error){result.error=error.name==='AbortError'?'Timeout':error.message;result.ok=false;}return result;}
async function main(){const report={startedAt:new Date().toISOString(),source:'https://raw.githubusercontent.com/LibreSpark/LibreTV/26ec4e8/js/config.js',codecSourceSha256:crypto.createHash('sha256').update(codecSource).digest('hex'),limits:{parallel:3,requestMs:12000,manifestBytes:256*1024,segmentBytes:96*1024},results:[]};let index=0;await Promise.all(Array.from({length:3},async()=>{while(index<providers.length){const value=providers[index++],result=await probe(value);report.results.push(result);fs.writeFileSync(path.join(out,'provider-probes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({id:result.id,ok:result.ok,resolution:result.media?.resolution,error:result.error}));}}));report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'provider-probes.json'),JSON.stringify(report,null,2));}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={request,videoProbe,episodes,urlFor};
