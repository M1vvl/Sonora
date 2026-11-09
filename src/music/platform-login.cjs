'use strict';

// MineRadio desktop/main.js uses isolated official provider sessions.
// Agent Pulse hosts the same official flows inside its existing account panel.
const PROVIDERS=Object.freeze({
  qq:{name:'QQ 音乐',entry:'https://y.qq.com/n/ryqq/profile',fallback:'https://y.qq.com/',domains:['qq.com','tencent.com','qqmusic.com','gtimg.com','qpic.cn','weixin.qq.com']},
  kugou:{name:'酷狗音乐',entry:'https://www.kugou.com/',domains:['kugou.com','kgimg.com','qq.com','weixin.qq.com']},
  qishui:{name:'汽水音乐',entry:'https://www.qishui.com/',domains:['qishui.com','douyin.com','bytedance.com']},
  spotify:{name:'Spotify',entry:'https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F',domains:['spotify.com','scdn.co']}
});
const QQ_METHODS=Object.freeze(['qq','wechat','qqmusic']);
const SPOTIFY_VERIFY_DELAYS=Object.freeze([750,2000,5000]);
const {verifySpotifyWebSession}=require('./spotify-web-session.cjs');
// These identities belong to Spotify's official sign-in flow. They share the
// isolated login view, but their cookies never enter a music-provider adapter.
const SPOTIFY_IDENTITY_HOSTS=new Set(['accounts.google.com','accounts.google.cn','www.facebook.com','m.facebook.com','facebook.com','appleid.apple.com','account.apple.com','idmsa.apple.com']);

function trustedURL(provider,value){
  try{
    const url=new URL(value),config=PROVIDERS[provider];
    return !!config&&url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&(config.domains.some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain))||provider==='spotify'&&SPOTIFY_IDENTITY_HOSTS.has(url.hostname));
  }catch{return false;}
}

function providerURL(provider,value){
  try{const url=new URL(value);return trustedURL(provider,value)&&PROVIDERS[provider].domains.some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain));}catch{return false;}
}

function navigationAborted(error){
  return error?.errno===-3||error?.code==='ERR_ABORTED'||/\bERR_ABORTED\b/.test(String(error?.message||''));
}

function loginLoadMessage(provider,error){
  const code=String(error?.code||error?.message||'').match(/\bERR_[A-Z0-9_]+\b/)?.[0];
  const reason=code&&/PROXY|TUNNEL/.test(code)?'代理连接失败':code&&/NAME_NOT_RESOLVED/.test(code)?'域名解析失败':code&&/CERT|SSL/.test(code)?'安全连接失败':'页面连接失败';
  return PROVIDERS[provider].name+' 登录'+reason+(code?'（'+code+'）':'')+'，可返回账号后重试';
}

function loginScript(provider,method){
  const labels=['登录','登陆','立即登录'];
  const tabLabels={qq:['QQ登录','QQ 登录','QQ帐号登录','QQ账号登录','QQ'],wechat:['微信登录','微信 登录','微信扫码登录','微信扫码','微信'],qqmusic:['QQ音乐扫码登录','QQ音乐App扫码登录','QQ音乐扫码','QQ音乐登录','QQ 音乐登录','QQ音乐']}[method]||[];
  // The fixed script operates only visible official login controls. It returns
  // no page data and never reads credentials, storage or account information.
  return `(()=>{const visible=node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};const select=labels=>Array.from(document.querySelectorAll('button,a,[role="button"],[role="tab"],span,div')).find(node=>(node.children.length===0||node.matches('button,a,[role="button"],[role="tab"]'))&&visible(node)&&labels.includes((node.textContent||'').trim()));const entry=select(${JSON.stringify(labels)});if(entry)entry.click();const tab=select(${JSON.stringify(tabLabels)});if(tab)tab.click();return {loginOpened:!!entry,methodApplied:!!tab};})()`;
}

async function activateLogin(web,provider,method){
  const main=web.mainFrame;
  const candidates=main?(main.framesInSubtree||[main,...(main.frames||[])]):[web];
  const frames=[...new Set(candidates)].slice(0,8).filter(frame=>{
    try{return !frame.isDestroyed?.()&&providerURL(provider,frame===web?web.getURL():frame.url);}catch{return false;}
  });
  const results=await Promise.all(frames.map(frame=>frame.executeJavaScript(loginScript(provider,method),true).catch(()=>null)));
  return {loginOpened:results.some(value=>value?.loginOpened),methodApplied:results.some(value=>value?.methodApplied)};
}

