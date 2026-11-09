/* MineRadio 03-beat/05-cover-loading-crop.js + 02-visual/15-ripples-cover-depth.js.
 * Centre-square 256/384/512px source canvas, 256px previous cover, original
 * 520ms crossfade and 180ms smoothstep depth reveal. All tweens share the
 * scene clock; no second RAF, source request or background cache. */
(() => {
  'use strict';
  let key='',revision=0,image=null,previous=null,pending=null,disposed=false,lastFrame=null,depthJob=null,mixRemaining=0,depthRemaining=0;
  function releaseCanvas(value){if(value?.getContext)value.width=value.height=1;}
  function squareCover(source,size){
    const value=document.createElement('canvas');value.width=value.height=size;
    const width=source.naturalWidth||source.width,height=source.naturalHeight||source.height;
    const side=Math.min(width,height);
    value.getContext('2d').drawImage(source,(width-side)/2,(height-side)/2,side,side,0,0,size,size);
    return value;
  }
  function set(url,frame){
    lastFrame=frame;if(disposed||url===key)return;key=url||'';
    const ticket=++revision;
    if(pending){pending.onload=pending.onerror=null;pending.removeAttribute('src');pending=null;}
    if(!key){uniforms.uHasCover.value=uniforms.uHasDepth.value=uniforms.uAiBoost.value=0;depthRemaining=mixRemaining=0;return;}
    const next=new Image();pending=next;next.crossOrigin='anonymous';next.decoding='async';
    next.onload=()=>{
      if(disposed||ticket!==revision){next.removeAttribute('src');return;}
      pending=null;
      releaseCanvas(previous);
      previous=image?squareCover(image,Math.min(256,image.width)):null;
      const requested=(Number(lastFrame?.settings?.coverResolution)||384)/248;
      const size=requested>=1.32?512:requested>=1.10?384:256;
      releaseCanvas(image);image=squareCover(next,size);
      next.onload=next.onerror=null;next.removeAttribute('src');
      if(previous){prevCoverTex.image=previous;prevCoverTex.needsUpdate=true;}
      coverTex.image=image;coverTex.needsUpdate=true;uniforms.uHasCover.value=1;mixRemaining=previous?.52:0;uniforms.uColorMixT.value=previous?0:1;
      uniforms.uHasDepth.value=uniforms.uAiBoost.value=0;depthRemaining=0;
      const sample=document.createElement('canvas');sample.width=sample.height=128;
      try{sample.getContext('2d').drawImage(image,0,0,128,128);updateLyricPaletteFromCover(sample);}catch{}finally{sample.width=sample.height=1;}
      if(depthJob!==null)clearTimeout(depthJob);
      depthJob=setTimeout(()=>{
        depthJob=null;
        if(disposed||ticket!==revision)return;
        try {
          const previousDepth=coverEdgeTex.image;
          coverEdgeTex.image=buildEdgeAndDepth(image);
          coverEdgeTex.needsUpdate=true;
          depthRemaining=.18;
          if(previousDepth?.getContext)previousDepth.width=previousDepth.height=1;
          window.PulseEmilyRedraw?.();
        }catch{}
      },0);
      window.PulseEmilyRedraw?.();
    };
    next.onerror=()=>{if(ticket===revision)uniforms.uHasCover.value=0;};next.src=key;
  }
  function dispose(){if(disposed)return;disposed=true;revision++;if(depthJob!==null)clearTimeout(depthJob);depthJob=null;if(pending){pending.onload=pending.onerror=null;pending.removeAttribute('src');}releaseCanvas(image);releaseCanvas(previous);image=previous=pending=lastFrame=null;depthRemaining=mixRemaining=0;}
  addEventListener('message',event=>{if(event.source===parent&&event.data?.token===new URLSearchParams(location.search).get('token')&&event.data.type==='pulse-preset-dispose')dispose();});
  window.PulseSourceCover={set,dispose,step(dt){
    if(disposed)return;
    if(mixRemaining>0){
      mixRemaining=Math.max(0,mixRemaining-dt);
      const t=1-mixRemaining/.52;
      uniforms.uColorMixT.value=t*t*(3-2*t);
    }
    if(depthRemaining>0){
      depthRemaining=Math.max(0,depthRemaining-dt);
      const t=1-depthRemaining/.18,eased=t*t*(3-2*t);
      uniforms.uHasDepth.value=eased;uniforms.uAiBoost.value=.55*eased;
    }
    // Playing already owns a continuous scene RAF. Only a paused material
    // reveal needs the existing one-shot redraw path to finish its tween.
    if(lastFrame?.playing===false&&(mixRemaining>0||depthRemaining>0))window.PulseEmilyRedraw?.();
  }};
})();
