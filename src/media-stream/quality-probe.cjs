'use strict';
// Bounded desktop adaptation of LibreTV's two-stage quality probe. A bitrate
// or a provider's "4K" name is never sufficient evidence of pixel dimensions.
const {safeHttpUrl}=require('../anime/config.cjs');
const {parseTsVideoResolution,parseMp4VideoResolution,looksLikeMp4,decryptAes128CbcPrefix}=require('./libretv-codec.cjs');
const {filterM3u8}=require('./ad-filter.cjs');
function dimensions(width,height){width=Number(width);height=Number(height);return Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>=16&&height>=16&&width<=16384&&height<=16384?{width,height}:null;}
function qualityLabel(value){
  if(!value?.width||!value?.height)return '画质待实测';
  const short=Math.min(value.width,value.height),long=Math.max(value.width,value.height);
  if(long/short>2.1)return `${value.width}×${value.height} · 宽幅片源`;
  const tier=short>=2160&&long>=3840?'4K':short>=1440&&long>=2560?'2K / 1440p':short>=1080&&long>=1920?'1080p':short>=720&&long>=1280?'720p':`${short}p`;
  return `${tier} · ${value.width}×${value.height}`;
}
function parseVariants(text,base){
  const result=[];let pending=null;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();if(line.startsWith('#EXT-X-STREAM-INF:')){
      const match=/RESOLUTION=(\d+)x(\d+)/i.exec(line);pending={...(match?dimensions(Number(match[1]),Number(match[2]))||{}:{}),bandwidth:Number(/(?:^|,)BANDWIDTH=(\d+)/i.exec(line.slice(line.indexOf(':')+1))?.[1])||0};
    }else if(line&&!line.startsWith('#')&&pending){try{result.push({...pending,url:safeHttpUrl(new URL(line,base).href)});}catch{}pending=null;if(result.length>=16)break;}
  }
  return result.sort((a,b)=>(b.width||0)*(b.height||0)-(a.width||0)*(a.height||0)||b.bandwidth-a.bandwidth);
}
function mediaInfo(text,base){
  const info={sequence:'0'};
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();if(line.startsWith('#EXT-X-MAP:')){const uri=/URI="([^"]+)"/.exec(line)?.[1];if(uri)info.init=safeHttpUrl(new URL(uri,base).href);}
    else if(line.startsWith('#EXT-X-KEY:')){info.method=/METHOD=([^,]+)/.exec(line)?.[1];const uri=/URI="([^"]+)"/.exec(line)?.[1];info.key=uri?safeHttpUrl(new URL(uri,base).href):null;info.iv=/IV=0x([\da-f]+)/i.exec(line)?.[1];}
    else if(line.startsWith('#EXT-X-MEDIA-SEQUENCE:')){const raw=line.split(':')[1].trim();if(/^\d{1,20}$/.test(raw)&&BigInt(raw)<=0xffffffffffffffffn)info.sequence=raw;}
    else if(line&&!line.startsWith('#')){info.segment=safeHttpUrl(new URL(line,base).href);break;}
  }
  return info;
}
function createQualityProbe({request,now=Date.now}={}){
  if(typeof request!=='function')throw new TypeError('Quality probe needs a bounded request function');
  const cache=new Map(),pending=new Map(),controllers=new Set();let disposed=false,generation=0;
  function remember(key,value){cache.delete(key);cache.set(key,{at:now(),value:structuredClone(value)});while(cache.size>160)cache.delete(cache.keys().next().value);return structuredClone(value);}
  async function probe(url,{headers={},adFilter=true}={}){
    if(disposed)throw new Error('画质检测已关闭');url=safeHttpUrl(url);
    const key=JSON.stringify([url,headers.Referer||headers.referer||'',adFilter]),hit=cache.get(key);
    if(hit&&now()-hit.at<(hit.value.width?10*60000:60000))return structuredClone(hit.value);
    if(pending.has(key))return pending.get(key);
    const ticket=generation,controller=new AbortController();controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(Object.assign(new Error('画质检测超时'),{name:'TimeoutError'})),12000);timer.unref?.();
    const read=async(target,limit)=>{const result=await request(safeHttpUrl(target),{headers:{...headers,Range:`bytes=0-${limit-1}`},responsePrefixBytes:limit,signal:controller.signal});if(disposed||ticket!==generation)throw Object.assign(new Error('画质检测已取消'),{name:'AbortError'});return result;};
    const task=(async()=>{
      let result={width:null,height:null,method:'unknown',variants:[],checkedAt:now()},current=url;
      try{
        for(let depth=0;depth<3;depth++){
          const response=await read(current,64*1024),bytes=response.bytes,text=bytes.toString('utf8'),base=response.url||current;
          if(!text.trimStart().startsWith('#EXTM3U')){
            const size=parseMp4VideoResolution(new Uint8Array(bytes))||parseTsVideoResolution(new Uint8Array(bytes));
            if(size&&dimensions(size.width,size.height))result={...result,...size,method:'segment'};break;
          }
          const variants=parseVariants(text,base);
          if(variants.length){
            result.variants=variants;
            const best=variants.find(item=>dimensions(item.width,item.height));
            if(best){result={...result,width:best.width,height:best.height,method:'manifest'};break;}
            current=variants[0].url;continue;
          }
          const info=mediaInfo(adFilter?filterM3u8(text):text,base);let sample;
          if(info.init){sample=(await read(info.init,64*1024)).bytes;const size=parseMp4VideoResolution(new Uint8Array(sample));if(size&&dimensions(size.width,size.height)){result={...result,...size,method:'segment'};break;}}
          if(!info.segment)break;sample=(await read(info.segment,96*1024)).bytes;
          if(info.method&&info.method!=='NONE'){
            if(info.method!=='AES-128'||!info.key){result.reason='该加密格式需播放后实测';break;}
            const keyBytes=(await read(info.key,16)).bytes;let iv;
            if(info.iv&&/^[\da-f]{1,32}$/i.test(info.iv))iv=Buffer.from(info.iv.padStart(32,'0'),'hex');
            else {iv=Buffer.alloc(16);iv.writeBigUInt64BE(BigInt(info.sequence),8);}
            sample=decryptAes128CbcPrefix(new Uint8Array(sample),new Uint8Array(keyBytes),new Uint8Array(iv));
          }
          const size=looksLikeMp4(sample)?parseMp4VideoResolution(sample):parseTsVideoResolution(sample);
          if(size&&dimensions(size.width,size.height))result={...result,...size,method:'segment'};else result.reason='清单未提供分辨率，需播放后实测';
          break;
        }
      }catch(error){if(error.name==='AbortError'||disposed||ticket!==generation)throw error;result.reason=String(error.message||error).slice(0,120);}
      result.label=qualityLabel(result);if(disposed||ticket!==generation)throw Object.assign(new Error('画质检测已取消'),{name:'AbortError'});return remember(key,result);
    })().finally(()=>{clearTimeout(timer);controllers.delete(controller);if(pending.get(key)===task)pending.delete(key);});pending.set(key,task);return task;
  }
  function cancel(){generation++;for(const controller of controllers)controller.abort(Object.assign(new Error('画质检测已取消'),{name:'AbortError'}));pending.clear();}
  return {probe,cancel,getStatus:()=>({pending:pending.size,cached:cache.size}),dispose(){disposed=true;cancel();cache.clear();}};
}
module.exports={createQualityProbe,parseVariants,mediaInfo,qualityLabel,dimensions};
