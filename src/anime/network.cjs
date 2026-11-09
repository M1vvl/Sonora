'use strict';
const {safeHttpUrl,UA}=require('./config.cjs');

// Separate bounded request queue; never driven by the monitoring refresh timer.
function createNetwork({fetchImpl=globalThis.fetch,concurrency=4,timeout=18000,maxBytes=6*1024*1024}={}) {
  let stopped=false,active=0;
  const queue=[],controllers=new Set();
  const cancelled=()=>Object.assign(new Error(stopped?'番剧模块已关闭':'请求已取消'),{name:'AbortError'});
  function pump(){while(!stopped&&active<concurrency&&queue.length){const entry=queue.shift();active++;run(entry).finally(()=>{active--;pump();});}}
  async function run({url,options,resolve,reject}) {
    const controller=new AbortController();controllers.add(controller);
    const {signal:externalSignal,responsePrefixBytes,...fetchOptions}=options;
    const signal=externalSignal?AbortSignal.any([controller.signal,externalSignal]):controller.signal;
    const prefix=Number.isSafeInteger(responsePrefixBytes)&&responsePrefixBytes>0&&responsePrefixBytes<=128*1024?responsePrefixBytes:null;
    const timer=setTimeout(()=>controller.abort(Object.assign(new Error('请求超时，请稍后重试'),{name:'TimeoutError'})),timeout);timer.unref?.();
    try {
      signal.throwIfAborted();
      const response=await fetchImpl(safeHttpUrl(url),{...fetchOptions,headers:{'user-agent':UA,...options.headers},signal});
      signal.throwIfAborted();
      if(response.headers?.get('cf-mitigated')==='challenge')throw new Error('来源需要人工完成验证，请在来源页面验证后重试');
      if(!response.ok)throw new Error('来源返回 HTTP '+response.status);
      const declared=Number(response.headers?.get('content-length'));
      if(!prefix&&declared>maxBytes)throw new Error('来源响应超过大小限制');
      let bytes;
      if(response.body?.getReader) {
        const reader=response.body.getReader(),parts=[];let total=0;
        try {for(;;){const part=await reader.read();if(part.done)break;const value=prefix?part.value.subarray(0,Math.max(0,prefix-total)):part.value;total+=value.length;if(total>maxBytes){await reader.cancel();throw new Error('来源响应超过大小限制');}parts.push(Buffer.from(value));if(prefix&&total>=prefix){await reader.cancel();break;}}}finally{reader.releaseLock();}
        bytes=Buffer.concat(parts,total);
      } else {if(prefix)throw new Error('来源不支持有界分片读取');bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>maxBytes)throw new Error('来源响应超过大小限制');}
      const contentType=response.headers?.get('content-type')||'';
      signal.throwIfAborted();
      resolve({bytes,text:()=>new TextDecoder(/charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1]||'utf-8').decode(bytes),contentType,url:response.url||url});
    }catch(error){reject(signal.aborted?signal.reason:stopped?cancelled():error?.message==='fetch failed'?new Error('无法连接来源，请检查网络后重试',{cause:error}):error);}finally{clearTimeout(timer);controllers.delete(controller);}
  }
  function request(url,options={}) {if(stopped)return Promise.reject(cancelled());return new Promise((resolve,reject)=>{queue.push({url,options,resolve,reject});pump();});}
  function cancel(){for(const entry of queue.splice(0))entry.reject(cancelled());for(const c of controllers)c.abort(cancelled());}
  return {request,async text(url,options){return(await request(url,options)).text();},async json(url,options){return JSON.parse((await request(url,options)).text());},cancel,dispose(){stopped=true;cancel();},getStatus(){return {active,queued:queue.length,stopped};}};
}
module.exports={createNetwork};
