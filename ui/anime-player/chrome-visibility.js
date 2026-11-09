(function(host,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else host.PulsePlayerChrome=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // A single timer owns both control bars. Native HWND pointer observations and
  // DOM input share this policy; no frame loop or layout polling is started.
  function create({onChange=()=>{},delay=2500,outsideDelay=150,schedule=setTimeout,cancel=clearTimeout}={}){
    let ready=false,hidden=false,disposed=false,timer=null,insideApp=true,insideVideo=true,lastPoint=null;
    const holds=new Set();
    function clear(){if(timer!==null)cancel(timer);timer=null;}
    function visible(value){if(disposed||hidden===!value)return;hidden=!value;onChange({hidden});}
    function arm(ms){clear();if(!disposed&&ready&&!holds.size&&(insideVideo||!insideApp))timer=schedule(()=>{timer=null;if(ready&&!holds.size)visible(false);},ms);}
    function activity(){if(disposed)return;clear();visible(true);if(ready&&!holds.size)arm(insideApp?delay:outsideDelay);}
    function hold(key,value){if(disposed)return;if(value){holds.add(key);clear();visible(true);}else if(holds.delete(key))activity();}
    function pointer(value={}){
      if(disposed||typeof value?.insideApp!=='boolean')return;
      const wasInside=insideApp,wasVideo=insideVideo;
      insideApp=value.insideApp;insideVideo=insideApp&&value.insideVideo!==false;
      const point=Number.isFinite(value.x)&&Number.isFinite(value.y)?[value.x,value.y]:null;
      // Native coordinates are physical parent-client pixels; DOM pointer
      // coordinates use CSS pixels. The producer's explicit movement flag is
      // authoritative so a 150% DPI boundary never becomes a false movement.
      const moved=typeof value.changed==='boolean'?value.changed:point&&lastPoint&&(point[0]!==lastPoint[0]||point[1]!==lastPoint[1]);
      if(point)lastPoint=point;
      if(!insideApp){if(wasInside)arm(outsideDelay);return;}
      // Resizing the native viewport changes its hit classification even when
      // the cursor has not moved. That notification must not reopen the bars
      // and cause an expand/collapse feedback loop.
      if(!insideVideo){if(!hidden||!wasInside||moved){clear();visible(true);}return;}
      if(!wasInside||moved)activity();else if(!wasVideo&&!hidden)arm(delay);
    }
    return {activity,pointer,hold,setReady(value){const next=value===true;if(disposed||ready===next)return;ready=next;clear();visible(true);if(ready)activity();},
      getState:()=>({ready,hidden,holds:[...holds],timer:timer!==null,disposed}),dispose(){disposed=true;clear();holds.clear();lastPoint=null;}};
  }
  return {create};
});
