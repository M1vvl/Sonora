'use strict';
const crypto=require('node:crypto');

// One current official CDN URL, never a renderer-supplied proxy destination.
// Range requests stream through with backpressure; no full-song memory cache.
function createMusicStream({fetchImpl}){
  let current=null,disposed=false;
  const active=new Set();
  const allowed=require('./music/media-policy.cjs').audioURL;
  function stop(){const previous=current;current=null;previous?.decoder?.dispose();for(const controller of active)controller.abort();active.clear();}
  return {
    prepare(value,{decoder}={}){
      if(disposed)throw new Error('音乐播放已关闭');
      const url=allowed(value);
      if(!url)throw new Error('歌曲未返回可用的官方音频地址');
      stop();
      let adapter=decoder;
      if(!adapter&&/^m\d+c?\.music\.126\.net$/.test(url.hostname)&&/\.flac$/i.test(url.pathname)){
        adapter=require('./music/flac-stream.cjs').createFlacStream({url:url.href,fetchImpl});
      }
      current={url:url.href,token:crypto.randomBytes(20).toString('hex'),decoder:adapter};
      return `pulse-music-audio://track/${current.token}`;
    },
    async handle(request){
      const token=new URL(request.url).pathname.slice(1);
      if(disposed||!current||token!==current.token)return new Response(null,{status:404});
      if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
      if(current.decoder)return current.decoder.handle(request);
      if(active.size>=3)return new Response(null,{status:429});
      const range=request.headers.get('range');if(range&&!/^bytes=\d+-\d*$/.test(range))return new Response(null,{status:416});
      const controller=new AbortController();active.add(controller);
      const abort=()=>controller.abort();request.signal?.addEventListener('abort',abort,{once:true});if(request.signal?.aborted)abort();
      let timer=setTimeout(abort,10000),reader;
      function release(){clearTimeout(timer);request.signal?.removeEventListener('abort',abort);active.delete(controller);}
      try{
        let url=current.url,response;
        for(let redirects=0;redirects<=3;redirects++){
          response=await fetchImpl(url,{method:request.method,headers:{...(range?{Range:range}:{}),'Cache-Control':'no-store','Pragma':'no-cache'},signal:controller.signal,redirect:'manual',credentials:'omit',cache:'no-store'});
          if(![301,302,303,307,308].includes(response.status))break;
          await response.body?.cancel();const next=allowed(new URL(response.headers.get('location')||'',url).href);
          if(!next||redirects===3)throw new Error('Untrusted music redirect');url=next.href;
        }
        clearTimeout(timer);timer=null;
        if(![200,206].includes(response.status)){await response.body?.cancel();release();return new Response(null,{status:response.status===416?416:502});}
        const headers=new Headers({'Cache-Control':'no-store, max-age=0','Pragma':'no-cache','Expires':'0','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
        for(const name of ['content-type','content-length','content-range','accept-ranges']){const value=response.headers.get(name);if(value)headers.set(name,value);}
        if(!headers.has('content-type'))headers.set('content-type','application/octet-stream');
        if(request.method==='HEAD'){await response.body?.cancel();release();return new Response(null,{status:response.status,headers});}
        reader=response.body?.getReader();if(!reader)throw new Error('Missing audio stream');
        const body=new ReadableStream({
          async pull(output){try{const {done,value}=await reader.read();if(done){release();output.close();}else output.enqueue(value);}catch(error){release();output.error(error);}},
          async cancel(){controller.abort();release();await reader.cancel().catch(()=>{});}
        });
        return new Response(body,{status:response.status,headers});
      }catch{controller.abort();release();await reader?.cancel().catch(()=>{});return new Response(null,{status:502});}
    },
    stop,
    getStatus:()=>({prepared:!!current,active:active.size}),
    dispose(){disposed=true;stop();}
  };
}
module.exports={createMusicStream};
