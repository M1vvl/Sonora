(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicRemoteClock=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // The website exposes whole seconds. Interpolate only a short confirmed
  // interval; a stalled connection or buffering player must never run forever.
  function create({now=()=>Date.now()}={}){
    let anchor=0,at=0,duration=0,playing=false,valid=false;
    function update(position,total,isPlaying){
      const value=Math.max(0,Number(position)||0),stamp=now();
      duration=Math.max(0,Number(total)||0);
      if(!valid||value!==anchor||playing!==!!isPlaying){anchor=value;at=stamp;}
      playing=!!isPlaying;valid=true;
    }
    function position(){const value=anchor+(playing?Math.min(1.1,Math.max(0,(now()-at)/1000)):0);return duration?Math.min(duration,value):value;}
    return {update,position,reset(){valid=false;playing=false;anchor=0;at=0;duration=0;}};
  }
  return {create};
});