function panelBounds(rect,owner){
  if(!rect||!['x','y','width','height'].every(key=>Number.isFinite(rect[key])))throw new Error('无效的账号面板区域');
  const [width,height]=owner.getContentSize();
  const x=Math.max(0,Math.min(width,Math.round(rect.x))),y=Math.max(0,Math.min(height,Math.round(rect.y)));
  const bounds={x,y,width:Math.min(width-x,Math.round(rect.width)),height:Math.min(height-y,Math.round(rect.height))};
  if(bounds.width<120||bounds.height<120)throw new Error('账号面板区域过小，请展开软件窗口后重试');
  return bounds;
}

function createPlatformLogin({electron,dataDir,getOfficialSession,getHostWindow=()=>null,onStatus=()=>{}}={}){
  const {WebContentsView,session}=electron;
  const entries=new Map();let disposed=false,active=null;
  const playerObservers=new Set();
  function spotifyViews(entry){return [...entry.views.map(record=>record.view.webContents),...entry.playerViews].filter(web=>!web.isDestroyed());}
  function spotifyPlayerOpen(entry){
    return spotifyViews(entry).some(web=>{try{const url=new URL(web.getURL());return url.protocol==='https:'&&url.hostname==='open.spotify.com';}catch{return false;}});
  }
  function cancelWebRetries(entry){for(const timer of entry.webRetryTimers)clearTimeout(timer);entry.webRetryTimers.clear();}
  function scheduleWebRetries(entry){
    if(entry.provider!=='spotify'||entry.webRetryStarted||!entry.views.length||entry.webProfile)return;
    entry.webRetryStarted=true;const ticket=entry.generation;
    // Spotify hydrates the account widget after navigation. A user-opened
    // attempt gets three delayed checks, with no background polling afterwards.
    for(const delay of SPOTIFY_VERIFY_DELAYS){
      const timer=setTimeout(async()=>{
        entry.webRetryTimers.delete(timer);
        const current=()=>!disposed&&ticket===entry.generation&&entry.views.length>0&&!entry.webProfile;
        if(!current())return;
        try{
          if(entry.refresh)await entry.refresh;
          if(!current())return;
          await status({provider:entry.provider},true);
          if(current())entry.changed();
        }catch{}
      },delay);
      timer.unref?.();entry.webRetryTimers.add(timer);
    }
  }
  function providerEntry(provider){
    if(!Object.hasOwn(PROVIDERS,provider))throw new Error('不支持的官方登录平台');
    if(disposed)throw new Error('音乐账号模块已关闭');
    if(entries.has(provider))return entries.get(provider);
    const network=getOfficialSession ? getOfficialSession(provider) : session.fromPartition('persist:agent-pulse-'+provider+'-official',{cache:false});
    network.setPermissionRequestHandler?.((_web,_permission,callback)=>callback(false));
    network.setPermissionCheckHandler?.(()=>false);
    const entry={provider,network,owner:null,views:[],playerViews:new Set(),bounds:null,method:'qq',methodApplied:false,timer:null,saved:false,refresh:null,generation:0,adapter:null,qr:null,message:'',recovered:false,webProfile:null,webCheckedAt:0,webCookieGeneration:0,webRetryStarted:false,webRetryTimers:new Set()};
    entry.changed=()=>{
      if(disposed||entry.timer!==null)return;
      entry.timer=setTimeout(()=>{entry.timer=null;const ticket=entry.generation,cookieTicket=entry.webCookieGeneration;status({provider}).then(value=>{if(!disposed&&ticket===entry.generation&&cookieTicket===entry.webCookieGeneration)onStatus(value);}).catch(()=>{});},180);
      entry.timer.unref?.();
    };
    entry.cookieChanged=(_event,cookie,_cause,removed)=>{
      const names=provider==='qq'?['uin','qqmusic_uin','wxuin','qm_keyst','qqmusic_key','music_key','wxskey']:provider==='kugou'?['userid','token','KuGoo']:[];
      if(cookie&&names.includes(cookie.name))entry.adapter?.cancel();
      if(provider==='spotify'&&cookie?.name==='sp_dc'&&PROVIDERS.spotify.domains.some(domain=>String(cookie.domain||'').replace(/^\./,'')===domain||String(cookie.domain||'').endsWith('.'+domain))){
        entry.webCookieGeneration++;entry.webProfile=null;entry.webCheckedAt=0;entry.refresh=null;
        if(!removed)scheduleWebRetries(entry);
      }
      entry.changed();
    };
    network.cookies.on?.('changed',entry.cookieChanged);entries.set(provider,entry);return entry;
  }
  function adapter(entry){
    if(entry.adapter)return entry.adapter;
    if(entry.provider==='spotify'){entry.adapter=require('./providers/spotify.cjs').createSpotifyAdapter({electron,network:entry.network,dataDir,onStatus:message=>{entry.message=message||'';entry.changed();}});return entry.adapter;}
    entry.adapter=entry.provider==='qishui'?require('./providers/qishui.cjs').createQishuiAdapter({electron,network:entry.network,dataDir,getHostWindow,onStatus:()=>entry.changed()}):
      require('./providers/index.cjs').createProviderAdapter({provider:entry.provider,getCookie:async()=>{const cookies=await ownCookies(entry);return cookies.map(item=>item.name+'='+item.value).join('; ');}});
    return entry.adapter;
  }
  async function ownCookies(entry){
    const cookies=await entry.network.cookies.get({});
    return cookies.filter(item=>PROVIDERS[entry.provider].domains.some(domain=>String(item.domain||'').replace(/^\./,'')===domain||String(item.domain||'').endsWith('.'+domain)));
  }
  async function status({provider}={},verifyWeb=false){
    const entry=providerEntry(provider),ticket=entry.generation,cookieTicket=entry.webCookieGeneration;
    if(entry.refresh)return entry.refresh;
    const job=(async()=>{
      const cookies=await ownCookies(entry);
      if(disposed||ticket!==entry.generation||cookieTicket!==entry.webCookieGeneration)return {provider,windowOpen:false,embedded:true,sessionSaved:false,playbackTicketAvailable:false,apiConnected:false};
      const values=Object.fromEntries(cookies.filter(item=>item?.value).map(item=>[item.name,item.value]));
      const user=String(values.wxopenid?values.wxuin||values.uin||values.p_uin:values.uin||values.qqmusic_uin||values.wxuin||values.p_uin||'').replace(/\D/g,'');
      const playbackTicketAvailable=provider==='qq'&&!!user&&!!(values.qm_keyst||values.qqmusic_key||values.music_key||values.wxskey);
      entry.saved=cookies.length>0||(['qishui','spotify'].includes(provider)&&await adapter(entry).hasSession?.()===true);
      if(provider==='spotify'&&!entry.saved)entry.webProfile=null;
      if(provider==='spotify'&&(values.sp_dc||spotifyPlayerOpen(entry))&&(verifyWeb||Date.now()-entry.webCheckedAt>30000)){
        entry.webCheckedAt=Date.now();
        const profile=await verifySpotifyWebSession({network:entry.network,views:spotifyViews(entry)});
        if(disposed||ticket!==entry.generation||cookieTicket!==entry.webCookieGeneration)return {provider,windowOpen:false,embedded:true,sessionSaved:false,apiConnected:false};
        entry.webProfile=profile;
        if(profile&&entry.views.length){entry.message='';close({provider});}
      }
      try{await entry.network.flushStorageData?.();}catch{}
      return {provider,windowOpen:entry.views.length>0,embedded:true,sessionSaved:entry.saved,playbackTicketAvailable,requestedMethod:provider==='qq'?entry.method:null,methodApplied:entry.methodApplied,apiConnected:!!entry.adapter?.getProfile(),profile:entry.adapter?.getProfile()||null,webAuthenticated:!!entry.webProfile,webProfile:entry.webProfile?{...entry.webProfile}:null,message:entry.message};
    })();
    entry.refresh=job;try{return await job;}finally{if(entry.refresh===job)entry.refresh=null;}
  }
  function observeSpotifyPlayer(web){
    const entry=providerEntry('spotify'),timers=new Set();let stopped=false;
    entry.playerViews.add(web);
    const clear=()=>{for(const timer of timers)clearTimeout(timer);timers.clear();};
    const refresh=()=>{
      clear();
      // A retained official page may expose its display name/avatar after the
      // initial account response. Enrich it only during bounded page hydration.
      for(const delay of [0,...SPOTIFY_VERIFY_DELAYS]){
        const timer=setTimeout(async()=>{
          timers.delete(timer);
          if(stopped||disposed||web.isDestroyed())return;
          try{const value=await status({provider:'spotify'},true);if(!stopped&&!disposed)onStatus(value);}catch{}
        },delay);timer.unref?.();timers.add(timer);
      }
    };
    const navigation=(_event,_url,isMainFrame)=>{if(isMainFrame!==false)refresh();};
    function stop(){
      if(stopped)return;stopped=true;clear();entry.playerViews.delete(web);playerObservers.delete(stop);
      web.removeListener('dom-ready',refresh);web.removeListener('did-finish-load',refresh);web.removeListener('did-navigate-in-page',navigation);web.removeListener('destroyed',stop);
    }
    web.on('dom-ready',refresh);web.on('did-finish-load',refresh);web.on('did-navigate-in-page',navigation);web.on('destroyed',stop);playerObservers.add(stop);
    return stop;
  }
  function resize(entry){
    if(!entry.owner||entry.owner.isDestroyed()||!entry.bounds)return;
    try{const bounds=panelBounds(entry.bounds,entry.owner);for(const record of entry.views)record.view.setBounds(bounds);}catch{close({provider:entry.provider});}
  }
  function removeView(entry,record){
    if(record.timer!==null)clearTimeout(record.timer);
    const at=entry.views.indexOf(record);if(at<0)return;
    entry.views.splice(at,1);
    if(entry.owner&&!entry.owner.isDestroyed())entry.owner.contentView.removeChildView(record.view);
    if(!record.view.webContents.isDestroyed())record.view.webContents.close({waitForBeforeUnload:false});
    const parent=entry.views.at(-1)?.view.webContents;
    if(parent&&!parent.isDestroyed())parent.focus?.();
    if(!entry.views.length)entry.changed();
  }
  function createView(entry,preferences={}){
    const view=new WebContentsView({webPreferences:{...preferences,session:entry.network,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,webviewTag:false,sandbox:true,webSecurity:true,backgroundThrottling:true,spellcheck:false,preload:undefined}});
    const record={view,timer:null};entry.views.push(record);
    entry.owner.contentView.addChildView(view);view.setBounds(entry.bounds);view.setBackgroundColor?.('#15161b');
    const web=view.webContents;
    const activate=()=>activateLogin(web,entry.provider,entry.method).then(result=>{if(!web.isDestroyed()){entry.methodApplied=result?.methodApplied===true;entry.changed();}}).catch(()=>{});
    const navigation=(event,url)=>{
      if(!trustedURL(entry.provider,url)){
        event.preventDefault();entry.message='此登录跳转未获允许，请返回平台登录页面重试';entry.changed();
      }else if(entry.provider==='spotify'&&new URL(url).hostname.startsWith('accounts.google.')){
        entry.message='Google 不支持内嵌网页授权，VPN 无法解除此限制。可返回使用 Spotify 邮箱登录。';entry.changed();
      }
    };
    web.on('will-navigate',navigation);web.on('will-redirect',navigation);
    web.on('did-fail-load',(_event,errorCode,errorDescription,_url,isMainFrame)=>{
      if(!isMainFrame||errorCode===-3||disposed||web.isDestroyed())return;
      entry.message=loginLoadMessage(entry.provider,{code:errorDescription});entry.changed();
    });
    web.on('will-attach-webview',event=>event.preventDefault());
    web.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'){event.preventDefault();close({provider:entry.provider});}});
    web.setWindowOpenHandler(({url})=>{
      // Official OAuth pages often create a blank child synchronously and set
      // its location afterwards. Its real navigation remains domain-checked.
      const blank=(url===''||url==='about:blank')&&trustedURL(entry.provider,web.getURL());
      if((!blank&&!trustedURL(entry.provider,url))||entry.views.length>=3)return {action:'deny'};
      // Electron preserves window.opener for official OAuth callbacks while the
      // child paints in the same host rectangle. No external window is created.
      return {action:'allow',outlivesOpener:true,createWindow:options=>createView(entry,options.webPreferences).view.webContents};
    });
    web.on('did-finish-load',()=>{
      if(disposed||web.isDestroyed()||!trustedURL(entry.provider,web.getURL()))return;
      if(entry.provider==='spotify'){entry.webCheckedAt=0;if(spotifyPlayerOpen(entry))scheduleWebRetries(entry);}
      activate();if(record.timer!==null)clearTimeout(record.timer);
      record.timer=setTimeout(()=>{record.timer=null;if(!disposed&&!web.isDestroyed())activate();},650);record.timer.unref?.();entry.changed();
    });
    web.on('did-navigate-in-page',(_event,_url,isMainFrame)=>{
      if(disposed||web.isDestroyed()||isMainFrame===false||entry.provider!=='spotify'||!spotifyPlayerOpen(entry))return;
      scheduleWebRetries(entry);entry.changed();
    });
    web.on('destroyed',()=>{
      const unexpected=entry.views.includes(record);
      removeView(entry,record);
      // A provider's window.close() must not dismiss the whole Sonara account
      // sheet. Reopen its entry once if it closed the only embedded view.
      if(unexpected&&!entry.views.length&&entry.provider==='spotify'&&!entry.recovered&&entry.owner&&!entry.owner.isDestroyed()&&!disposed){
        entry.recovered=true;entry.message='登录页面已返回，可继续登录';
        const restored=createView(entry);restored.view.webContents.loadURL(PROVIDERS.spotify.entry).catch(error=>{
          if(disposed||restored.view.webContents.isDestroyed()||navigationAborted(error))return;
          entry.message=loginLoadMessage(entry.provider,error);entry.changed();
        });
      }
    });
    return record;
  }
  function close({provider}={}){
    for(const entry of entries.values())if(!provider||provider===entry.provider)entry.qr?.cancel();
    if(!provider)for(const entry of entries.values())if(entry.provider==='qishui')entry.adapter?.closeQr();
    const entry=entries.get(provider||active?.provider);if(!entry)return {windowOpen:false,embedded:true};
    if(entry.provider==='qishui')entry.adapter?.closeQr();
    entry.generation++;entry.refresh=null;cancelWebRetries(entry);
    if(entry.owner){entry.owner.removeListener('resize',entry.resize);entry.owner.removeListener('closed',entry.closed);}
    for(const record of [...entry.views].reverse())removeView(entry,record);
    entry.owner=null;entry.bounds=null;if(active===entry)active=null;
    entry.network.flushStorageData?.();if(!entry.playerViews.size)entry.network.closeAllConnections?.();
    return {provider:entry.provider,windowOpen:false,embedded:true};
  }
  function setBounds({provider,bounds}={}){
    if(provider==='qishui')adapter(providerEntry(provider)).setBounds({bounds});
    const entry=entries.get(provider);if(!entry||!entry.owner||!entry.views.length)return {provider,windowOpen:false,embedded:true};
    entry.bounds=panelBounds(bounds,entry.owner);resize(entry);return {provider,windowOpen:true,embedded:true};
  }
  async function open({provider,method='qq',bounds}={}){
    const entry=providerEntry(provider),owner=getHostWindow();
    if(!owner||owner.isDestroyed())throw new Error('请先打开音乐面板');
    const frame=panelBounds(bounds,owner);
    if(active&&active!==entry)close({provider:active.provider});
    entry.method=QQ_METHODS.includes(method)?method:'qq';entry.methodApplied=false;entry.message='';entry.recovered=false;
    if(entry.owner===owner&&entry.views.length){
      entry.bounds=frame;resize(entry);const web=entry.views.at(-1).view.webContents;web.focus?.();
      try{const result=await activateLogin(web,provider,entry.method);entry.methodApplied=result?.methodApplied===true;}catch{}
      return status({provider});
    }
    if(entry.views.length)close({provider});
    entry.owner=owner;entry.bounds=frame;active=entry;
    entry.resize=()=>resize(entry);entry.closed=()=>close({provider});owner.on('resize',entry.resize);owner.on('closed',entry.closed);
    const ticket=++entry.generation;entry.webRetryStarted=false;
    const record=createView(entry),web=record.view.webContents;
    try{await web.loadURL(PROVIDERS[provider].entry);}
    catch(error){
      if(disposed||ticket!==entry.generation)return {provider,windowOpen:false,embedded:true,apiConnected:false};
      // OAuth can replace or close its opener before the initial load promise
      // settles. Keep the surviving child and let its navigation finish.
      if(web.isDestroyed()||navigationAborted(error))return status({provider});
      const fallback=PROVIDERS[provider].fallback;
      if(fallback){
        try{await web.loadURL(fallback);}catch(fallbackError){
          if(!navigationAborted(fallbackError)&&!web.isDestroyed()){entry.message=loginLoadMessage(provider,fallbackError);entry.changed();}
        }
      }else{entry.message=loginLoadMessage(provider,error);entry.changed();}
    }
    if(disposed||ticket!==entry.generation)return {provider,windowOpen:false,embedded:true,apiConnected:false};
    web.focus?.();return status({provider});
  }
  async function request(payload={}){
    const entry=providerEntry(payload.provider);
    if(['qq','kugou'].includes(entry.provider)&&['qrCreate','qrCheck','closeQr'].includes(payload.action)){
      if(!entry.qr)entry.qr=require('./platform-qr.cjs').createPlatformQR({
        electron,network:entry.network,provider:entry.provider,entryURL:PROVIDERS[entry.provider].entry,trustedURL,activateLogin,
        hasCredentials:async()=>{
          const cookies=Object.fromEntries((await ownCookies(entry)).map(item=>[item.name,item.value]));
          return entry.provider==='qq'?!!(cookies.uin||cookies.qqmusic_uin||cookies.wxuin)&&!!(cookies.qm_keyst||cookies.qqmusic_key||cookies.music_key||cookies.wxskey):!!(cookies.userid||cookies.KuGoo)&&!!cookies.token;
        },
        hasSession:async()=>{
          if(entry.provider!=='qq')return false;
          const cookies=Object.fromEntries((await ownCookies(entry)).map(item=>[item.name,item.value]));
          return !!(cookies.uin||cookies.qqmusic_uin||cookies.wxuin||cookies.p_uin)&&!!(cookies.p_skey||cookies.skey||cookies.psrf_qqaccess_token||cookies.psrf_qqrefresh_token||cookies.wxrefresh_token);
        },
        verify:()=>adapter(entry).request({action:'profile'}),onConfirmed:()=>entry.changed()
      });
      if(payload.action==='qrCreate')return entry.qr.create(payload);
      if(payload.action==='qrCheck')return entry.qr.check(payload);
      return entry.qr.cancel();
    }
    const current=adapter(entry);
    let result;
    if(entry.provider==='qishui'&&payload.action==='qrCreate')result=await current.qrCreate(payload);
    else if(entry.provider==='qishui'&&payload.action==='qrCheck')result=await current.qrCheck(payload);
    else if(entry.provider==='qishui'&&payload.action==='closeQr'){await current.closeQr();result={cancelled:true};}
    else result=await current.request(payload);
    if(payload.action==='profile')entry.changed();
    return result;
  }
  async function logout({provider}={}){
    const entry=providerEntry(provider);entry.adapter?.cancel();close({provider});
    if(['qishui','spotify'].includes(entry.provider))await entry.adapter?.logout();
    if(entry.timer!==null){clearTimeout(entry.timer);entry.timer=null;}
    await entry.network.clearStorageData({storages:['cookies','localstorage','indexdb','cachestorage','serviceworkers']});
    await entry.network.clearCache?.();entry.saved=false;
    entry.webProfile=null;entry.webCheckedAt=0;
    const result={provider,windowOpen:false,embedded:true,sessionSaved:false,playbackTicketAvailable:false,apiConnected:false};onStatus(result);return result;
  }
  async function dispose(){
    if(disposed)return;
    disposed=true;
    for(const stop of [...playerObservers])stop();
    for(const entry of entries.values()){
      entry.qr?.dispose();
      await entry.adapter?.dispose();close({provider:entry.provider});if(entry.timer!==null)clearTimeout(entry.timer);
      entry.network.cookies.removeListener?.('changed',entry.cookieChanged);
      try{await entry.network.flushStorageData?.();}catch{}
      await entry.network.closeAllConnections?.();
    }
    entries.clear();
  }
  return {open,status,setBounds,close,request,logout,dispose,observeSpotifyPlayer};
}
module.exports={createPlatformLogin,trustedURL,loginScript,activateLogin,panelBounds,PROVIDERS,QQ_METHODS};
