"use strict";
// A bounded recovery path for a lost transparent renderer, never a poll loop.
function attachSurfaceRecovery({window,isEnabled=()=>true,onReload=()=>{},onError=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,maxAttempts=2,windowMs=60000,delayMs=250}={}){
 if(!window?.webContents)throw new TypeError('Recovery requires a window');
 const web=window.webContents,listeners=[];let timer=null,disposed=false,attempts=[];
 const usable=()=>!disposed&&!window.isDestroyed()&&!web.isDestroyed()&&isEnabled();
 function cancel(){if(timer!==null)clearTimer(timer);timer=null;}
 function recover(reason){if(!usable()||timer!==null)return;attempts=attempts.filter(stamp=>now()-stamp<windowMs);if(attempts.length>=maxAttempts)return;timer=setTimer(()=>{timer=null;if(!usable())return;attempts.push(now());try{web.reloadIgnoringCache();onReload(reason);}catch(error){onError(error);}},delayMs);timer?.unref?.();}
 const on=(object,event,fn)=>{object.on(event,fn);listeners.push(()=>object.removeListener(event,fn));};
 on(web,'render-process-gone',(_event,details)=>recover('renderer-'+(details?.reason||'gone')));
 on(web,'did-fail-load',(_event,code,_description,_url,mainFrame)=>{if(mainFrame!==false&&code!==-3)recover('load-'+code);});
 on(window,'unresponsive',()=>recover('unresponsive'));
 const dispose=()=>{if(disposed)return;disposed=true;cancel();listeners.splice(0).forEach(remove=>remove());};on(window,'closed',dispose);
 return {recover,cancel,dispose,getStatus:()=>({pending:timer!==null,attempts:attempts.length,disposed})};
}
module.exports={attachSurfaceRecovery};
