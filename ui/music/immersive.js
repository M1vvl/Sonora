(function(host,factory){'use strict';const value=factory(typeof module==='object'&&module.exports?require('./visual-settings.js'):host.PulseMusicVisualSettings,typeof module==='object'&&module.exports?require('./visual-renderer.js'):host.PulseMusicVisualRenderer,typeof module==='object'&&module.exports?require('./immersive-transport.js'):host.PulseMusicImmersiveTransport);if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicImmersive=value;})(typeof window==='object'?window:globalThis,function(model,rendererModule,transportModule){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  const icons={home:'<path d="m3 11 9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5"/><circle cx="15" cy="17" r="2.5"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'};
  const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const fields=model.FIELDS;
  function create({root,player,lyrics,api,accountRoot,library,imageURL=value=>value,onNotice=()=>{},onVisibilityChange=()=>{}}={}){
    const document=root.ownerDocument,view=document.defaultView,host=document.createElement('section');host.className='music-immersive';host.hidden=true;host.setAttribute('data-no-window-drag','');host.setAttribute('aria-label','沉浸歌词');host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');
    host.innerHTML=`<canvas class="music-visual-canvas" aria-hidden="true"></canvas><header class="music-immersive-header"><button type="button" class="music-immersive-home" aria-label="返回音乐主页">${icon('home')}</button><div class="music-immersive-account"></div></header><div class="music-immersive-lyrics"></div><div class="music-immersive-player"></div><button type="button" class="music-visual-trigger" aria-label="打开视觉控制台" hidden>${icon('settings')}</button><aside class="music-visual-panel" aria-label="视觉控制台" hidden><header><div><strong>视觉控制台</strong><small>调整即时预览 · 点击保存后保留</small></div><span class="music-visual-save-status" role="status"></span><button type="button" class="music-visual-save" data-visual-action="save">保存</button><button type="button" data-visual-action="close" aria-label="关闭视觉控制台">${icon('close')}</button></header><div class="music-visual-tools"><input type="search" placeholder="搜索：封面、歌词、动效…" aria-label="搜索视觉设置"></div><nav class="music-visual-tabs">${Object.entries({common:'常用',lyrics:'歌词',motion:'动效',library:'歌单架',system:'系统'}).map(([key,label])=>`<button type="button" data-visual-tab="${key}">${label}</button>`).join('')}</nav><div class="music-visual-content"></div></aside>`;
    document.body.append(host);const $=selector=>host.querySelector(selector),panel=$('.music-visual-panel'),content=$('.music-visual-content'),canvas=$('canvas'),lineRoot=$('.music-immersive-lyrics'),listeners=[];
    let active=false,opened=false,disposed=false,diy=false,tab='common',settings=model.normalize(),loaded=false,loadJob=null,saveTimer=null,hideTimer=null,animation=null,revision=0,originalFocus=null,portals=[],lastCover='',memoryState=null,memoryLoading=false,editRevision=0,dirty=false,saveJob=Promise.resolve(),accountOpen=false,orbitPan=null,orbitYaw=0,orbitPitch=0,ownFullscreen=false;
    const memoryQueue=new Map();
    const visual=rendererModule.create({canvas,audio:player.getAudio(),onNotice,onLyricsState:value=>{lineRoot.hidden=value;if(value)immersiveLyrics?.deactivate();else if(opened&&!accountOpen)immersiveLyrics?.activate();}});

    const immersiveLyrics=lyrics.createView?.(lineRoot,{immersive:true,getSettings:()=>settings});
    let fullscreenBusy=false;
    function fullscreenState(value){ownFullscreen=value===true;transport?.setFullscreen?.(ownFullscreen);}
    async function exitFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();await view.pulse?.windowAction?.('exit-fullscreen');fullscreenState(false);}catch(error){onNotice(error.message||'退出全屏失败，请重试');}}
    const transport=transportModule?.create({player,getGlass:()=>settings.transportGlass,onGlass:value=>setSettings({transportGlass:value}),onLyrics:()=>setSettings({lyricMode:settings.lyricMode==='off'?'immersive':'off'}),onReset:()=>{orbitYaw=orbitPitch=0;visual.resetOrbit?.();},onFullscreen:async()=>{if(fullscreenBusy)return;fullscreenBusy=true;try{if(ownFullscreen||document.fullscreenElement){await exitFullscreen();return;}const value=await view.pulse?.windowAction?.('fullscreen');if(!opened||disposed){if(value?.fullscreen===true)await view.pulse?.windowAction?.('exit-fullscreen');return;}fullscreenState(value?.fullscreen===true);}catch(error){if(opened)onNotice(error.message||'全屏切换失败');}finally{fullscreenBusy=false;}}});
    const unlibrary=library?.subscribe?.(value=>{host.dataset.shelfOpen=String(opened&&value.open&&value.mode==='stage'&&value.presentation==='stage');visual.setShelf?.({open:opened&&value.open&&value.presentation==='stage',detail:!!value.detail&&value.presentation==='stage'});});
    const on=(target,name,fn)=>{target.addEventListener(name,fn);listeners.push(()=>target.removeEventListener(name,fn));};
    const escapeFullscreen=event=>{if(opened&&event.key==='Escape'&&(ownFullscreen||document.fullscreenElement)){event.preventDefault();event.stopImmediatePropagation();exitFullscreen();}};
    document.addEventListener('keydown',escapeFullscreen,true);listeners.push(()=>document.removeEventListener('keydown',escapeFullscreen,true));
    const unfullscreen=view.pulse?.onDashboardFullscreen?.(value=>{if(disposed)return;fullscreenState(opened&&value?.fullscreen===true);});if(unfullscreen)listeners.push(unfullscreen);
    const reduced=()=>view.matchMedia?.('(prefers-reduced-motion:reduce)').matches===true;
    async function request(payload){const result=await api('visualSettings',payload||{});if(result?.error)throw new Error(result.error);return result?.settings;}
    let savedSettings=model.normalize(),memoryDraft={},pendingPreview={},saving=false;
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    function status(text,{temporary=false}={}){
      if(saveTimer!==null)view.clearTimeout(saveTimer);
      saveTimer=null;
      if(disposed)return;
      $('.music-visual-save-status').textContent=text;
      if(temporary)saveTimer=view.setTimeout(()=>{
        saveTimer=null;
        if(!disposed&&!dirty&&!saving)$('.music-visual-save-status').textContent='';
      },2200);
    }
    function markDirty(){dirty=true;status('待保存');}
    // Only the explicit Save action can call either persistence endpoint.
    // A preview, page close, navigation or dispose never commits a draft.
    function flushSave(){
      if(disposed)return Promise.resolve();
      if(saving)return saveJob;
      saving=true;status('保存中…');$('.music-visual-save').disabled=true;
      saveJob=(async()=>{
        await load();
        if(disposed)return;
        if(!loaded)throw new Error('视觉设置未能读取，请重新打开控制台后保存');
        const snapshot={...settings},memoryPatch={...memoryDraft};
        const result=await request({settings:snapshot});
        savedSettings=model.normalize(result||snapshot);
        if(Object.keys(memoryPatch).length){
          const value=await api('memoryPreferences',{preferences:memoryPatch});
          if(value?.error)throw new Error(value.error);
          memoryState=value;
          for(const key of Object.keys(memoryPatch))if(memoryDraft[key]===memoryPatch[key])delete memoryDraft[key];
        }
        if(disposed)return;
        if(!opened)settings={...savedSettings};
        dirty=!same(settings,savedSettings)||Object.keys(memoryDraft).length>0;
        status(opened?(dirty?'待保存':'已保存'):'',{temporary:!dirty&&opened});
      })().catch(error=>{
        if(!disposed){dirty=true;status(opened?'保存失败':'');onNotice(error.message||'视觉设置保存失败，请重试');}
      }).finally(()=>{saving=false;if(!disposed)$('.music-visual-save').disabled=false;});
      return saveJob;
    }
    function discardPreview(){
      ++editRevision;settings={...savedSettings};memoryDraft={};pendingPreview={};dirty=false;status('');
    }
    function setSettings(value) {
      editRevision++;
      if(!loaded)Object.assign(pendingPreview,value);
      settings=model.normalize({...settings,...value});
      apply();
      markDirty();
    }
    function coverURL(){const song=player.getSong();if(!song?.coverURL)return '';try{const url=new URL(song.coverURL);url.searchParams.set('param',settings.coverResolution+'y'+settings.coverResolution);return imageURL(url.href);}catch{return imageURL(song.coverURL);}}
    function updateCover() {
      if(!opened)return;
      const cover=coverURL();
      if(cover!==lastCover){lastCover=cover;visual.setCover(cover);}
    }
    function renderLyrics(){
      for(const[key,mode,property]of [['lyricColor','lyricColorMode','--lyric-user-base'],['lyricHighlightColor','lyricHighlightMode','--lyric-user-highlight']]){
        if(settings[mode]==='custom')lineRoot.style.setProperty(property,settings[key]);else lineRoot.style.removeProperty(property);
      }
      immersiveLyrics?.updateSettings();
    }

    function effectiveAccent(){const theme=view.getComputedStyle(root).getPropertyValue('--accent-text').trim();return /^#[0-9a-f]{6}$/i.test(theme)?theme:'#a6dfef';}
    function apply(){const accent=effectiveAccent();host.style.setProperty('--visual-accent',accent);host.style.setProperty('--visual-text','#ffffff');host.style.setProperty('--visual-glass',String(settings.transportGlass));lineRoot.style.setProperty('--lyric-size',settings.fontSize+'px');lineRoot.style.setProperty('--lyric-weight',String(settings.fontWeight));lineRoot.style.setProperty('--lyric-translation-size',settings.translationSize+'em');lineRoot.style.setProperty('--lyric-translation-gap',settings.translationGap+'em');lineRoot.style.setProperty('--lyric-translation-opacity',String(settings.translationOpacity));lineRoot.style.left=settings.lyricX+'%';lineRoot.style.top=settings.lyricY+'%';lineRoot.style.transform=`translate(-50%,-50%) scale(${settings.lyricScale||1}) rotate(${settings.lyricRotation}deg) rotateX(var(--lyric-tilt-x,0deg)) rotateY(var(--lyric-tilt-y,0deg))`;lineRoot.style.textShadow=`0 2px ${12*settings.lyricShadow}px ${accent}80`;lineRoot.style.fontFamily={system:'system-ui,sans-serif',serif:'Georgia,"Noto Serif SC",serif',rounded:'"Arial Rounded MT Bold",system-ui,sans-serif',mono:'ui-monospace,monospace'}[settings.fontFamily];host.dataset.lyricMode=settings.lyricMode;host.dataset.lyricMotion=String(settings.lyricMotion);host.setAttribute('data-lyric-3d',String(settings.lyric3D));lineRoot.style.setProperty('--lyric-depth',settings.lyricDepth+'px');visual.update({...settings,accent});updateCover();renderLyrics();
      const libraryRoot=library?.getRoot();if(libraryRoot&&opened){libraryRoot.style.setProperty('--visual-library-width',settings.libraryWidth+'px');libraryRoot.style.setProperty('--visual-library-radius',settings.libraryRadius+'px');libraryRoot.style.setProperty('--visual-library-opacity',String(settings.libraryOpacity));libraryRoot.dataset.visualDynamic=String(settings.libraryDynamic);library?.configure({mode:settings.libraryMode==='off'?'off':'stage',autoHide:false,edgeEnabled:false,appearance:settings});}
    }
    async function load(){if(loaded||disposed)return;if(loadJob)return loadJob;loadJob=request().then(value=>{if(disposed)return;loaded=true;savedSettings=model.normalize(value);settings=model.normalize({...savedSettings,...(opened?pendingPreview:{})});pendingPreview={};apply();}).catch(error=>onNotice(error.message||'视觉偏好暂时无法读取')).finally(()=>{loadJob=null;});return loadJob;}
    function fieldHTML(field){const[group,key,label,type,minmax,step]=field;let input;if(type==='toggle')input=`<input type="checkbox" data-visual-key="${key}" ${settings[key]?'checked':''}>`;else if(type==='color')input=`<input type="color" data-visual-key="${key}" value="${key==='accent'?effectiveAccent():settings[key]}">`;else if(typeof type==='object')input=`<select data-visual-key="${key}">${Object.entries(type).map(([value,title])=>`<option value="${value}" ${settings[key]===value?'selected':''}>${title}</option>`).join('')}</select>`;else input=`<input type="range" data-visual-key="${key}" min="${type}" max="${minmax}" step="${step}" value="${settings[key]}"><output>${settings[key]}</output>`;return `<label class="music-visual-field" data-visual-search="${esc(group+' '+label+' '+key)}"><span>${label}</span>${input}<button type="button" class="music-visual-reset" data-visual-reset="${key}" aria-label="重置${label}">↺</button></label>`;}
    function memoryHTML() {
      const preference={...memoryState?.preferences,...memoryDraft};
      const size=value=>Number.isFinite(value)?Math.round(value/1048576)+' MiB':'—';
      return `<section class="music-visual-group"><h3>内存管理</h3><p>系统 ${memoryState?Math.round(memoryState.system?.usedPercent||0)+'%':'—'} · 可用 ${size(memoryState?.system?.freeBytes)}<br>软件工作集 ${size(memoryState?.app?.workingSetBytes)}</p><button type="button" data-visual-action="memory-refresh">刷新</button><button type="button" data-visual-action="memory-trim" ${memoryState?.capabilities?.appTrim?'':'disabled'}>回收软件工作集</button>${[['autoTrim','自动回收软件'],['backgroundTrim','转到后台时回收']].map(([key,label])=>`<label class="music-visual-field"><span>${label}</span><input type="checkbox" data-memory-key="${key}" ${preference[key]?'checked':''}></label>`).join('')}<label class="music-visual-field"><span>检查间隔（分钟）</span><input type="range" data-memory-key="intervalMinutes" min="5" max="180" step="5" value="${preference.intervalMinutes||30}"><output>${preference.intervalMinutes||30}</output></label><label class="music-visual-field"><span>占用阈值</span><input type="range" data-memory-key="thresholdPercent" min="50" max="98" step="1" value="${preference.thresholdPercent||78}"><output>${preference.thresholdPercent||78}</output></label></section>`;
    }
    async function updateMemory(action='memoryStatus',payload={}) {
      if(disposed)return;
      if(memoryLoading){
        if(action!=='memoryStatus')memoryQueue.set(action,{...payload,preferences:{...memoryQueue.get(action)?.preferences,...payload.preferences}});
        return;
      }
      memoryLoading=true;
      try {
        const result=await api(action,payload);
        if(result?.error)throw new Error(result.error);
        if(disposed)return;
        memoryState=result;
        if(tab==='system'&&!panel.hidden)renderPanel();
      }catch(error){onNotice(error.message||'内存状态暂不可用');}
      finally{
        memoryLoading=false;
        const next=memoryQueue.entries().next().value;
        if(next){memoryQueue.delete(next[0]);updateMemory(...next);}
      }
    }
    function renderPanel() {
      const search=$('.music-visual-tools input').value.trim().toLowerCase();
      for(const button of host.querySelectorAll('[data-visual-tab]'))button.setAttribute('aria-selected',String(button.dataset.visualTab===tab));
      const groups=new Map();
      const list=search?Object.values(fields).flat():fields[tab]||[];
      for(const field of list) {
        if(search&&!String(field.slice(0,3).join(' ')).toLowerCase().includes(search))continue;
        if(!groups.has(field[0]))groups.set(field[0],[]);
        groups.get(field[0]).push(field);
      }
      let html=tab==='common'&&!search?`<section class="music-visual-group"><h3 class="music-visual-preset-heading"><span>视觉预设</span><input type="checkbox" role="switch" aria-label="开启视觉预设" data-visual-key="visualEnabled" ${settings.visualEnabled?'checked':''}></h3><div class="music-visual-presets"><button type="button" data-visual-preset="cover" aria-pressed="true"><i data-preset-art="cover"></i><strong>Emily 专辑封面</strong></button></div></section>`:'';
      for(const[group,list]of groups)html+=`<section class="music-visual-group"><h3>${esc(group)}</h3>${list.map(fieldHTML).join('')}</section>`;
      if(tab==='system'&&!search)html+=memoryHTML();
      content.innerHTML=html||'<p class="music-visual-note">没有匹配设置。</p>';
      const presetGrid=content.querySelector('.music-visual-presets');
      if(presetGrid){
        presetGrid.querySelector('[data-visual-preset="cover"]').setAttribute('aria-pressed',String(settings.preset==='cover'));
        const sonic=document.createElement('button');sonic.type='button';sonic.dataset.visualPreset='topography';sonic.setAttribute('aria-pressed',String(settings.preset==='topography'));sonic.innerHTML='<i data-preset-art="topography"></i><strong>音域回响 · 原版</strong>';presetGrid.append(sonic);
      }
      for (const art of content.querySelectorAll('[data-preset-art]')) {
        const url = visual.getPresetPreview?.(art.dataset.presetArt);
        if (url) art.style.backgroundImage = 'url("' + url + '")';
      }
    }
    function showPanel(){if(!opened||!diy||accountOpen)return;library?.close();panel.hidden=false;renderPanel();$('.music-visual-tools input').focus();}function closePanel(){panel.hidden=true;if(hideTimer!==null)view.clearTimeout(hideTimer);hideTimer=null;}
    function portal(node,target){if(!node)return;const marker=document.createComment('music-immersive-portal');node.before(marker);portals.push({node,marker});target.append(node);}
    function restore(){transport?.deactivate();for(const {node,marker}of portals.reverse()){if(marker.parentNode)marker.replaceWith(node);}portals=[];lyrics.setObscured?.(false);onVisibilityChange(false);root.closest('.app-shell')?.removeAttribute('inert');root.inert=false;library?.configure({mode:'sidebar',autoHide:true,edgeEnabled:true});const libraryRoot=library?.getRoot();if(libraryRoot){for(const key of ['--visual-library-width','--visual-library-radius','--visual-library-opacity'])libraryRoot.style.removeProperty(key);delete libraryRoot.dataset.visualDynamic;}player.getRoot().querySelector('.music-immersive-diy')?.remove();}
    function move(target){const from=view.getComputedStyle(host).transform;animation?.cancel();if(reduced()||typeof host.animate!=='function'){host.style.transform=target;return Promise.resolve();}animation=host.animate([{transform:from==='none'?'translateY(0)':from},{transform:target}],{duration:360,easing:'cubic-bezier(.2,.75,.2,1)',fill:'forwards'});return animation.finished.catch(()=>{});}
    async function open(){if(disposed||!active||opened)return;const ticket=++revision;opened=true;visual.setLyrics?.(lyrics.getLines(),lyrics.getSong?.()||player.getSong());visual.setLyricPosition?.(lyrics.getState().position);accountOpen=false;host.dataset.accountOpen='false';host.dataset.shelfOpen='false';immersiveLyrics?.activate();lyrics.setObscured?.(true);onVisibilityChange(true);originalFocus=document.activeElement;const wasHidden=host.hidden;host.hidden=false;if(wasHidden)host.style.transform='translateY(100%)';if(!portals.length){portal(player.getRoot(),$('.music-immersive-player'));portal(accountRoot,$('.music-immersive-account'));portal(library?.getRoot(),host);}root.closest('.app-shell')?.setAttribute('inert','');root.inert=true;
      host.querySelector('.music-immersive-diy')?.remove();const diyButton=document.createElement('button');diyButton.type='button';diyButton.className='music-icon-button music-immersive-diy';diyButton.textContent='DIY';diyButton.setAttribute('aria-label','切换视觉 DIY');diyButton.setAttribute('aria-pressed',String(diy));player.getRoot().querySelector('.music-transport')?.append(diyButton);diyButton.addEventListener('click',()=>{diy=!diy;diyButton.setAttribute('aria-pressed',String(diy));$('.music-visual-trigger').hidden=!diy;if(!diy)closePanel();});$('.music-visual-trigger').hidden=!diy;library?.close();library?.configure({mode:'stage',autoHide:false,edgeEnabled:false});transport?.activate();apply();visual.activate();load();move('translateY(0)').then(()=>{if(opened&&ticket===revision)$('.music-immersive-home').focus();});}
    async function close({immediate=false}={}){if(!opened){if(immediate&&portals.length){++revision;animation?.cancel();animation=null;host.hidden=true;host.style.transform='translateY(100%)';restore();originalFocus?.focus?.();originalFocus=null;}return;}const ticket=++revision;opened=false;if(ownFullscreen){fullscreenState(false);exitFullscreen();}immersiveLyrics?.deactivate();orbitPan=null;discardPreview();closePanel();visual.deactivate();library?.close({immediate});if(!immediate)await move('translateY(100%)');else animation?.cancel();if(disposed||ticket!==revision)return;host.hidden=true;host.style.transform='translateY(100%)';restore();originalFocus?.focus?.();originalFocus=null;}
    on(root,'pulse:music-lyrics-open',open);on($('.music-immersive-home'),'click',()=>close());on($('.music-visual-trigger'),'click',()=>panel.hidden?showPanel():closePanel());on(host,'pointermove',event=>{if(accountOpen||orbitPan)return;const x=event.clientX/view.innerWidth*2-1,y=event.clientY/view.innerHeight*2-1;visual.setPointer(x,y);if(settings.lyric3D&&!reduced()){lineRoot.style.setProperty('--lyric-tilt-x',(-y*2).toFixed(2)+'deg');lineRoot.style.setProperty('--lyric-tilt-y',(x*2).toFixed(2)+'deg');}});on(host,'contextmenu',event=>{if(!opened||accountOpen||event.target.closest('dialog,.music-visual-panel,input,textarea,select'))return;event.preventDefault();if(settings.libraryMode==='off')return;closePanel();if(library?.getState().open)library.close({restore:true});else{library?.configure({mode:'stage',autoHide:false,edgeEnabled:false});library?.open('playlists',{keyboard:true});}});
    on(host,'pointerleave',()=>visual.setPointer(NaN,NaN));
    on(host,'pointerdown',event=>{if(!opened||accountOpen||event.button!==0||event.target.closest('button,a,input,select,textarea,dialog,.music-library,.music-player-root,.music-visual-panel,.music-immersive-header'))return;orbitPan={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:orbitYaw,pitch:orbitPitch,moved:false,started:view.performance.now()};});
    on(host,'pointermove',event=>{if(!orbitPan||orbitPan.id!==event.pointerId)return;const dx=event.clientX-orbitPan.x,dy=event.clientY-orbitPan.y;if(!orbitPan.moved&&Math.hypot(dx,dy)<4)return;orbitPan.moved=true;event.preventDefault();try{host.setPointerCapture(event.pointerId);}catch{}orbitYaw=orbitPan.yaw-dx*.006;orbitPitch=Math.max(-Math.PI*.45,Math.min(Math.PI*.45,orbitPan.pitch+dy*.006));visual.setOrbit?.(orbitYaw,orbitPitch,true);});
    const endOrbit = event => {
      if (!orbitPan || orbitPan.id !== event.pointerId) return;
      if (!orbitPan.moved && event.type === 'pointerup') {
        const held = Math.max(0, view.performance.now() - orbitPan.started);
        visual.ripple?.(event.clientX / view.innerWidth * 2 - 1,
          event.clientY / view.innerHeight * 2 - 1, Math.min(.25 + held / 1000 * 2.6, 3));
      }
      orbitPan = null;
      visual.setOrbit?.(orbitYaw, orbitPitch, false);
      try {if (host.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId);} catch {}
    };
    on(host,'pointerup',endOrbit);on(host,'pointercancel',endOrbit);on(host,'lostpointercapture',()=>{orbitPan=null;visual.setOrbit?.(orbitYaw,orbitPitch,false);});
    on(panel,'pointerleave',()=>{if(!panel.contains(document.activeElement))hideTimer=view.setTimeout(closePanel,350);});on(panel,'pointerenter',()=>{if(hideTimer!==null)view.clearTimeout(hideTimer);hideTimer=null;});on($('.music-visual-tools input'),'input',()=>{renderPanel();});
    on(panel,'input',event=>{
      const element=event.target,key=element.dataset.visualKey;
      if(key) {
        const value=element.type==='checkbox'?element.checked:element.type==='range'?Number(element.value):element.value;
        const change={[key]:value};
        // Mirror MineRadio's 07-fx/03-cover-picker-fonts.js colour pickers.
        // Picking a colour also opts that channel out of automatic cover tone.
        if(key==='lyricColor')change.lyricColorMode='custom';
        if(key==='lyricHighlightColor')change.lyricHighlightMode='custom';
        if(key==='lyricGlowColor')change.lyricGlowLinked=false;
        setSettings(change);
        for(const linked of ['lyricColorMode','lyricHighlightMode','lyricGlowLinked']){
          const control=panel.querySelector(`[data-visual-key="${linked}"]`);
          if(!control)continue;
          if(control.type==='checkbox')control.checked=settings[linked];else control.value=settings[linked];
        }
        const output=element.parentNode.querySelector('output');
        if(output)output.textContent=String(settings[key]);
      } else if(element.dataset.memoryKey) {
        const value=element.type==='checkbox'?element.checked:Number(element.value);
        memoryDraft[element.dataset.memoryKey]=value;
        markDirty();
        const output=element.parentNode.querySelector('output');if(output)output.textContent=String(value);
      }
    });
    on(panel,'click',event=>{
      const button=event.target.closest('button');
      if(!button)return;
      const action=button.dataset.visualAction;
      if(button.dataset.visualTab) {
        tab=button.dataset.visualTab;
        renderPanel();
        if(tab==='system')updateMemory();
      } else if(button.dataset.visualPreset) {
        setSettings({preset:button.dataset.visualPreset,visualEnabled:true});
        renderPanel();
      } else if(button.dataset.visualReset) {
        setSettings({[button.dataset.visualReset]:model.DEFAULTS[button.dataset.visualReset]});
        renderPanel();
      } else if(action==='close')closePanel();
      else if(action==='save')flushSave().catch(error=>onNotice(error.message||'设置保存失败'));
      else if(action==='memory-refresh')updateMemory();
      else if(action==='memory-trim')updateMemory('memoryTrim');
    });
    on(document,'keydown',event=>{if(!opened||accountOpen||event.defaultPrevented)return;if(event.key==='Escape'){event.preventDefault();if(ownFullscreen){exitFullscreen();return;}if(library?.getState().open)library.close({restore:true});else panel.hidden?close():closePanel();}if(event.key==='Tab'){const buttons=Array.from(host.querySelectorAll('button,input,select,[tabindex="0"]')).filter(node=>!node.disabled&&!node.closest('[hidden],[inert]')&&view.getComputedStyle(node).visibility!=='hidden'&&node.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
    on(document,'visibilitychange',()=>{if(document.hidden){orbitPan=null;closePanel();}else if(opened)updateCover();});
    const unplayer=player.subscribe(event=>{if(!opened)return;if(event.type==='song'){updateCover();}if(event.type==='state')updateCover();}),unlyrics=lyrics.subscribe(event=>{if(event.type==='lines')visual.setLyrics?.(lyrics.getLines(),lyrics.getSong?.()||player.getSong());if(event.type==='time')visual.setLyricPosition?.(event.position);renderLyrics();});
    return {open,close,setAccountOpen(value){accountOpen=!!value;host.dataset.accountOpen=String(accountOpen);if(accountOpen){orbitPan=null;closePanel();library?.close();visual.deactivate();immersiveLyrics?.deactivate();}else if(opened){visual.activate();immersiveLyrics?.activate();}for(const node of [lineRoot,$('.music-immersive-player'),$('.music-visual-trigger'),panel,library?.getRoot()])if(node)node.inert=accountOpen;},activate(){active=true;},deactivate(){active=false;close({immediate:true});},getState:()=>({open:opened,diy,accountOpen,orbit:{yaw:orbitYaw,pitch:orbitPitch},lyrics:immersiveLyrics?.getState(),settingsPanel:!panel.hidden,dirty,saving,settings:{...settings},visual:visual.getState()}),dispose(){if(disposed)return;close({immediate:true});animation?.cancel();animation=null;disposed=true;revision++;if(saveTimer!==null)view.clearTimeout(saveTimer);closePanel();restore();transport?.dispose();immersiveLyrics?.dispose();unlibrary?.();unplayer();unlyrics();visual.dispose();listeners.splice(0).forEach(remove=>remove());host.remove();}};
  }
  return {create};
});
