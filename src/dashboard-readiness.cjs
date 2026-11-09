'use strict';

// A hidden transparent window may never emit ready-to-show. The local document
// and its initialized renderer own readiness, with an explicit repaint before
// reveal. Keep this gate separate from music ownership and bounded reloads.
function attachDashboardReadiness({window,onReady=()=>{},onLoading=()=>{},onTimeout=()=>{},onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,timeoutMs=10000}) {
  const web=window.webContents,listeners=[];
  let nativePainted=false,loaded=false,rendererReady=false,ready=false,disposed=false,timer=null;
  const usable=()=>!disposed&&!window.isDestroyed()&&!web.isDestroyed();
  const on=(target,event,listener)=>{target.on(event,listener);listeners.push(()=>target.removeListener(event,listener));};
  function cancelDeadline() {
    if(timer!==null)clearTimer(timer);
    timer=null;
  }
  function armDeadline() {
    cancelDeadline();
    timer=setTimer(()=>{timer=null;if(usable()&&!ready)onTimeout();},timeoutMs);
    timer?.unref?.();
  }
  function repaint() {
    if(!usable()||!ready)return false;
    try {web.invalidate();return true;} catch(error) {onError(error);return false;}
  }
  function complete() {
    if(!usable()||ready||!loaded||!rendererReady)return;
    ready=true;cancelDeadline();repaint();onReady();
  }
  function loading(reason) {
    if(!usable())return;
    ready=false;loaded=false;rendererReady=false;
    onLoading(reason);armDeadline();
  }
  on(window,'ready-to-show',()=>{nativePainted=true;complete();});
  on(web,'did-start-navigation',(_event,_url,sameDocument,mainFrame)=>{
    if(mainFrame===true&&!sameDocument)loading('navigation');
  });
  on(web,'did-finish-load',()=>{loaded=true;complete();});
  on(web,'render-process-gone',()=>loading('renderer-gone'));
  on(web,'did-fail-load',(_event,code,_description,_url,mainFrame)=>{
    if(mainFrame!==false&&code!==-3)loading('load-failed');
  });
  function dispose() {
    if(disposed)return;
    disposed=true;ready=false;cancelDeadline();listeners.splice(0).forEach(remove=>remove());
  }
  on(window,'closed',dispose);
  armDeadline();
  return {
    markRendererReady(){if(!usable())return false;rendererReady=true;complete();return true;},
    isReady:()=>usable()&&ready,
    repaint,
    dispose,
    getStatus:()=>({nativePainted,loaded,rendererReady,ready,disposed,pendingDeadline:timer!==null})
  };
}

module.exports={attachDashboardReadiness};
