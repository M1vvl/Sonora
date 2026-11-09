/* MineRadio lyric timing / reveal / persistent-track adaptation.
 * GPL-3.0: 06-lyrics/00-lyrics-fetch-parse.js, 02-visual/11-lyrics-shaders.js,
 * 13-lyrics-mesh-build.js and 14-stage-lyrics-rendering.js.
 * Same source clock and smoothstep/feather semantics, bounded DOM projection.
 * See docs/v021-lyrics-rea.md. No complete-song audio decoding or extra audio. */
(function(host,factory){'use strict';const value=factory(typeof module==='object'&&module.exports?require('./audio-analysis.js'):host.PulseMusicAudioAnalysis);if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseLyricMotion=value;})(typeof window==='object'?window:globalThis,function(analysisModule){
  'use strict';
  const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number(value)||0));
  function normalizeLines(values){return (Array.isArray(values)?values:[]).slice(0,800).filter(line=>Number.isFinite(Number(line?.time))&&typeof line.text==='string'&&line.text.trim()).map(line=>{
    const text=line.text.slice(0,500),value={time:Math.max(0,Number(line.time)),text};
    if(Number.isFinite(line.duration)&&line.duration>0)value.duration=Math.min(86400,line.duration);
    if(typeof line.translation==='string'&&line.translation.trim())value.translation=line.translation.slice(0,500);
    if(Array.isArray(line.words)){value.words=line.words.slice(0,200).filter(word=>Number.isFinite(word.time)&&Number.isFinite(word.duration)&&word.duration>=0&&Number.isInteger(word.c0)&&Number.isInteger(word.c1)&&word.c0>=0&&word.c1>word.c0&&word.c1<=text.length).map(word=>({...word,text:text.slice(word.c0,word.c1),duration:Math.max(.06,word.duration)}));if(!value.words.length)delete value.words;}
    return value;
  }).sort((a,b)=>a.time-b.time);}
  function findLine(lines,position){let low=0,high=lines.length-1,index=-1;while(low<=high){const mid=(low+high)>>1;if(lines[mid].time<=position){index=mid;low=mid+1;}else high=mid-1;}return index;}
  // MineRadio keeps the focused line at authored scale. Extend its near/far
  // context distinction to every visible row, with readable lower bounds.
  function contextStyle(distance,opacity=.54){
    const steps=Math.max(0,Math.abs(Number(distance)||0)-1);
    return {scale:Math.max(.62,.90*Math.pow(.92,steps)),opacity:Math.max(.08,clamp(opacity,.1,.9)*.92*Math.pow(.75,steps))};
  }
  function progressAt(line,next,position,duration=0){
    if(!line||position<line.time)return 0;
    if(line.words?.length){let progress=0;for(const word of line.words){if(position<word.time)return progress;const local=clamp((position-word.time)/Math.max(.08,word.duration));progress=Math.max(progress,(word.c0+(word.c1-word.c0)*local)/Math.max(1,line.text.length));if(local<1)return progress;}return 1;}
    const end=next?.time>line.time?next.time:Math.min(duration>line.time?duration:line.time+4.8,line.time+(line.duration||4.8));
    const value=clamp((position+.020-line.time)/Math.max(.75,end-line.time));return value*value*(3-2*value);
  }
  function create({root,immersive=false,getSettings=()=>({})}={}){
    const document=root.ownerDocument,view=document.defaultView,track=document.createElement('div'),nodes=new Map(),listeners=[];
    root.classList.add('pulse-lyric-projection');root.classList.toggle('pulse-lyric-immersive',immersive);track.className='pulse-lyric-track';root.append(track);
    let disposed=false,active=false,obscured=false,visible=true,audio=null,analysis=null,lines=[],centers=[],heights=[],index=-1,position=0,frame=null,lastStamp=0,shownOffset=null,targetOffset=0,shownProgress=0,progress=0,builds=0,pendingMeasure=true,lastSettings='',source='unsynced',seeking=false;
    const motion=view.matchMedia?.('(prefers-reduced-motion:reduce)'),now=()=>view.performance?.now?.()||Date.now();
    const on=(node,name,fn)=>{node?.addEventListener(name,fn);listeners.push(()=>node?.removeEventListener(name,fn));};
    function settings(){const value=getSettings()||{};return value;}
    function allowed(){return !disposed&&active&&!obscured&&visible&&!document.hidden&&!(immersive&&settings().lyricMode==='off');}
    function stop(){if(frame!==null)view.cancelAnimationFrame(frame);frame=null;lastStamp=0;}
    function dimensions(){const style=view.getComputedStyle(root),size=parseFloat(style.fontSize)||(immersive?20:12),width=root.clientWidth||(immersive?800:250),s=settings(),lineHeight=clamp(s.lyricLineHeight||1.4,.72,1.8);let context=null;
      if(view.CanvasRenderingContext2D)try{context=document.createElement('canvas').getContext('2d');context.font=`${s.fontWeight||650} ${size}px ${style.fontFamily||'system-ui'}`;}catch{}
      const measure=text=>context?context.measureText(text).width:text.length*size*.55;let y=0;centers=[];heights=[];
      for(const line of lines){const rows=Math.max(1,Math.ceil(measure(line.text)/Math.max(40,width-16))),translated=line.translation?size*clamp(s.translationSize||.65,.4,1)*1.4+size*clamp(s.translationGap||.75,.2,2):0,height=rows*size*lineHeight+translated+size*(immersive?.58:.8)*clamp(s.lyricContextSpread||1,0.8,3);heights.push(height);centers.push(y+height/2);y+=height;}
      track.style.height=y+'px';root.style.setProperty('--motion-line-height',String(lineHeight));root.style.setProperty('--motion-letter-spacing',clamp(s.lyricLetterSpacing||0,-.05,.3)+'em');root.style.setProperty('--motion-edge-fade',(clamp(s.lyricEdgeFade??.12,0,.5)*100)+'%');pendingMeasure=false;
    }
    function buildNode(line,n){const row=document.createElement('p');row.className=immersive?'pulse-lyric-row music-immersive-line':'pulse-lyric-row';row.dataset.lineIndex=String(n);const body=document.createElement('span');body.className='pulse-lyric-row-body';const original=document.createElement('span');original.className='pulse-lyric-original';
      if(line.words?.length){let at=0;for(const word of line.words){if(word.c0>at)original.append(document.createTextNode(line.text.slice(at,word.c0)));const span=document.createElement('span');span.className='pulse-lyric-word';span.textContent=line.text.slice(word.c0,word.c1);span.dataset.wordTime=String(word.time);original.append(span);at=word.c1;}if(at<line.text.length)original.append(document.createTextNode(line.text.slice(at)));}
      else original.textContent=line.text;
      body.append(original);if(line.translation){const translation=document.createElement('small');translation.textContent=line.translation;body.append(translation);}row.append(body);track.append(row);builds++;return row;
    }
    function updateWindow(){const s=settings(),mode=immersive?s.lyricMode||'immersive':'multi',count=mode==='single'?1:mode==='double'?2:mode==='triple'?3:Math.round(clamp(s.lyricLines||7,3,15)),center=Math.max(0,index),radius=immersive?Math.min(8,Math.ceil(count/2)+2):6,visibleStart=Math.max(0,Math.min(lines.length-count,center-Math.floor((count-1)/2))),visibleEnd=Math.min(lines.length-1,visibleStart+count-1),min=Math.max(0,Math.min(center-radius,visibleStart)),max=Math.min(lines.length-1,Math.max(center+radius,visibleEnd));
      if(mode==='off'){for(const row of nodes.values())row.hidden=true;return;}
      for(let n=min;n<=max;n++){let row=nodes.get(n);if(!row){row=buildNode(lines[n],n);nodes.set(n,row);}row.hidden=false;row.style.top=(centers[n]-heights[n]/2)+'px';const distance=Math.abs(n-center),current=n===index;row.classList.toggle('is-current',current);if(current)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');row.dataset.timing=lines[n].words?.length?'word':'line';
        const context=contextStyle(distance,s.lyricContextOpacity??.42);row.style.opacity=String(current?1:context.opacity);row.querySelector('.pulse-lyric-row-body').style.transform=`scale(${current?1:context.scale})`;
        const translation=row.querySelector('small'),translationMode=s.translationMode||'current';if(translation)translation.hidden=immersive&&(translationMode==='off'||(translationMode==='current'&&!current)||(translationMode==='double'&&n!==index&&n!==index+1));
        row.classList.toggle('is-outside-window',immersive&&(n<visibleStart||n>visibleEnd));
      }
      for(const[n,row]of nodes)if(n<min||n>max){row.remove();nodes.delete(n);}
    }
    function fill(){const row=nodes.get(index);if(!row)return;const s=settings(),native=!!lines[index]?.words?.length,feather=clamp(s.lyricFeather||(native?.03:.055),.005,.2),original=row.querySelector('.pulse-lyric-original');row.style.setProperty('--lyric-reveal',`${(shownProgress*100).toFixed(3)}%`);row.style.setProperty('--lyric-feather',`${(feather*100).toFixed(2)}%`);row.dataset.fill=s.lyricFill===false?'off':'on';
      if(native){const spans=original.querySelectorAll('.pulse-lyric-word'),cached=row.__pulseWordReveals||[];lines[index].words.forEach((word,n)=>{const value=(clamp((position-word.time)/Math.max(.08,word.duration))*100).toFixed(3);if(cached[n]!==value){cached[n]=value;spans[n]?.style.setProperty('--word-reveal',value+'%');}});row.__pulseWordReveals=cached;}
      const signal=analysis?.sample(now()),energy=Number(signal?.energy)||0,glow=clamp(s.lyricGlowStrength??.28,0,2)*(s.lyricGlowBeat===false?1:1+energy*.65),shimmer=clamp(s.lyricShimmer||0,0,2),sweep=clamp(s.lyricSweep||0,0,2),glitch=s.lyricMotionStyle==='glitch'?clamp(s.lyricGlitchIntensity??1,0,2):clamp(s.lyricGlitch||0,0,1),rate=clamp(s.lyricGlitchRate||1,.1,2.2),phase=Math.sin(position*(61+rate*26)),gate=phase>.74?phase:0,jitter=glitch*gate*clamp(s.lyricGlitchJitter??.72,0,1.4),chroma=jitter*clamp(s.lyricGlitchChroma??.86,0,2)*2.5;
      const reduced=motion?.matches||s.lyricMotion===false||s.lyricMotionStyle==='stable',bright=1+shimmer*(.08+(reduced?0:Math.sin(position*3)*.04));
      original.style.filter=`brightness(${bright.toFixed(3)}) drop-shadow(0 1px ${(1+glow*5+sweep*2).toFixed(2)}px color-mix(in srgb,var(--lyric-hi) 48%,transparent))`;
      original.style.transform=reduced?'none':`translate3d(${(jitter*clamp(s.lyricGlitchSlice??.72,0,1.4)*3).toFixed(3)}px,${(s.lyricVerticalFloat===false?0:-Math.min(1.5,energy*2)).toFixed(3)}px,0)`;
      original.style.textShadow=chroma&&!reduced?`${chroma.toFixed(2)}px 0 #d8baff,${(-chroma).toFixed(2)}px 0 #9de3df`:'none';
      row.style.setProperty('--lyric-sweep',String(sweep));
    }
    function project(value,{snap=false,dt=1/60}={}){if(disposed)return;position=Math.max(0,Number(value)||0);const measured=pendingMeasure;if(measured)dimensions();const next=findLine(lines,position),changed=next!==index;if(changed){index=next;shownProgress=0;}if(changed||measured)updateWindow();
      const current=lines[index],s=settings(),reduced=motion?.matches||s.lyricMotion===false;root.dataset.lyricMotion=String(!reduced);progress=progressAt(current,lines[index+1],position,audio?.duration||0);source=current?.words?.length?'yrc-word':current?.time===86400?'unsynced':current?'lrc-line':'unsynced';
      const height=root.clientHeight||(immersive?480:250);targetOffset=height/2-(centers[Math.max(0,index)]||0);
      const softness=clamp(s.lyricMotionSoftness??.72,.1,1),response=clamp((s.lyricProgressEase||.18)*(1.4-softness*.8),.04,.5),ease=1-Math.pow(1-response,Math.max(.25,dt*60));
      shownOffset=shownOffset===null||snap||seeking||reduced?targetOffset:shownOffset+(targetOffset-shownOffset)*ease;
      shownProgress=snap||seeking||reduced||current?.words?.length?progress:shownProgress+(progress-shownProgress)*(Math.abs(progress-shownProgress)>.42?Math.max(.52,ease*1.55):ease);
      track.style.transform=`translate3d(0,${shownOffset.toFixed(3)}px,0)`;fill();
    }
    function tick(stamp){frame=null;if(!allowed()||!audio||audio.paused||audio.ended)return;const dt=Math.min(.1,Math.max(1/120,(stamp-(lastStamp||stamp-16.7))/1000));lastStamp=stamp;project(audio.currentTime,{dt});frame=view.requestAnimationFrame(tick);}
    function sync(){stop();if(!allowed())return;project(audio?.hasAttribute('src')?audio.currentTime:position,{snap:!!audio?.paused});if(audio&&!audio.paused&&!audio.ended){analysis?.ensure();analysis?.resume();frame=view.requestAnimationFrame(tick);}}
    function updateSettings(){const s=settings(),key=JSON.stringify(s);if(key!==lastSettings){lastSettings=key;pendingMeasure=true;}if(immersive&&s.lyricMode==='off')for(const row of nodes.values())row.hidden=true;sync();}
    const audioEvents=[];
    function attachAudio(value){if(audio===value){sync();return;}for(const[name,fn]of audioEvents.splice(0))audio?.removeEventListener(name,fn);analysis?.release();audio=value;analysis=audio&&analysisModule?analysisModule.acquire(audio):null;if(audio){for(const name of ['playing','pause','ended','seeking','seeked','timeupdate']){const fn=()=>{if(name==='seeking')seeking=true;if(name==='seeked')seeking=false;sync();};audio.addEventListener(name,fn);audioEvents.push([name,fn]);}}sync();}
    on(document,'visibilitychange',sync);on(motion,'change',sync);const resize=typeof view.ResizeObserver==='function'?new view.ResizeObserver(()=>{pendingMeasure=true;sync();}):null;resize?.observe(root);const intersection=typeof view.IntersectionObserver==='function'?new view.IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;sync();}):null;intersection?.observe(root);
    return {setLines(value){lines=normalizeLines(value);index=-1;shownOffset=null;shownProgress=0;pendingMeasure=true;nodes.clear();track.replaceChildren();if(allowed())project(position,{snap:true});sync();},time(value){const next=Math.max(0,Number(value)||0),jump=Math.abs(next-position)>1.25;if(!allowed()){position=next;return;}project(next,{snap:jump});sync();},attachAudio,updateSettings,activate(){active=true;sync();},deactivate(){active=false;stop();},setObscured(value){obscured=!!value;sync();},getState:()=>({index,position,progress,shownProgress,timingSource:source,rendered:nodes.size,active,pendingFrame:frame!==null,builds,offset:shownOffset}),dispose(){if(disposed)return;disposed=true;stop();for(const[name,fn]of audioEvents)audio?.removeEventListener(name,fn);audioEvents.length=0;analysis?.release();analysis=null;audio=null;resize?.disconnect();intersection?.disconnect();listeners.splice(0).forEach(remove=>remove());nodes.clear();track.remove();root.classList.remove('pulse-lyric-projection','pulse-lyric-immersive');}};
  }
  return {create,normalizeLines,findLine,progressAt,contextStyle};
});
