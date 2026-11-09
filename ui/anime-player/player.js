(function(host,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./player-settings.js'),require('./chrome-visibility.js'));
  else{
    const api=factory(host.PulsePlayerSettings,host.PulsePlayerChrome);host.PulseAnimePlayer=api;
    const mount=()=>{if(host.animePlayer)api.create({document:host.document,bridge:host.animePlayer,Hls:host.Hls,themes:host.PulseThemes});};
    if(host.document.readyState==='loading')host.document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  }
})(typeof window==='object'?window:globalThis,function(model,chromeModel){
  'use strict';
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const CONTROLS=new Set(['togglePause','seek','episode','fullscreen','exitFullscreen','superResolution','outputResolution','aspect','speed','volume','mute','brightness','contrast','saturation','gamma']);
  function create({document,bridge,Hls,themes}={}){
    if(!document||typeof bridge?.action!=='function')throw new TypeError('Player document and playback bridge are required');
    const view=document.defaultView,$=id=>document.getElementById(id),video=$('video'),stage=$('video-stage');
    const listeners=[],unsubscribers=[];
    const on=(target,name,callback,options)=>{target.addEventListener(name,callback,options);listeners.push(()=>target.removeEventListener(name,callback,options));};
    const frame=callback=>view.requestAnimationFrame?view.requestAnimationFrame(callback):view.setTimeout(callback,0);
    const cancelFrame=id=>view.cancelAnimationFrame?view.cancelAnimationFrame(id):view.clearTimeout(id);
    let current=null,settings={...model.DEFAULTS},playback={position:0,duration:0,paused:true,volume:100,mute:false,speed:1};
    let disposed=false,hls=null,source=null,activePlaybackId=null,lastProgress=0,native=false,panel=null,episodeSignature='',viewportFrame=0,viewportTimer=null,chromeExitTimer=null,lastViewport='',seeking=false,previewPosition=null,lastMessage='',statusError=false;
    document.body.dataset.chromeHidden='false';document.body.dataset.chromeCollapsed='false';
    const chrome=chromeModel.create({schedule:(callback,delay)=>view.setTimeout(callback,delay),cancel:id=>view.clearTimeout(id),onChange:presentChrome});
    function presentChrome({hidden}){
      if(chromeExitTimer!==null)view.clearTimeout(chromeExitTimer);chromeExitTimer=null;
      document.body.dataset.chromeHidden=String(hidden);
      if(!hidden){document.body.dataset.chromeCollapsed='false';resize();return;}
      const releaseSpace=()=>{
        chromeExitTimer=null;if(disposed||!chrome.getState().hidden)return;
        document.body.dataset.chromeCollapsed='true';resize();
      };
      // Hidden/occluded WebContentsViews can stop compositor-driven CSS
      // transitions as well as RAF. One owned timeout completes the exit and
      // releases native video space independently of transitionend or frames.
      if(view.matchMedia?.('(prefers-reduced-motion: reduce)').matches)releaseSpace();
      else chromeExitTimer=view.setTimeout(releaseSpace,160);
    }
    $('speed-options').replaceChildren(...model.SPEEDS.map(speed=>{const button=document.createElement('button');button.dataset.speed=String(speed);button.textContent=`${speed}×`;return button;}));
    function message(value,failure=false){if(disposed)return;lastMessage=String(value||'');statusError=failure;$('player-announcement').textContent=failure?lastMessage:'';}
    async function action(name,value){
      if(disposed)return null;
      try{const result=await bridge.action(name,value);if(result?.error)throw new Error(result.error);if(result?.message)message(result.message);return result;}
      catch(error){message(error?.message||'操作暂时未完成，请重试',true);return null;}
    }
    function progress(final=false){
      if(native||!current||!activePlaybackId||video.currentTime<1)return;
      action('progress',{playbackId:activePlaybackId,position:video.currentTime,duration:video.duration,final});
    }
    function releaseHTML(){
      activePlaybackId=null;source=null;
      if(hls){hls.destroy();hls=null;}
      video.pause();video.removeAttribute('src');video.load();$('resume-play').hidden=true;
    }
    function reportViewport(){
      cancelFrame(viewportFrame);viewportFrame=0;if(viewportTimer!==null)view.clearTimeout(viewportTimer);viewportTimer=null;if(disposed)return;
      const box=stage.getBoundingClientRect(),scale=Math.max(.5,Math.min(4,finite(view.devicePixelRatio,1)));
      const rect={x:box.x,y:box.y,width:box.width,height:box.height,scale,visible:native&&current?.phase==='ready'&&!document.hidden&&box.width>0&&box.height>0};
      const signature=JSON.stringify(rect);if(signature===lastViewport)return;lastViewport=signature;
      action('viewport',rect);
    }
    function scheduleViewport(){if(disposed)return;if(document.hidden){reportViewport();return;}if(!viewportFrame){viewportFrame=frame(reportViewport);viewportTimer=view.setTimeout(reportViewport,50);}}
    function htmlAspect(){
      if(native)return;
      video.style.position='absolute';video.style.top='0px';video.style.left='0px';video.style.width='100%';video.style.height='100%';video.style.objectFit=['cover','fill'].includes(settings.aspect)?settings.aspect:'contain';
      if(settings.aspect==='16:9'||settings.aspect==='4:3'){
        const box=stage.getBoundingClientRect(),ratio=settings.aspect==='16:9'?16/9:4/3;
        const width=Math.min(box.width,box.height*ratio),height=width/ratio;
        video.style.width=`${width}px`;video.style.height=`${height}px`;video.style.left=`${(box.width-width)/2}px`;video.style.top=`${(box.height-height)/2}px`;video.style.objectFit='fill';
      }
    }
    function resize(){htmlAspect();scheduleViewport();}
    function showPanel(kind,focusId){
      panel=panel===kind&&!focusId?null:kind;
      $('player-panel').hidden=!panel;$('picture-panel').hidden=panel!=='picture';$('episode-panel').hidden=panel!=='episodes';
      $('panel-title').textContent=panel==='episodes'?'选择集数':'画面设置';
      for(const id of ['picture-toggle','sr-toggle','speed-toggle'])$(id).setAttribute('aria-expanded',String(panel==='picture'));
      $('episodes-toggle').setAttribute('aria-expanded',String(panel==='episodes'));
      chrome.hold('panel',!!panel);resize();
      if(focusId&&panel){const target=$(focusId);target?.scrollIntoView?.({block:'nearest'});target?.querySelector('button:not(:disabled),input:not(:disabled)')?.focus();}
    }
    function srSupported(){return native&&current?.capabilities?.superResolution!==false;}
    function pictureSupported(){return native&&current?.capabilities?.pictureAdjustments!==false;}
    function renderSettings(){
      for(const button of document.querySelectorAll('[data-output]')){button.setAttribute('aria-pressed',String(button.dataset.output===settings.outputResolution));button.disabled=!srSupported();}
      for(const button of document.querySelectorAll('[data-sr]')){button.setAttribute('aria-pressed',String(button.dataset.sr===settings.superResolution));button.disabled=!srSupported();}
      for(const button of document.querySelectorAll('[data-aspect]'))button.setAttribute('aria-pressed',String(button.dataset.aspect===settings.aspect));
      for(const button of document.querySelectorAll('[data-speed]'))button.setAttribute('aria-pressed',String(Number(button.dataset.speed)===settings.speed));
      for(const input of document.querySelectorAll('[data-picture]')){input.value=String(settings[input.dataset.picture]);input.disabled=!pictureSupported();$(`${input.dataset.picture}-output`).textContent=String(settings[input.dataset.picture]);}
      $('reset-picture').disabled=!pictureSupported();
      $('sr-help').textContent=srSupported()?'GPU 增强处理；最佳质量需要更多算力。超分输出不会改变原始片源的分辨率。':'兼容播放不支持 GPU 超分输出，已使用自动画质；可重新解析重试。';
      $('sr-current').textContent=!srSupported()?'原始':settings.outputResolution==='auto'?'自动':settings.outputResolution==='2160p'?'4K 目标':settings.outputResolution==='1440p'?'2K 目标':'1080p 目标';
      renderQuality();
      $('speed-current').textContent=`${settings.speed}×`;
      $('sr-toggle').title=srSupported()?`超分输出 · ${$('sr-current').textContent}`:'当前模式不支持 GPU 超分输出';
      $('fullscreen').setAttribute('aria-pressed',String(!!current?.fullscreen));
    }
    function renderQuality(){
      const width=Math.round(finite(playback.videoWidth)),height=Math.round(finite(playback.videoHeight));
      $('source-quality').textContent=width>0&&height>0?`片源解码 ${width} × ${height} · 原始像素`:'片源分辨率等待解码';
      const target=model.OUTPUT_MODES.find(mode=>mode.value===settings.outputResolution);
      $('output-help').textContent=srSupported()&&target?.width?`GPU 输出目标框 ${target.width} × ${target.height}，保持原比例。最终显示受窗口和屏幕限制，非原生片源升级。`:'自动适应当前画面；片源分辨率与屏幕实际显示分别计算。';
    }
    function renderEpisodes(){
      const episodes=Array.isArray(current?.episodes)?current.episodes:[],selected=finite(current?.episodeIndex,0);
      const signature=JSON.stringify([episodes.map((episode,index)=>[episode.index??index,episode.name||episode.title||'']),selected]);
      if(signature!==episodeSignature){
        episodeSignature=signature;
        if(episodes.length)$('episode-list').replaceChildren(...episodes.map((episode,index)=>{const button=document.createElement('button');const key=Number.isInteger(episode.index)?episode.index:index;button.dataset.episode=String(key);button.textContent=episode.name||episode.title||`第 ${index+1} 集`;button.title=button.textContent;button.setAttribute('aria-current',String(key===selected));return button;}));
        else{const empty=document.createElement('p');empty.className='episode-empty';empty.textContent='当前来源未提供其他集数，可返回详情重新选择。';$('episode-list').replaceChildren(empty);}
      }
      const order=episodes.map((episode,index)=>Number.isInteger(episode.index)?episode.index:index),at=order.indexOf(selected);
      $('next-episode').disabled=current?.phase!=='ready'||at<0||at>=order.length-1;
      $('next-episode').dataset.index=at>=0&&at<order.length-1?String(order[at+1]):'';
    }
    function renderFrame(){
      const ready=current?.phase==='ready',duration=Math.max(0,finite(playback.duration)),position=previewPosition==null?Math.max(0,finite(playback.position)):previewPosition;
      $('current-time').textContent=model.time(position);$('duration-time').textContent=model.time(duration);
      $('play-pause').disabled=!ready;$('play-pause').setAttribute('aria-label',playback.paused?'播放':'暂停');
      $('play-pause-path').setAttribute('d',playback.paused?'M7 4 22 12 7 20Z':'M7 4h3v16H7ZM14 4h3v16h-3Z');
      $('seek').disabled=!ready||duration<=0;$('seek').max=String(duration||1);
      if(!seeking)$('seek').value=String(Math.min(duration||1,position));
      $('seek').style.setProperty('--seek-progress',`${duration?Math.min(100,Math.max(0,position/duration*100)):0}%`);
      if(document.activeElement!==$('volume'))$('volume').value=String(settings.volume);
      $('mute').setAttribute('aria-label',settings.mute?'取消静音':'静音');$('mute').setAttribute('aria-pressed',String(settings.mute));
      renderQuality();
      $('volume-wave').setAttribute('d',settings.mute||settings.volume===0?'m15 9 6 6m0-6-6 6':'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14');

    }
    function applyFrame(value){
      if(disposed||!value||typeof value!=='object')return;
      for(const key of ['position','duration','volume','speed','videoWidth','videoHeight'])if(Number.isFinite(Number(value[key])))playback[key]=Math.max(0,Number(value[key]));
      if(Number.isFinite(Number(value.width)))playback.videoWidth=Number(value.width);if(Number.isFinite(Number(value.height)))playback.videoHeight=Number(value.height);
      for(const key of ['paused','mute','buffering','ended'])if(typeof value[key]==='boolean')playback[key]=value[key];
      settings=model.normalize({volume:playback.volume,mute:playback.mute,speed:playback.speed},settings);
      $('speed-current').textContent=`${settings.speed}×`;renderFrame();
    }
    function fail(value){chrome.setReady(false);$('notice').hidden=false;$('notice-text').textContent=value;document.body.dataset.phase='error';message(value,true);scheduleViewport();}
    function startHTML(){video.play().catch(()=>{$('resume-play').hidden=false;});}
    function applyState(value){
      if(disposed||!value)return;
      const oldId=current?.playbackId,wasNative=native;current=value;native=value.engine==='native';
      chrome.setReady(value.phase==='ready');if(oldId!==value.playbackId)chrome.activity();
      document.body.dataset.engine=native?'native':'html5';document.body.dataset.phase=value.phase||'resolving';
      if(value.theme)themes?.apply?.(document.documentElement,value.theme);
      const episodeName=value.episode?.name||value.episode?.title||'';
      $('play-title').textContent=`${value.subject?.title||'番剧播放'}${episodeName?` [${episodeName}]`:''}`;$('source-name').textContent=value.ruleName||'';
      settings=model.normalize(value.settings||{},settings);
      if(typeof value.muted==='boolean')settings.mute=value.muted;
      statusError=false;renderSettings();renderEpisodes();
      if(oldId!==value.playbackId){playback={position:0,duration:0,paused:true,volume:settings.volume,mute:settings.mute,speed:settings.speed};previewPosition=null;seeking=false;}
      if(value.phase==='error'){releaseHTML();fail(value.error||'当前视频无法播放，请重新解析或切换来源。');renderFrame();return;}
      if(value.phase!=='ready'){
        releaseHTML();$('notice').hidden=false;$('notice-text').textContent='正在从所选规则的页面识别视频…';renderFrame();scheduleViewport();return;
      }
      if(native){
        if(!wasNative||oldId!==value.playbackId)releaseHTML();
        activePlaybackId=value.playbackId;$('notice').hidden=true;$('resume-play').hidden=true;
        if(value.video)applyFrame(value.video);else renderFrame();
        resize();return;
      }
      if(value.media&&source!==value.media.url){
        releaseHTML();source=value.media.url;activePlaybackId=value.playbackId;video.muted=settings.mute;video.volume=settings.volume/100;video.playbackRate=settings.speed;
        $('notice').hidden=false;$('notice-text').textContent='正在加载视频…';
        if(value.media.format==='hls'&&Hls?.isSupported()){
          hls=new Hls({enableWorker:true,backBufferLength:30,maxBufferLength:30,maxMaxBufferLength:60});hls.loadSource(source);hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED,startHTML);hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)fail('视频暂时无法播放，请重新解析或切换来源。');});
        }else{video.src=source;startHTML();}
      }
      renderFrame();resize();
    }
    async function control(type,value){
      if(disposed||!CONTROLS.has(type))return;
      if(['togglePause','seek','episode'].includes(type)&&current?.phase!=='ready')return;
      if(['superResolution','outputResolution'].includes(type)&&!srSupported())return;
      if(['brightness','contrast','saturation','gamma'].includes(type)&&!pictureSupported())return;
      if(['superResolution','outputResolution','aspect','speed','volume','mute','brightness','contrast','saturation','gamma'].includes(type))settings=model.normalize({[type]:value},settings);
      if(type==='togglePause')playback.paused=!playback.paused;
      renderSettings();renderFrame();
      if(native||['fullscreen','exitFullscreen','episode'].includes(type)){await action('control',{type,value});return;}
      if(type==='togglePause'){if(video.paused)startHTML();else video.pause();}
      else if(type==='seek'&&Number.isFinite(Number(value)))video.currentTime=Math.max(0,Math.min(video.duration||Number(value),Number(value)));
      else if(type==='volume')video.volume=settings.volume/100;
      else if(type==='mute')video.muted=settings.mute;
      else if(type==='speed')video.playbackRate=settings.speed;
      else if(type==='aspect')htmlAspect();
    }
    on($('close'),'click',()=>{progress(true);action('close');});
    on($('play-pause'),'click',()=>control('togglePause'));
    on($('next-episode'),'click',()=>{const index=Number($('next-episode').dataset.index);if(Number.isInteger(index))control('episode',index);});
    on($('mute'),'click',()=>control('mute',!settings.mute));
    on($('volume'),'input',event=>{settings=model.normalize({volume:Number(event.target.value)},settings);});
    on($('volume'),'change',event=>control('volume',Number(event.target.value)));
    on($('seek'),'pointerdown',event=>{seeking=true;chrome.hold('seek',true);if(Number.isInteger(event.pointerId))$('seek').setPointerCapture?.(event.pointerId);});
    on($('seek'),'input',event=>{seeking=true;previewPosition=Number(event.target.value);$('seek-preview').hidden=false;$('seek-preview').textContent=model.time(previewPosition);renderFrame();});
    on($('seek'),'change',event=>{const value=Number(event.target.value);seeking=false;chrome.hold('seek',false);previewPosition=null;$('seek-preview').hidden=true;playback.position=value;control('seek',value);});
    on($('seek'),'pointercancel',()=>{seeking=false;chrome.hold('seek',false);previewPosition=null;$('seek-preview').hidden=true;renderFrame();});
    on($('picture-toggle'),'click',()=>showPanel('picture'));
    on($('sr-toggle'),'click',()=>showPanel('picture','sr-options'));
    on($('speed-toggle'),'click',()=>showPanel('picture','speed-options'));
    on($('episodes-toggle'),'click',()=>showPanel('episodes'));
    on($('panel-close'),'click',()=>{showPanel(null);$('picture-toggle').focus();});
    on($('player-panel'),'click',event=>{
      const output=event.target.closest('[data-output]');if(output&&!output.disabled){control('outputResolution',output.dataset.output);return;}
      const sr=event.target.closest('[data-sr]');if(sr&&!sr.disabled){control('superResolution',sr.dataset.sr);return;}
      const aspect=event.target.closest('[data-aspect]');if(aspect){control('aspect',aspect.dataset.aspect);return;}
      const speed=event.target.closest('[data-speed]');if(speed){control('speed',Number(speed.dataset.speed));return;}
      const episode=event.target.closest('[data-episode]');if(episode){control('episode',Number(episode.dataset.episode));return;}
    });
    for(const input of document.querySelectorAll('[data-picture]')){
      on(input,'input',()=>{$(`${input.dataset.picture}-output`).textContent=input.value;});
      on(input,'change',()=>control(input.dataset.picture,Number(input.value)));
    }
    on($('reset-picture'),'click',async()=>{for(const type of ['brightness','contrast','saturation','gamma'])await control(type,0);});
    on($('fullscreen'),'click',()=>control('fullscreen'));
    on($('retry'),'click',()=>{progress(true);action('retry');});
    on($('source'),'click',()=>action('source'));
    on($('resume-play'),'click',startHTML);
    on(stage,'dblclick',event=>{if(!event.target.closest('button'))control('fullscreen');});
    on(video,'loadedmetadata',()=>{if(current?.resume>1&&current.resume<video.duration-10)video.currentTime=current.resume;htmlAspect();applyFrame({duration:video.duration,videoWidth:video.videoWidth,videoHeight:video.videoHeight});});
    on(video,'playing',()=>{if(native)return;$('notice').hidden=true;$('resume-play').hidden=true;statusError=false;applyFrame({paused:false,buffering:false});progress();});
    on(video,'pause',()=>{if(!native){applyFrame({paused:true});progress(true);}});
    on(video,'waiting',()=>{if(!native)applyFrame({buffering:true});});
    on(video,'ended',()=>{if(!native){applyFrame({ended:true,paused:true});progress(true);}});
    on(video,'timeupdate',()=>{if(native)return;applyFrame({position:video.currentTime,duration:video.duration});if(Date.now()-lastProgress>5000){lastProgress=Date.now();progress();}});
    on(video,'volumechange',()=>{if(!native)applyFrame({volume:video.volume*100,mute:video.muted});});
    on(video,'ratechange',()=>{if(!native)applyFrame({speed:video.playbackRate});});
    on(video,'error',()=>{if(source&&!native)fail('当前视频格式或来源不可用，请切换线路。');});
    on(document,'keydown',event=>{
      chrome.activity();
      const key=event.key.toLowerCase();
      if(key==='escape'&&!event.repeat){
        if(current?.fullscreen){event.preventDefault();control('exitFullscreen');return;}
        if(panel){event.preventDefault();showPanel(null);}return;
      }
      if(event.altKey||event.ctrlKey||event.metaKey||event.repeat||/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target?.tagName)||event.target?.isContentEditable)return;
      if([' ','k','arrowright','arrowleft','arrowup','arrowdown','m','f'].includes(key))event.preventDefault();else return;
      if(key===' '||key==='k')control('togglePause');else if(key==='m')control('mute',!settings.mute);else if(key==='f')control('fullscreen');
      else if(key==='arrowright'||key==='arrowleft')control('seek',Math.max(0,Math.min(playback.duration||Infinity,playback.position+(key==='arrowright'?5:-5))));
      else control('volume',Math.max(0,Math.min(100,settings.volume+(key==='arrowup'?5:-5))));
    });
    on(document,'pointermove',event=>{const box=stage.getBoundingClientRect();chrome.pointer({insideApp:true,insideVideo:event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom,x:event.clientX,y:event.clientY,changed:true});});
    on(document,'pointerdown',()=>{chrome.hold('pointer',true);});
    on(document,'pointerup',()=>{chrome.hold('pointer',false);if(seeking){seeking=false;chrome.hold('seek',false);}});
    on(document,'pointercancel',()=>{chrome.hold('pointer',false);chrome.hold('seek',false);});
    // A pointer released outside a focused Chromium view must not leave a hold
    // behind. Native pointer observations remain the authority for app bounds.
    on(view,'blur',()=>{chrome.hold('pointer',false);if(seeking){seeking=false;previewPosition=null;chrome.hold('seek',false);$('seek-preview').hidden=true;renderFrame();}});
    on(document,'pointerleave',()=>{if(!native)chrome.pointer({insideApp:false,insideVideo:false});});
    on(view,'resize',resize);on(document,'visibilitychange',scheduleViewport);
    const observer=typeof view.ResizeObserver==='function'?new view.ResizeObserver(resize):null;observer?.observe(stage);
    const subscribe=(name,callback)=>{if(typeof bridge[name]==='function'){const unsubscribe=bridge[name](callback);if(typeof unsubscribe==='function')unsubscribers.push(unsubscribe);}};
    subscribe('onState',applyState);subscribe('onFrame',applyFrame);subscribe('onPointer',value=>chrome.pointer(value));
    if(typeof bridge.get==='function')Promise.resolve(bridge.get()).then(applyState).catch(error=>message(error?.message||'播放连接尚未就绪',true));
    function dispose(){
      if(disposed)return;progress(true);disposed=true;chrome.dispose();if(chromeExitTimer!==null)view.clearTimeout(chromeExitTimer);chromeExitTimer=null;cancelFrame(viewportFrame);viewportFrame=0;if(viewportTimer!==null)view.clearTimeout(viewportTimer);viewportTimer=null;observer?.disconnect();listeners.splice(0).forEach(remove=>remove());unsubscribers.splice(0).forEach(unsubscribe=>unsubscribe());releaseHTML();
    }
    on(view,'pagehide',dispose,{once:true});
    renderSettings();renderFrame();scheduleViewport();
    return {applyState,applyFrame,control,dispose,getState:()=>({engine:native?'native':'html5',settings:{...settings},video:{...playback},panel,chrome:chrome.getState(),disposed})};
  }
  return {create};
});
