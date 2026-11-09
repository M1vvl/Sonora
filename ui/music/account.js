(function(host,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else host.PulseMusicAccount=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const PLATFORMS=Object.freeze([
    {id:'netease',name:'网易云音乐',mark:'♪',available:true},
    {id:'qq',name:'QQ 音乐',mark:'QQ',official:true,qr:true,reason:'请使用 QQ App 扫描官方二维码。确认后自动验证 QQ 音乐账号和歌单。'},
    {id:'kugou',name:'酷狗音乐',mark:'KG',official:true,qr:true,reason:'请使用酷狗音乐 App 扫描官方二维码。确认后自动验证账号和歌单。'},
    {id:'qishui',name:'汽水音乐',mark:'QS',official:true,qr:true,reason:'提供官方页面。使用汽水官方 Passport 扫码。账号和可用音源由平台核验，受保护音源按实际支持范围处理。'},
    {id:'spotify',name:'Spotify',mark:'SP',official:true,reason:'使用 Spotify 官方播放器查看推荐、歌单和收藏。'}
  ].map(Object.freeze));
  const glyphs={user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',qr:'<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 19h2v2h-2zM19 14h2v3M14 19h3v2"/>',cookie:'<path d="M21 12a9 9 0 1 1-9-9 5 5 0 0 0 9 9Z"/><path d="M8 10h.01M7 15h.01M13 16h.01"/>',note:'<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>'};
  const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]||glyphs.user}</svg>`;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  function safeImage(value){
    if(typeof value!=='string'||value.length>1024*1024)return '';
    if(/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(value))return value;
    try{const url=new URL(value);return ['https:','pulse-music-image:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
  }
  function create({root,api,subscribe,imageURL=value=>value,now=()=>Date.now(),onPanelChange=()=>{},onNotice=()=>{},onPlay=()=>{},onProviderChange=()=>{}}={}){
    if(!root?.ownerDocument||typeof api!=='function')throw new TypeError('Music UI needs a root and local API');
    const document=root.ownerDocument,view=document.defaultView,$=selector=>root.querySelector(selector),listeners=[];
    const state={active:false,disposed:false,panelOpen:false,selected:'netease',activeProvider:'netease',profile:null,activeProfile:null,verification:'none',qrStatus:'idle',qrProvider:null,requestId:null,expiresAt:0,starting:false,polling:false};
    const officialStates=new Map(),officialLibraries=new Map();let officialBusy=false,officialGeneration=0,officialPanel=false,officialBounds=null;
    const canUseProvider=(provider,value)=>value?.apiConnected===true||provider==='spotify'&&value?.webAuthenticated===true;
    let generation=0,selectionGeneration=0,pollTimer=null,layoutTimer=null,layoutFrame=null,observer=null,bootstrap=null,previousFocus=null,motion=null;
    const on=(target,event,callback,options)=>{target.addEventListener(event,callback,options);listeners.push(()=>target.removeEventListener(event,callback,options));};
    root.classList.add('music-account-root');
    root.innerHTML=`<header class="music-toolbar"><div class="music-pill-shell"><button class="music-account-pill" type="button" data-music-action="open" aria-haspopup="dialog" aria-expanded="false" data-no-window-drag><span class="music-pill-avatar">${icon('user')}<img alt="" hidden></span><span class="music-pill-name">登录音乐</span><span class="music-vip" hidden>VIP</span></button></div></header><dialog class="music-login-sheet" aria-label="音乐账号连接" hidden data-no-window-drag><div class="music-sheet-heading"><div class="music-sheet-actions"><button class="music-logout" data-music-action="logout" type="button" hidden>退出登录</button><button class="music-close" data-music-action="close" type="button" aria-label="关闭音乐账号面板">${icon('close')}</button></div></div><div class="music-connection-graph"><svg class="music-connections" aria-hidden="true"><path class="music-connection-shadow"/><path class="music-connection-line"/></svg><div class="music-platforms" role="tablist" aria-label="音乐平台">${PLATFORMS.map(platform=>`<div class="music-platform-row" data-music-row="${platform.id}"><button type="button" class="music-platform" data-music-platform="${platform.id}" role="tab" aria-selected="${platform.id==='netease'}" tabindex="${platform.id==='netease'?0:-1}"><span class="music-platform-mark" aria-hidden="true">${platform.mark}</span><span class="music-platform-copy"><strong>${platform.name}</strong><small>${platform.available||platform.qr?'扫码连接':platform.portalOnly?'官方页面':platform.official?'官方内嵌登录':'后续接入'}</small></span><span class="music-platform-availability">${platform.portalOnly?'待适配':platform.available||platform.official?'可登录':'预留'}</span></button><span class="music-platform-port" aria-hidden="true"><i></i></span></div>`).join('')}</div><div class="music-account-column"><section class="music-account-card" role="tabpanel" aria-label="网易云音乐账号"><span class="music-account-port" aria-hidden="true"><i></i></span><div class="music-card-heading"><span class="music-card-avatar">${icon('user')}<img alt="" hidden></span><div><h3 class="music-card-name">网易云音乐</h3><p class="music-card-description">尚未连接账号</p></div><span class="music-card-vip music-vip" hidden>VIP</span></div><div class="music-login-methods"><button type="button" class="music-method" data-music-action="qr">${icon('qr')}<span>扫码登录</span></button><button type="button" class="music-method" disabled title="首期使用扫码登录，Cookie 导入后续提供">${icon('cookie')}<span>Cookie</span><small>后续支持</small></button></div><div class="music-qr-region" hidden><div class="music-qr-image"><span class="music-qr-placeholder">${icon('qr')}</span><img alt="使用网易云音乐 App 扫描此二维码" hidden></div><p class="music-qr-status" role="status" aria-live="polite">等待生成二维码</p><button class="music-text-button music-refresh-qr" type="button" data-music-action="qr" hidden>刷新二维码</button><button class="music-text-button" type="button" data-music-action="cancel-qr">取消扫码</button></div><div class="music-official-methods" hidden><div class="music-official-tabs" role="group" aria-label="QQ 官方扫码方式"><button type="button" class="music-method" data-official-method="qq">QQ 扫码</button><button type="button" class="music-method" data-official-method="wechat">微信扫码</button></div><button type="button" class="music-method music-official-open" data-music-action="official-login">${icon('qr')}<span>在面板内登录</span></button><button type="button" class="music-text-button" data-music-action="official-refresh">验证账号状态</button><button type="button" class="music-method music-official-library" data-music-action="official-library" hidden>我的歌单</button><div class="music-official-playlists" hidden></div></div><section class="music-spotify-connect" hidden><button type="button" class="music-method" data-music-action="spotify-web-player">使用 Spotify 音乐</button></section><p class="music-unavailable" hidden>此平台暂未接入，当前可使用网易云扫码登录。</p></section></div></div><section class="music-embedded-official" hidden><header><button type="button" class="music-text-button" data-music-action="official-back">返回账号</button><strong class="music-embedded-title"></strong><div class="music-embedded-qq" hidden><button type="button" data-official-method="qq">QQ</button><button type="button" data-official-method="wechat">微信</button></div></header><div class="music-embedded-frame" aria-label="平台官方登录页面"></div><p class="music-embedded-note" role="status">仅在官方网页输入账号或扫码。平台会话与本软件播放器接入状态分别核实。</p></section></dialog>`;
    const graph=$('.music-connection-graph'),sheet=$('.music-login-sheet'),pill=$('.music-account-pill'),qrImage=$('.music-qr-image img');
    function clearPoll(){if(pollTimer!==null)view.clearTimeout(pollTimer);pollTimer=null;}
    async function request(action,payload={}){const result=await api(action,payload);if(result?.error)throw new Error(result.error);return result||{};}
    function message(text=''){if(!state.disposed)onNotice(text);}
    function avatar(container,profile){
      const img=container.querySelector('img'),value=safeImage(imageURL(profile?.avatarURL||profile?.avatarDataURL||''));
      let initial=container.querySelector('.music-avatar-initial');
      if(!initial){initial=root.ownerDocument.createElement('span');initial.className='music-avatar-initial';initial.setAttribute('aria-hidden','true');container.append(initial);}
      const letter=profile?.nickname&&profile.nickname!=='Spotify 账号'?Array.from(profile.nickname.trim())[0]?.toLocaleUpperCase()||'':'';
      initial.textContent=letter;initial.hidden=!!value||!letter;
      if(value){if(img.getAttribute('src')!==value)img.src=value;img.hidden=false;}else {img.hidden=true;img.removeAttribute('src');}
      container.querySelector('svg').toggleAttribute('hidden',!!value||!!letter);
      container.title=value?'':letter?'账号未提供头像':'';
    }
    function applyProfile(value,{verification='verified'}={}){
      state.verification=value?verification:'none';
      if(value===null)state.profile=null;
      else if(value&&typeof value==='object'&&typeof value.nickname==='string')state.profile={userId:value.userId,nickname:value.nickname.slice(0,100),avatarURL:value.avatarURL||value.avatarDataURL||'',vip:value.vip===true};
      if(state.activeProvider==='netease')state.activeProfile=state.profile;
      renderPill();
      renderCard();
    }
    function renderPill(){
      const profile=state.activeProfile,pillName=$('.music-pill-name');
      pillName.textContent=profile?.nickname||'登录音乐';pillName.title=profile?.nickname||'管理音乐账号';
      avatar($('.music-pill-avatar'),profile);$('.music-account-pill>.music-vip').hidden=profile?.vip!==true;
    }
    function applyProvider(value,{notify=true}={}){
      if(!PLATFORMS.some(platform=>platform.id===value?.provider))return;
      const identity=profile=>profile?String(profile.userId||profile.nickname||''):'';
      const profile=(value.apiConnected?value.profile:null)||(value.provider==='spotify'?value.webProfile:null)||value.profile||null;
      const transport=value.provider==='spotify'?(value.browserBridge?'browser-pilot':Object.hasOwn(value,'webPlayer')?(value.webPlayer?'official-web':'catalog'):activeTransport):'catalog';
      const changed=state.activeProvider!==value.provider||identity(state.activeProfile)!==identity(profile)||transport!==activeTransport;activeTransport=transport;
      state.activeProvider=value.provider;state.activeProfile=profile;
      if(value.provider==='netease'&&value.profile)state.profile=value.profile;
      if(value.provider!=='netease'&&(value.profile||value.webProfile||value.webAuthenticated))officialStates.set(value.provider,{...officialStates.get(value.provider),...value,sessionSaved:true});
      renderPill();renderCard();
      if(changed&&notify)onProviderChange(value.provider);
    }
    async function useProvider(provider){
      const ticket=++selectionGeneration;
      try{
        const result=await request('selectProvider',{provider});
        if(state.disposed||ticket!==selectionGeneration||state.selected!==provider)return false;
        if(result.provider!==provider||!canUseProvider(provider,result))return false;
        applyProvider(result);return true;
      }catch(error){if(!state.disposed&&ticket===selectionGeneration&&state.selected===provider)message(error.message||'音乐账号切换失败');}
    }
    let spotifySelecting=false,activeTransport='catalog';
    function renderCard(){
      const platform=PLATFORMS.find(item=>item.id===state.selected),official=officialStates.get(platform.id);
      const profile=state.selected==='netease'?state.profile:(official?.apiConnected?official.profile:null)||(state.selected==='spotify'?official?.webProfile:null)||official?.profile||official?.webProfile||null;
      $('.music-account-card').classList.toggle('is-connected',!!profile);
      $('.music-card-name').textContent=profile?.nickname||platform.name;
      $('.music-card-description').textContent=profile?(state.selected==='netease'&&state.verification==='pending'?'已保存 · 待核实':platform.name+' · 已连接'):platform.available?'尚未连接账号':'平台入口已预留';
      $('.music-card-vip').hidden=profile?.vip!==true;avatar($('.music-card-avatar'),profile);
      const embedded=$('.music-embedded-official');embedded.hidden=!officialPanel;graph.hidden=officialPanel;sheet.classList.toggle('has-official-view',officialPanel);$('.music-embedded-title').textContent=platform.name+' · 官方登录';$('.music-embedded-qq').hidden=platform.id!=='qq';
      $('.music-embedded-note').textContent=official?.message||'仅在官方网页输入账号或扫码。平台会话与本软件播放器接入状态分别核实。';
      if(platform.official&&!profile)$('.music-card-description').textContent=official?.windowOpen?(platform.id==='qq'&&!official.methodApplied?'请在官方页面选择扫码方式':'在面板内完成官方登录'):official?.playbackTicketAvailable?'官方网页已返回播放票据 · 待核实':official?.sessionSaved?'官方网页会话已保存':'使用官方网页登录';
      $('.music-logout').hidden=platform.id==='netease'?!state.profile:!official?.sessionSaved;
      $('.music-official-methods').hidden=!!profile||!platform.official||platform.id==='spotify'||platform.qr&&!['error','expired'].includes(state.qrStatus);$('.music-spotify-connect').hidden=platform.id!=='spotify'||!!profile;$('.music-official-tabs').hidden=platform.id!=='qq';
      for(const button of root.querySelectorAll('[data-official-method],.music-official-open'))button.disabled=officialBusy;
      $('.music-official-open span').textContent='在面板内登录 '+platform.name;
      const library=$('.music-official-playlists'),lists=officialLibraries.get(platform.id);$('.music-official-library').hidden=!['qq','kugou'].includes(platform.id);library.hidden=!lists?.length;library.innerHTML=(lists||[]).map(value=>`<button type="button" class="music-official-playlist" data-platform-playlist="${esc(value.id)}"><span>${esc(value.title)}</span><small>${Math.max(0,Number(value.trackCount)||0)} 首</small></button>`).join('');
      $('.music-unavailable').textContent=profile?'':platform.reason||'';
      $('.music-login-methods').hidden=!(platform.available||platform.qr)||!!profile;$('.music-unavailable').hidden=!!platform.available||!!profile||platform.id==='spotify';
      $('.music-qr-region').hidden=!(platform.available||platform.qr)||!!profile||state.qrStatus==='idle';
      for(const button of root.querySelectorAll('[data-music-platform]')){const selected=button.dataset.musicPlatform===state.selected;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;button.closest('.music-platform-row').classList.toggle('selected',selected);}
      for(const platform of PLATFORMS.filter(value=>value.official)){
        const status=officialStates.get(platform.id),connected=!!status?.profile,webAuthenticated=status?.webAuthenticated===true;
        const row=root.querySelector(`[data-music-platform="${platform.id}"]`);
        row.querySelector('small').textContent=connected?'账号已连接':webAuthenticated?'网页已登录':platform.qr?'扫码连接':'官方内嵌登录';
        row.querySelector('.music-platform-availability').textContent=connected||webAuthenticated?(platform.id===state.activeProvider?'正在使用':'已连接'):'可登录';
      }
      const netease=root.querySelector('[data-music-platform="netease"]');netease.querySelector('small').textContent=state.profile?'账号已连接':'扫码连接';netease.querySelector('.music-platform-availability').textContent=state.profile?(state.activeProvider==='netease'?'正在使用':'已连接'):'可登录';
      scheduleLine();
    }
    function line(){
      if(state.disposed||!state.active||!state.panelOpen)return;
      if(officialPanel){syncOfficialBounds();return;}
      const box=graph.getBoundingClientRect(),from=root.querySelector(`[data-music-row="${state.selected}"] .music-platform-port`).getBoundingClientRect(),to=$('.music-account-port').getBoundingClientRect();
      if(box.width<=0||box.height<=0)return;
      const x1=from.left+from.width/2-box.left,y1=from.top+from.height/2-box.top,x2=to.left+to.width/2-box.left,y2=to.top+to.height/2-box.top;
      const bend=Math.max(20,Math.min(120,Math.abs(x2-x1)*.55));
      const d=`M ${x1.toFixed(2)} ${y1.toFixed(2)} C ${(x1+bend).toFixed(2)} ${y1.toFixed(2)}, ${(x2-bend).toFixed(2)} ${y2.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}`;
      const svg=$('.music-connections');svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);svg.setAttribute('width',box.width);svg.setAttribute('height',box.height);for(const path of svg.querySelectorAll('path'))if(path.getAttribute('d')!==d)path.setAttribute('d',d);
    }
    function cancelLine(){if(layoutFrame!==null)view.cancelAnimationFrame?.(layoutFrame);if(layoutTimer!==null)view.clearTimeout(layoutTimer);layoutFrame=layoutTimer=null;}
    function scheduleLine(){
      if(state.disposed||!state.active||!state.panelOpen||layoutFrame!==null||layoutTimer!==null)return;
      const finish=()=>{cancelLine();line();};if(view.requestAnimationFrame)layoutFrame=view.requestAnimationFrame(finish);layoutTimer=view.setTimeout(finish,50);
    }
    function qrRequest(action,payload={},provider=state.qrProvider||state.selected){
      if(provider==='netease')return request(action,payload);
      const names={beginQR:'qrCreate',checkQR:'qrCheck',cancelQR:'closeQr'};
      const rect=sheet.getBoundingClientRect(),bounds={x:Math.round(rect.left+16),y:Math.round(rect.top+56),width:Math.max(120,Math.round(rect.width-32)),height:Math.max(120,Math.round(rect.height-76))};
      return request('platformRequest',{provider,action:names[action],...payload,...(action==='beginQR'?{bounds,method:'qq'}:{})});
    }
    function resetQR(){clearPoll();state.requestId=null;state.qrProvider=null;state.expiresAt=0;state.qrStatus='idle';state.starting=false;state.polling=false;qrImage.hidden=true;qrImage.removeAttribute('src');$('.music-qr-placeholder').hidden=false;$('.music-refresh-qr').hidden=true;renderCard();}
    function cancelQR(){const needed=!!state.requestId||state.starting||state.qrStatus==='waiting'||state.qrStatus==='scanned'||state.qrProvider&&state.qrProvider!=='netease'&&state.qrStatus!=='idle';const requestId=state.requestId,provider=state.qrProvider;++generation;resetQR();if(needed)qrRequest('cancelQR',requestId?{requestId}:{},provider).catch(()=>{});}
    function setQRStatus(status){
      state.qrStatus=status;const platform=PLATFORMS.find(value=>value.id===(state.qrProvider||state.selected)),scanner=platform.id==='qishui'?'抖音':platform.id==='qq'?'QQ':platform.name;qrImage.alt='使用'+scanner+' App 扫描此二维码';const text={starting:'正在生成二维码…',waiting:'请使用'+scanner+' App 扫码',scanned:'已扫码，请在手机上确认',confirmed:'登录成功',expired:'二维码已过期，请刷新',error:'登录暂未完成，请重试'};
      $('.music-qr-status').textContent=text[status]||text.waiting;$('.music-refresh-qr').hidden=!['expired','error'].includes(status);renderCard();
    }
    function expire(){clearPoll();const requestId=state.requestId;state.requestId=null;qrImage.hidden=true;$('.music-qr-placeholder').hidden=false;setQRStatus('expired');if(requestId)qrRequest('cancelQR',{requestId}).catch(()=>{});}
    function schedulePoll(ticket,delay=2000){
      clearPoll();if(state.disposed||!state.active||!state.panelOpen||!state.requestId||ticket!==generation)return;
      const remaining=state.expiresAt-now();if(remaining<=0){expire();return;}
      pollTimer=view.setTimeout(()=>{pollTimer=null;poll(ticket);},Math.min(Math.max(1500,Math.min(60000,delay)),remaining));
    }
    async function poll(ticket){
      if(state.disposed||ticket!==generation||!state.active||!state.panelOpen||!state.requestId||state.polling)return;
      if(now()>=state.expiresAt){expire();return;}
      state.polling=true;const requestId=state.requestId;
      try{
        const result=await qrRequest('checkQR',{requestId});
        if(state.disposed||ticket!==generation||requestId!==state.requestId)return;
        if(result.status==='confirmed'){
          clearPoll();state.requestId=null;state.expiresAt=0;setQRStatus('confirmed');
          const provider=state.qrProvider;
          if(provider!=='netease'){
            const value=result.profile?result:await request('platformRequest',{provider,action:'profile'});
            if(ticket!==generation||state.disposed)return;
            officialStates.set(provider,{provider,sessionSaved:true,windowOpen:false,apiConnected:value.apiConnected===true,profile:value.profile||null});renderCard();
            qrImage.removeAttribute('src');message(value.profile?PLATFORMS.find(item=>item.id===provider).name+'已连接':'扫码已确认，账号信息待核实');
            if(value.apiConnected===true)await useProvider(provider);
          }else{
            if(result.profile)applyProfile(result.profile);else {const current=await request('bootstrap');if(ticket!==generation||state.disposed)return;applyProfile(current.profile||null,{verification:current.verification});}
            qrImage.removeAttribute('src');message('网易云音乐已连接');await useProvider('netease');
          }
        }else if(result.status==='expired'){expire();}
        else {setQRStatus(result.status==='scanned'?'scanned':'waiting');schedulePoll(ticket,Number(result.retryAfterMs)||2000);}
      }catch(error){if(ticket===generation&&!state.disposed){state.requestId=null;setQRStatus('error');message(error.message||'扫码状态读取失败');}}
      finally{if(ticket===generation)state.polling=false;}
    }
    async function beginQR(){
      const supportsQR=state.selected==='netease'||PLATFORMS.find(value=>value.id===state.selected)?.qr;
      if(state.disposed||!state.active||!state.panelOpen||!supportsQR||state.starting)return;
      cancelQR();state.qrProvider=state.selected;const ticket=generation;state.starting=true;setQRStatus('starting');message('');
      try{
        const result=await qrRequest('beginQR');if(state.disposed||ticket!==generation||!state.active||!state.panelOpen)return;
        if(typeof result.requestId!=='string'||!result.requestId||!/^data:image\/png;base64,[a-z\d+/=]+$/i.test(result.qrImage||''))throw new Error('未能取得有效的登录二维码');
        state.requestId=result.requestId;state.expiresAt=Math.min(now()+180000,Number.isFinite(result.expiresAt)?result.expiresAt:now()+180000);
        qrImage.src=result.qrImage;qrImage.hidden=false;$('.music-qr-placeholder').hidden=true;setQRStatus('waiting');schedulePoll(ticket);
      }catch(error){if(ticket===generation&&!state.disposed){setQRStatus('error');message(error.message||'二维码生成失败');}}
      finally{if(ticket===generation)state.starting=false;}
    }
    function animateSheet(opening){motion?.cancel();motion=null;if(typeof sheet.animate!=='function'||view.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return null;motion=sheet.animate(opening?[{opacity:0,transform:'translateY(8px) scale(.98)'},{opacity:1,transform:'translateY(0) scale(1)'}]:[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(8px) scale(.98)'}],{duration:opening?220:160,easing:'cubic-bezier(.23,1,.32,1)'});return motion;}
    function open(){if(state.disposed||!state.active||state.panelOpen)return;if(!sheet.open)previousFocus=document.activeElement;state.panelOpen=true;sheet.hidden=false;if(typeof sheet.showModal==='function'&&!sheet.open)sheet.showModal();else sheet.setAttribute('open','');pill.setAttribute('aria-expanded','true');message('');renderCard();onPanelChange(true);animateSheet(true);refreshOfficial(state.selected);root.querySelector(`[data-music-platform="${state.selected}"]`).focus();}
    function close({immediate=false}={}){if(!state.panelOpen&&!sheet.open)return;closeOfficial();cancelQR();state.panelOpen=false;pill.setAttribute('aria-expanded','false');cancelLine();onPanelChange(false);const finish=()=>{if(state.panelOpen||state.disposed)return;if(typeof sheet.close==='function'&&sheet.open)sheet.close();sheet.removeAttribute('open');sheet.hidden=true;if(previousFocus?.isConnected)previousFocus.focus();previousFocus=null;};if(immediate){motion?.cancel();motion=null;finish();return;}const animation=animateSheet(false);if(animation)animation.finished.then(finish,()=>{});else finish();}
    function select(id,{focus=false}={}){
      if(!PLATFORMS.some(item=>item.id===id))return;
      if(id!==state.selected){
        ++selectionGeneration;
        closeOfficial();cancelQR();state.selected=id;message('');renderCard();
        if(id==='netease'){
          if(state.profile)useProvider(id);
        }else refreshOfficial(id,{verify:true,activate:true});
      }else if((id==='netease'&&state.profile)||canUseProvider(id,officialStates.get(id))){
        useProvider(id);
      }
      if(focus)root.querySelector('[data-music-platform="'+id+'"]').focus();
    }
    async function refreshOfficial(provider,{verify=false,activate=false}={}){
      if(!PLATFORMS.find(item=>item.id===provider)?.official)return;
      const ticket=officialGeneration;
      try{
        const result=await request('platformStatus',{provider});if(state.disposed||result.provider!==provider)return;
        officialStates.set(provider,result);
        if(verify&&['qq','kugou','qishui'].includes(provider)&&(result.sessionSaved||result.apiConnected)){
          const verified=await request('platformRequest',{provider,action:'profile'});
          if(state.disposed||ticket!==officialGeneration)return;
          if(verified.profile)officialStates.set(provider,{...result,...verified});
        }
        if(state.selected===provider){if(result.webAuthenticated&&!result.windowOpen)officialPanel=false;renderCard();if(activate&&canUseProvider(provider,officialStates.get(provider)))await useProvider(provider);}
      }catch(error){if(state.panelOpen&&state.selected===provider)message(error.message||'官方账号状态暂不可用');}
    }
    async function loadOfficialLibrary(){
      const provider=state.selected,ticket=officialGeneration;if(!['qq','kugou'].includes(provider)||officialBusy)return;
      officialBusy=true;renderCard();
      try{
        const value=await request('platformRequest',{provider,action:'playlists'});
        if(state.disposed||ticket!==officialGeneration||provider!==state.selected)return;
        officialLibraries.set(provider,(value.playlists||[]).slice(0,100));
        if(!value.playlists?.length)message('当前账号暂无可读取的歌单');
      }catch(error){if(!state.disposed&&ticket===officialGeneration)message(error.message||'歌单读取失败');}
      finally{if(!state.disposed&&ticket===officialGeneration){officialBusy=false;renderCard();}}
    }
    async function playOfficialPlaylist(id){
      const provider=state.selected,ticket=officialGeneration;if(officialBusy||!officialLibraries.get(provider)?.some(value=>value.id===id))return;
      officialBusy=true;renderCard();
      try{
        const result=await request('platformRequest',{provider,action:'playlist',id,limit:50,offset:0});
        if(state.disposed||ticket!==officialGeneration||provider!==state.selected)return;
        if(!result.songs?.length)throw new Error('此歌单没有返回可播放歌曲');
        close({immediate:true});await onPlay(result.songs);
      }catch(error){if(!state.disposed)message(error.message||'歌单暂时无法播放');}
      finally{if(!state.disposed){officialBusy=false;renderCard();}}
    }
    function closeOfficial(){
      const provider=state.selected,wasOpen=officialPanel||officialStates.get(provider)?.windowOpen;officialGeneration++;officialBusy=false;officialPanel=false;officialBounds=null;
      if(!wasOpen){if(!state.disposed)renderCard();return;}
      request('platformClose',{provider}).then(()=>{if(state.panelOpen&&!state.disposed&&['qq','kugou'].includes(provider))refreshOfficial(provider,{verify:true});}).catch(()=>{});
      if(!state.disposed)renderCard();
    }
    function frameBounds(){const rect=$('.music-embedded-frame').getBoundingClientRect();return {x:Math.round(rect.left),y:Math.round(rect.top),width:Math.round(rect.width),height:Math.round(rect.height)};}
    function syncOfficialBounds(){
      if(!officialPanel||officialBusy||!state.panelOpen||state.disposed)return;
      const bounds=frameBounds(),key=JSON.stringify(bounds);if(key===officialBounds||bounds.width<120||bounds.height<120)return;
      officialBounds=key;request('platformBounds',{provider:state.selected,bounds}).catch(()=>{});
    }
    async function openSpotifyPlayer(){
      if(officialBusy)return;
      if(!canUseProvider('spotify',officialStates.get('spotify'))){await openOfficial();return;}
      try{officialBusy=true;if(await useProvider('spotify'))close({immediate:true});}catch(error){message(error.message||'网页中转验证未完成');}finally{officialBusy=false;renderCard();}
    }
    async function openOfficial(method='qq'){
      const provider=state.selected;if(!PLATFORMS.find(item=>item.id===provider)?.official||officialBusy)return;
      const ticket=++officialGeneration;officialBusy=true;officialPanel=true;officialBounds=null;renderCard();
      try{
        const result=await request('platformLogin',{provider,method,bounds:frameBounds()});
        if(state.disposed||ticket!==officialGeneration||provider!==state.selected||!state.panelOpen)return;
        if(result.provider===provider)officialStates.set(provider,result);
        if(!result.windowOpen)officialPanel=false;
      }catch(error){if(!state.disposed&&ticket===officialGeneration){officialPanel=false;message(error.message||'官方登录页面暂时无法打开');}}
      finally{if(!state.disposed&&ticket===officialGeneration){officialBusy=false;renderCard();syncOfficialBounds();}}
    }
    async function logout(){
      const provider=state.selected;
      if(PLATFORMS.find(item=>item.id===provider)?.official){
        try{
          cancelQR();
          const result=await request('platformLogout',{provider});
          if(state.disposed)return;
          officialStates.set(provider,result);officialLibraries.delete(provider);
          if(state.activeProvider===provider){const hadProfile=!!state.activeProfile;state.activeProfile=null;renderPill();if(hadProfile)onProviderChange(provider);}
          renderCard();message('已退出'+PLATFORMS.find(value=>value.id===provider).name);
        }catch(error){message(error.message||'网页会话清除失败');}
        return;
      }
      message('');
      try{
        await request('logout');
        if(state.disposed)return;
        const hadProfile=state.activeProvider==='netease'&&!!state.activeProfile;
        cancelQR();applyProfile(null);
        if(hadProfile)onProviderChange('netease');
        message('已退出网易云音乐');
      }catch(error){message(error.message||'退出登录失败');}
    }
    on(root,'click',event=>{const playlist=event.target.closest('[data-platform-playlist]');if(playlist){playOfficialPlaylist(playlist.dataset.platformPlaylist);return;}const platform=event.target.closest('[data-music-platform]');if(platform){select(platform.dataset.musicPlatform);return;}const action=event.target.closest('[data-music-action]')?.dataset.musicAction;if(action==='spotify-web-player')openSpotifyPlayer();else if(action==='open')open();else if(action==='close')close();else if(action==='qr')beginQR();else if(action==='cancel-qr')cancelQR();else if(action==='logout')logout();else if(action==='official-login')openOfficial();else if(action==='official-refresh')refreshOfficial(state.selected,{verify:true});else if(action==='official-library')loadOfficialLibrary();else if(action==='official-back')closeOfficial();else{const method=event.target.closest('[data-official-method]');if(method)openOfficial(method.dataset.officialMethod);}});
    on(root,'keydown',event=>{
      if(event.key==='Escape'&&state.panelOpen){event.preventDefault();close();return;}
      const button=event.target.closest('[data-music-platform]');if(!button||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      event.preventDefault();const at=PLATFORMS.findIndex(item=>item.id===button.dataset.musicPlatform),next=event.key==='Home'?0:event.key==='End'?PLATFORMS.length-1:(at+(event.key==='ArrowDown'?1:-1)+PLATFORMS.length)%PLATFORMS.length;select(PLATFORMS[next].id,{focus:true});
    });
    on(sheet,'animationend',scheduleLine);
    on(sheet,'cancel',event=>{event.preventDefault();close();});
    on(sheet,'click',event=>{if(event.target!==sheet)return;const r=sheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
    on(sheet,'keydown',event=>{if(event.key!=='Tab')return;const focusable=[...sheet.querySelectorAll('button:not([disabled]),[tabindex="0"],input:not([disabled])')].filter(node=>!node.closest('[hidden]')),first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
    for(const img of root.querySelectorAll('.music-pill-avatar img,.music-card-avatar img'))on(img,'error',()=>{img.hidden=true;img.parentNode.querySelector('svg').removeAttribute('hidden');});
    if(typeof view.ResizeObserver==='function'){observer=new view.ResizeObserver(scheduleLine);observer.observe(graph);observer.observe($('.music-account-card'));observer.observe($('.music-platforms'));observer.observe($('.music-embedded-frame'));}else on(view,'resize',scheduleLine);
    if(typeof subscribe==='function'){const remove=subscribe(value=>{if(state.disposed)return;if(value?.workspaceProvider){applyProvider(value.workspaceProvider);return;}if(value?.platformSession){const official=value.platformSession;if(PLATFORMS.find(item=>item.id===official.provider)?.official){officialStates.set(official.provider,official);if(official.provider==='spotify'&&canUseProvider('spotify',official)&&state.selected==='spotify'&&state.panelOpen&&!spotifySelecting&&(state.activeProvider!=='spotify'||!state.activeProfile)){spotifySelecting=true;useProvider('spotify').then(selected=>{if(selected)close({immediate:true});}).finally(()=>{spotifySelecting=false;});}if(state.activeProvider===official.provider&&(Object.hasOwn(official,'profile')||Object.hasOwn(official,'webProfile')))applyProvider(official);if(official.provider===state.selected&&officialPanel&&!officialBusy&&!official.windowOpen)officialPanel=false;renderCard();}return;}if(value?.state==='signedOut'||value?.profile===null){if(state.qrProvider==='netease')cancelQR();applyProfile(null);}else if(value?.profile){if(state.qrProvider==='netease')cancelQR();applyProfile(value.profile,{verification:value.verification});}});if(typeof remove==='function')listeners.push(remove);}
    renderCard();
    return {
      async activate(){if(state.disposed)return;state.active=true;const ticket=generation;bootstrap=request('bootstrap');try{const value=await bootstrap;if(!state.disposed&&state.active&&ticket===generation){applyProfile(value.profile||null,{verification:value.verification});const provider=await request('providerState');if(!state.disposed&&state.active&&ticket===generation){applyProvider(provider,{notify:false});if(!state.panelOpen&&PLATFORMS.some(item=>item.id===provider.provider)){state.selected=provider.provider;renderCard();}}}}catch(error){if(state.active&&!state.disposed)message(error.message||'账号状态读取失败');}if(state.panelOpen)scheduleLine();},
      deactivate(){if(state.disposed)return;close({immediate:true});cancelQR();state.active=false;cancelLine();motion?.cancel();motion=null;},
      open,close,
      getState:()=>({active:state.active,panelOpen:state.panelOpen,selected:state.selected,activeProvider:state.activeProvider,qrStatus:state.qrStatus,polling:state.polling,pendingTimer:pollTimer!==null,authenticated:!!state.activeProfile,officialSession:officialStates.get(state.selected)||null,officialPanel,verification:state.verification,disposed:state.disposed}),
      dispose(){if(state.disposed)return;this.deactivate();state.disposed=true;officialGeneration++;observer?.disconnect();listeners.splice(0).forEach(remove=>remove());cancelLine();root.replaceChildren();root.classList.remove('music-account-root');}
    };
  }
  return {create,PLATFORMS,safeImage};
});
