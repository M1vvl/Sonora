'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {snapshotScript,playerSnapshotScript,targetScript}=require('./spotify-dom.cjs');
const {operationScript}=require('./spotify-dom-actions.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function createSpotifyBrowserBridge({dataDir,getCookies=async()=>[],browserPath,spawnImpl=spawn}={}){
  const profile=path.join(dataDir,'spotify-browser-pilot');
  let child=null,socket=null,sessionId=null,targetId=null,seq=0,disposed=false,opening=null;
  const pending=new Map();
  function send(method,params={},session=sessionId){
    if(!socket||socket.readyState!==1)return Promise.reject(new Error('验证浏览器未连接'));
    if(pending.size>=32)return Promise.reject(new Error('网页操作繁忙，请稍后重试'));
    const id=++seq;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Spotify 网页操作超时'));},12000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
  }
  async function open(){
    if(disposed)throw new Error('网页中转已关闭');if(socket?.readyState===1)return;if(opening)return opening;
    opening=(async()=>{
      const candidates=browserPath?[browserPath]:[path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe')];
      let executable;for(const file of candidates)try{await fs.access(file);executable=file;break;}catch{}
      if(!executable)throw new Error('未找到支持 DRM 的 Edge 或 Chrome');
      await fs.mkdir(profile,{recursive:true});const portFile=path.join(profile,'DevToolsActivePort');await fs.rm(portFile,{force:true});
      child=spawnImpl(executable,['--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--start-minimized','--disk-cache-size=20971520','--media-cache-size=1','--app=https://open.spotify.com/'],{windowsHide:true,stdio:'ignore'});
      let launchError;child.once('error',error=>{launchError=error;});
      let address;
      for(let attempt=0;attempt<60;attempt++){
        if(disposed)throw new Error('网页中转已关闭');if(launchError)throw new Error('验证浏览器启动失败');
        try{const [port,route]=(await fs.readFile(portFile,'utf8')).trim().split(/\r?\n/);if(/^\d{2,5}$/.test(port)&&+port<65536&&/^\/devtools\/browser\/[\w-]+$/.test(route)){address='ws://127.0.0.1:'+port+route;break;}}catch{}
        await delay(250);
      }
      if(!address)throw new Error('未能连接独立验证浏览器，请关闭上一次验证窗口后重试');
      socket=new WebSocket(address);
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('验证连接超时')),5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('验证连接失败'));},{once:true});});
      socket.addEventListener('message',event=>{let value;try{value=JSON.parse(event.data);}catch{return;}const job=pending.get(value.id);if(!job)return;pending.delete(value.id);clearTimeout(job.timer);value.error?job.reject(new Error('浏览器未完成操作：'+String(value.error.message).slice(0,120))):job.resolve(value.result);});
      socket.addEventListener('close',()=>{for(const job of pending.values()){clearTimeout(job.timer);job.reject(new Error('验证浏览器已断开'));}pending.clear();});
      const targets=await send('Target.getTargets',{},null);let page=targets.targetInfos.find(item=>item.type==='page'&&item.url.startsWith('https://open.spotify.com/'));
      if(!page)page=await send('Target.createTarget',{url:'https://open.spotify.com/'},null);
      targetId=page.targetId;sessionId=(await send('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
      await send('Page.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:false});
      const existing=await send('Network.getCookies',{urls:['https://open.spotify.com/']});
      const ownedCookies=await getCookies();const ownedKey=ownedCookies.find(item=>item.name==='sp_dc'&&/^\.?spotify\.com$/.test(item.domain))?.value;
      if(ownedKey&&existing.cookies?.find(item=>item.name==='sp_dc')?.value!==ownedKey){
        // Import only Sonara's own Spotify session into Sonara's dedicated
        // browser profile, never another app/browser's saved credentials.
        const cookies=ownedCookies.filter(item=>['sp_dc','sp_key'].includes(item.name)&&/^\.?spotify\.com$/.test(item.domain)).map(item=>({name:item.name,value:item.value,domain:item.domain,path:item.path||'/',secure:true,httpOnly:!!item.httpOnly,...(item.expirationDate>0?{expires:item.expirationDate}:{})}));
        if(cookies.length){await send('Network.setCookies',{cookies});await send('Page.navigate',{url:'https://open.spotify.com/'});}
      }
    })().catch(async error=>{await close();throw error;}).finally(()=>{opening=null;});return opening;
  }
  async function evaluate(expression){const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(value.exceptionDetails)throw new Error(String(value.exceptionDetails.exception?.description||'Spotify 页面尚未就绪').split('\n')[0].slice(0,180));return value.result?.value;}
  async function read(){await open();const value=await evaluate(snapshotScript);if(!value||!Array.isArray(value.playlists)||!Array.isArray(value.songs))throw new Error('网页返回无效资料');return value;}
  async function readPlayer(){await open();return evaluate(playerSnapshotScript);}
  async function navigate(route, {songs = false} = {}) {
    if (!/^\/(?:collection\/(?:playlists|tracks)|search\/[^?#]{1,500}|playlist\/[A-Za-z0-9]{22}|)$/.test(route)) throw new Error('无效音乐页面');
    await open();
    const before = await read();
    if (route === '/collection/playlists' && before.library?.length) return {...before,playlists:before.library};
    const clickRoute = async () => {
      return evaluate(`(()=>{const route=${JSON.stringify(route)};const link=[...document.querySelectorAll('a[href]')].find(node=>node.getAttribute('href')===route);const key=route.startsWith('/playlist/')?'listrow-title-spotify:playlist:'+route.slice(10):route==='/collection/tracks'?'listrow-title-spotify:collection:tracks':null;const title=key?document.getElementById(key):null;const target=link||title?.closest('[role="row"]')?.querySelector('[role="button"][aria-labelledby]')||title;if(!target)return false;target.click();return true;})()`);
    };
    let clicked = before.path === route || await clickRoute();
    if (!clicked && route.startsWith('/search/')) {
      const focused = await evaluate(`(()=>{const input=document.querySelector('input[data-testid="search-input"],input[role="combobox"],input[placeholder*="想听"],input[placeholder*="search" i]');if(!input)return false;input.focus();input.select();return true;})()`);
      if (focused) {
        await send('Input.dispatchKeyEvent', {type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
        await send('Input.dispatchKeyEvent', {type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
        await send('Input.insertText', {text:decodeURIComponent(route.slice(8))});
        await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        clicked = true;
      }
    }
    // Keep Spotify's existing player alive by using its own SPA controls.
    // Recommendations can be offscreen on the previous page, so return home
    // through the official Home link before locating the requested card.
    if (!clicked && route.startsWith('/playlist/')) {
      const home = await evaluate(`(()=>{const link=[...document.querySelectorAll('a[href]')].find(node=>node.getAttribute('href')==='/');if(!link)return false;link.click();return true;})()`);
      if (home) {
        for (let attempt = 0; attempt < 12 && !clicked; attempt++) {await delay(250);clicked = await clickRoute();}
      }
    }
    if (!clicked) {
      if (before.playing) throw new Error('Spotify 页面未提供此入口，请刷新歌单后重试');
      await send('Page.navigate', {url:'https://open.spotify.com' + route});
    }
    await delay(350);
    const playlistChanged = route.startsWith('/playlist/') && before.path !== route;
    const expectedTitle = [...before.playlists,...(before.library || [])].find(item => '/playlist/' + item.id.slice(8) === route)?.title;
    for (let attempt = 0; attempt < 50; attempt++) {
      const value = await read();
      if (playlistChanged && value.heading === before.heading && (!expectedTitle || value.heading !== expectedTitle)) {await delay(400);continue;}
      if (route === '/collection/playlists' && value.library?.length) return {...value,playlists:value.library};
      const ready = route === '/' ? value.mainPlaylistCount > 0 : songs ? value.songs.length : value.playlists.length;
      if (value.path === route && (ready || value.loginRequired)) return value;
      if (value.path === route && attempt > 15 && songs && !value.songs.length && /\/collection\/tracks|\/playlist\//.test(route)) {
        const empty = await evaluate(`(()=>!!document.querySelector('[data-testid="playlist-inline-curation-results"]')||[...document.querySelectorAll('main h1,main h2,main p')].some(node=>/歌单还是空的|歌单中没有|添加一些歌曲|Playlist is empty|Let's find something|还没有喜欢的歌曲/i.test(node.innerText||'')))()`);
        if (empty) return value;
      }
      await delay(400);
    }
    throw new Error('Spotify 页面暂未显示可读取内容，请重试');
  }
  async function collect(route, options = {}) {
    return require('./spotify-collection.cjs').collectSpotify({navigate,read,wait:delay,reset:()=>evaluate(`(()=>{let node=document.querySelector('[data-testid="tracklist-row"]')?.parentElement;while(node&&node.scrollHeight<=node.clientHeight+30)node=node.parentElement;const viewport=node||document.querySelector('[data-testid="main-view-container"] [data-overlayscrollbars-viewport]')||document.scrollingElement;if(viewport)viewport.scrollTop=0;})()`),check:()=>{if(disposed)throw new Error('Spotify 网页中转已关闭');},scroll:route=>evaluate(`(()=>{const library=${JSON.stringify(route === '/collection/playlists')};const row=library?document.querySelector('[aria-label="音乐库"],[aria-label="Your Library"]'):document.querySelector('[data-testid="tracklist-row"]');let node=row?.parentElement;while(node&&node.scrollHeight<=node.clientHeight+30)node=node.parentElement;const viewport=node||document.querySelector('[data-testid="main-view-container"] [data-overlayscrollbars-viewport]')||document.scrollingElement;if(!viewport)return {atBottom:false};viewport.scrollTop+=Math.max(300,viewport.clientHeight*.8);return {atBottom:viewport.scrollTop+viewport.clientHeight>=viewport.scrollHeight-3};})()`)},route,options);
  }
  async function locateSong(id,rowNumber=0) {
    if (!(await read()).songs.some(song => song.id === id)) {
      await evaluate(`(()=>{let node=document.querySelector('[data-testid="tracklist-row"]')?.parentElement;while(node&&node.scrollHeight<=node.clientHeight+30)node=node.parentElement;if(node){const row=document.querySelector('[data-testid="tracklist-row"]'),height=row?.getBoundingClientRect().height||56;node.scrollTop=${Number.isSafeInteger(rowNumber)&&rowNumber>0&&rowNumber<=10002?rowNumber-1:0}*height;}})()`);
      await delay(180);
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      if ((await read()).songs.some(song => song.id === id)) return;
      await evaluate(`(()=>{const row=document.querySelector('[data-testid="tracklist-row"]');let node=row?.parentElement;while(node&&node.scrollHeight<=node.clientHeight+30)node=node.parentElement;if(node)node.scrollTop+=Math.max(300,node.clientHeight*.75);})()`);
      await delay(180);
    }
    throw new Error('网页暂未载入此歌曲，请重新打开歌单');
  }
  async function operation(action, payload) {
    await open();
    const result = await evaluate(operationScript(action, payload));
    if (result?.hover) await send('Input.dispatchMouseEvent', {type:'mouseMoved',...result.hover});
    if (result?.pointer) {
      await send('Input.dispatchMouseEvent', {type:'mousePressed',...result.pointer,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent', {type:'mouseReleased',...result.pointer,button:'left',clickCount:1});
    }
    return result;
  }
  async function dismissMenus() {await operation('dismiss');await delay(100);}
  async function playlist(id) {
    if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new Error('无效歌单');
    return navigate('/playlist/' + id, {songs:true});
  }
  async function capability(){await open();return evaluate(`(async()=>{try{await navigator.requestMediaKeySystemAccess('com.widevine.alpha',[{initDataTypes:['cenc'],audioCapabilities:[{contentType:'audio/mp4; codecs="mp4a.40.2"'}]}]);return {drm:true};}catch(error){return {drm:false,error:error.name};}})()`);}
  async function diagnostics(){await open();return evaluate(`(()=>({notices:[...document.querySelectorAll('[role="alertdialog"],[role="dialog"],[data-testid*="toast"]')].map(node=>(node.innerText||'').slice(0,600)).slice(0,3),nowMarkup:document.querySelector('[data-testid="now-playing-widget-v2"]')?.outerHTML.slice(0,7000),rowMarkup:document.querySelector('[data-testid="tracklist-row"]')?.outerHTML.slice(0,11000),title:document.title,path:location.pathname,tracks:document.querySelectorAll('a[href*="/track/"]').length,rows:document.querySelectorAll('[role="row"]').length,testids:[...new Set([...document.querySelectorAll('[data-testid]')].map(node=>node.dataset.testid).filter(value=>/track|list|play|row/i.test(value)))].slice(0,45),trackParents:[...document.querySelectorAll('a[href*="/track/"]')].slice(0,2).map(node=>{const parents=[];for(let i=0;node&&i<5;i++,node=node.parentElement)parents.push({tag:node.tagName,role:node.getAttribute('role'),testid:node.dataset.testid,text:(node.innerText||'').slice(0,120)});return parents;}),alerts:[...document.querySelectorAll('[role="alert"],h1')].map(node=>(node.innerText||'').slice(0,150)).slice(0,3)}))()`);}
  async function click(kind,id){await open();const point=await evaluate(targetScript(kind,id,true));if(!point)throw new Error('官方网页未显示此操作');if(point.activated)return read();const {clicks=1,activated,...coordinates}=point;for(let count=1;count<=clicks;count++){await send('Input.dispatchMouseEvent',{type:'mousePressed',...coordinates,button:'left',clickCount:count});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...coordinates,button:'left',clickCount:count});}return read();}
  async function minimize(){await open();const value=await send('Browser.getWindowForTarget',{targetId},null);await send('Browser.setWindowBounds',{windowId:value.windowId,bounds:{windowState:'minimized'}},null);}
  async function clearSession() {
    if (!socket || socket.readyState !== 1) return;
    await send('Network.clearBrowserCookies');
    await send('Storage.clearDataForOrigin', {origin:'https://open.spotify.com',storageTypes:'all'}, null);
    await send('Storage.clearDataForOrigin', {origin:'https://accounts.spotify.com',storageTypes:'all'}, null);
  }
  async function close(){sessionId=null;if(socket?.readyState===1)try{await send('Browser.close',{},null);}catch{}socket?.close();socket=null;child?.kill();child=null;}
  return {open,read,readPlayer,playlist,navigate,collect,locateSong,operation,dismissMenus,minimize,clearSession,capability,diagnostics,play:id=>click('track',id),toggle:()=>click('toggle'),close,async dispose(){disposed=true;await close();}};
}
module.exports={createSpotifyBrowserBridge};
