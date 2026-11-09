(function(host,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else host.PulseDashboardState=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Own only persistence timing. The dashboard owns what is captured and the
  // main process owns validation and durable writes; no usage data lives here.
  function create({capture,save,flushSync,onError,delayMs=180,view=globalThis}={}){
    if(typeof capture!=='function'||typeof save!=='function')throw new TypeError('Dashboard state needs capture and save functions');
    const delay=Number.isFinite(delayMs)?Math.max(0,Math.min(2000,delayMs)):180;
    let started=false,disposed=false,timer=null,generation=0,lastSignature=null,lastPromise=Promise.resolve(true);
    function report(error){if(!disposed&&typeof onError==='function'){try{onError(error);}catch{}}}
    function cancelTimer(){if(timer!==null){view.clearTimeout(timer);timer=null;}}
    function snapshot(){
      const signature=JSON.stringify(capture());
      if(signature===undefined)throw new TypeError('Dashboard state must be JSON serializable');
      return {signature,value:JSON.parse(signature)};
    }
    function checkResult(result){if(result?.error)throw new Error(String(result.error));return true;}
    function commit(){
      if(disposed||!started)return Promise.resolve(false);
      let next;try{next=snapshot();}catch(error){report(error);return Promise.resolve(false);}
      if(next.signature===lastSignature)return lastPromise;
      const current=++generation;
      lastSignature=next.signature;
      // Invoke immediately, rather than queueing old writes behind an exit
      // flush. Electron handles these bounded messages in send order.
      let result;try{result=save(next.value);}catch(error){if(current===generation){lastSignature=null;report(error);}return Promise.resolve(false);}
      lastPromise=Promise.resolve(result).then(checkResult).catch(error=>{
        if(current===generation){lastSignature=null;report(error);}return false;
      });
      return lastPromise;
    }
    function flush(){cancelTimer();return commit();}
    function schedule(){
      if(disposed||!started)return;
      cancelTimer();timer=view.setTimeout(()=>{timer=null;commit();},delay);
    }
    function beforeUnload(){
      cancelTimer();if(disposed||!started||typeof flushSync!=='function')return;
      // The rare synchronous path captures a pending scroll/toggle immediately
      // before destruction; there is no asynchronous work to lose at exit.
      ++generation;
      try{const next=snapshot();checkResult(flushSync(next.value));lastSignature=next.signature;lastPromise=Promise.resolve(true);}
      catch(error){lastSignature=null;report(error);}
    }
    view.addEventListener?.('beforeunload',beforeUnload);
    return Object.freeze({
      start(){if(!disposed)started=true;},schedule,flush,
      dispose(){if(disposed)return;cancelTimer();disposed=true;started=false;++generation;view.removeEventListener?.('beforeunload',beforeUnload);}
    });
  }
  return Object.freeze({create});
});
