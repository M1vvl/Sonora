'use strict';
const http=require('node:http'),net=require('node:net'),{randomBytes,createHash}=require('node:crypto'),{Readable}=require('node:stream');
const {filterM3u8}=require('./ad-filter.cjs');
function safeRemoteURL(value,{allowPrivate=false}={}){
  const url=new URL(value);
  if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.href.length>8192)throw new Error('无效的视频地址');
  const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(!allowPrivate&&(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host==='::1'||host.startsWith('fe80:')||host.startsWith('fc')&&net.isIP(host)===6||host.startsWith('fd')&&net.isIP(host)===6||/^(?:0|10|127|169\.254|192\.168)\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)||host==='0.0.0.0'))throw new Error('不支持本地或私有视频来源');
  return url.href;
}
function rewritePlaylist(content,baseURL,mapURL,{adFilter=true}={}){
  const source=adFilter?filterM3u8(content):content;
  return source.split(/\r?\n/).map(line=>{
    if(!line.trim())return line;
    if(line.trim().startsWith('#'))return line.replace(/URI="([^"]+)"/g,(_all,uri)=>`URI="${mapURL(new URL(uri,baseURL).href)}"`);
    return mapURL(new URL(line.trim(),baseURL).href);
  }).join('\n');
}
async function limitedText(response,limit){
  if(Number(response.headers.get('content-length'))>limit)throw new Error('播放列表过大');
  const reader=response.body.getReader(),parts=[];let length=0;
  try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>limit){await reader.cancel();throw new Error('播放列表过大');}parts.push(Buffer.from(next.value));}}finally{reader.releaseLock();}
  return Buffer.concat(parts,length).toString('utf8');
}
function createStreamGateway({fetchImpl=globalThis.fetch,allowPrivate=false,maxConcurrent=4}={}){
  let server=null,starting=null,disposed=false,generation=0,base='',secret='',active=0,settings={};
  const entries=new Map(),controllers=new Set(),sockets=new Set();
  const checked=value=>safeRemoteURL(value,{allowPrivate});
  function mapURL(value){
    const url=checked(value),id=createHash('sha256').update(url).digest('hex').slice(0,28),ext=/\.m3u8(?:[?#]|$)/i.test(url)?'m3u8':'bin';
    if(!entries.has(id)&&entries.size>=12000)throw new Error('播放列表超过条目限制');
    entries.set(id,url);return `${base}/${secret}/${id}.${ext}`;
  }
  async function handler(request,response){
    response.setHeader('Access-Control-Allow-Origin','*');response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
    const match=new RegExp('^/'+secret+'/([a-f0-9]{28})\\.(m3u8|bin)$').exec(request.url||'');
    if(!match||!entries.has(match[1])){response.writeHead(404);response.end();return;}
    if(active>=maxConcurrent){response.setHeader('Retry-After','1');response.writeHead(503);response.end();return;}
    const ticket=generation,controller=new AbortController();controllers.add(controller);active++;
    const timer=setTimeout(()=>controller.abort(),20000);timer.unref?.();
    response.once('close',()=>controller.abort());
    try{
      const url=entries.get(match[1]),headers={};
      if(settings.userAgent)headers['User-Agent']=settings.userAgent;
      if(settings.referer)headers.Referer=settings.referer;
      if(/^bytes=\d*-\d*$/.test(request.headers.range||''))headers.Range=request.headers.range;
      const upstream=await fetchImpl(url,{headers,signal:controller.signal,redirect:'follow'});
      if(upstream.url)checked(upstream.url);
      if(ticket!==generation)throw new Error('播放已切换');
      if(!upstream.ok)throw new Error('视频来源返回 HTTP '+upstream.status);
      const type=upstream.headers.get('content-type')||'';
      if(/mpegurl/i.test(type)||match[2]==='m3u8'){
        const text=await limitedText(upstream,2*1024*1024);
        if(!text.trimStart().startsWith('#EXTM3U'))throw new Error('无效的 HLS 播放列表');
        const output=rewritePlaylist(text,upstream.url||url,mapURL,settings);
        response.setHeader('Content-Type','application/vnd.apple.mpegurl');response.writeHead(200);response.end(request.method==='HEAD'?undefined:output);
      }else{
        response.setHeader('Content-Type',type||'application/octet-stream');
        for(const name of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(name);if(value)response.setHeader(name,value);}
        response.writeHead(upstream.status);
        if(request.method==='HEAD'){await upstream.body?.cancel();response.end();}
        else await new Promise((resolve,reject)=>{const stream=Readable.fromWeb(upstream.body);stream.once('error',reject);response.once('finish',resolve);response.once('close',resolve);stream.pipe(response);});
      }
    }catch(error){if(!response.headersSent)response.writeHead(controller.signal.aborted?504:502);if(!response.destroyed)response.end();}
    finally{clearTimeout(timer);controllers.delete(controller);active--;}
  }
  function start(){
    if(disposed)throw new Error('视频网关已关闭');if(server)return Promise.resolve();if(starting)return starting;
    starting=new Promise((resolve,reject)=>{const current=http.createServer(handler);current.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});current.once('error',reject);current.listen(0,'127.0.0.1',()=>{server=current;base='http://127.0.0.1:'+current.address().port;secret=randomBytes(24).toString('hex');resolve();});}).finally(()=>{starting=null;});return starting;
  }
  async function stop(){
    generation++;for(const controller of controllers)controller.abort();entries.clear();
    if(starting)await starting.catch(()=>{});const previous=server;server=null;
    for(const socket of sockets)socket.destroy();sockets.clear();base='';secret='';
    if(previous)await new Promise(resolve=>previous.close(resolve));
  }
  return {
    async prepare(plan,{adFilter=true}={}){
      const url=checked(plan.media?.url||plan.episode.url);
      if(!adFilter||!/\.m3u8(?:[?#]|$)/i.test(url))return plan;
      await stop();await start();settings={adFilter,userAgent:plan.rule.userAgent||'',referer:plan.rule.referer||url};
      return {...plan,media:{url:mapURL(url),format:'hls'}};
    },stop,getStatus:()=>({listening:!!server,active,entries:entries.size,disposed}),async dispose(){disposed=true;await stop();}
  };
}
module.exports={createStreamGateway,rewritePlaylist,safeRemoteURL};
