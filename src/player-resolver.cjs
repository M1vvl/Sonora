'use strict';
const {randomUUID}=require('node:crypto');
function webURL(value){try{const url=new URL(value);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function mediaFormat(url,type=''){const safe=webURL(url);if(!safe)return null;const name=new URL(safe).pathname;if(/\.m3u8$/i.test(name)||/(?:application|audio)\/(?:vnd\.apple\.mpegurl|x-mpegurl|mpegurl)/i.test(type))return'hls';if(/\.(?:mp4|webm|m4v|mov)$/i.test(name)||/^video\/(?:mp4|webm|quicktime)/i.test(type))return'video';return null;}
function createVideoResolver({electron,getPlayerContents}){
  const {BrowserWindow,session}=electron;
  const network=session.fromPartition(`anime-player-${randomUUID()}`);
  let child=null,active=null,plan=null,media=null,disposed=false;
  network.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));network.setPermissionCheckHandler(()=>false);
  network.on('will-download',event=>event.preventDefault());
  function found(url,format,referrer){if(!active||!webURL(url))return;const current=active;active=null;clearTimeout(current.timer);media={url,format,referrer:plan.rule.referer||webURL(referrer)||plan.episode.url};queueMicrotask(()=>{child?.destroy();child=null;current.resolve(media);});}
  network.webRequest.onBeforeRequest((details,cb)=>{const allowed=/^(https?:|file:|data:|blob:|devtools:)/.test(details.url);if(allowed&&child&&details.webContentsId===child.webContents.id){const format=mediaFormat(details.url);if(format)found(details.url,format,details.referrer);}cb({cancel:!allowed});});
  network.webRequest.onBeforeSendHeaders((details,cb)=>{const headers={...details.requestHeaders};if(details.webContentsId===getPlayerContents()?.id&&webURL(details.url)&&media){for(const key of Object.keys(headers))if(/^(referer|origin|user-agent)$/i.test(key))delete headers[key];headers.Referer=media.referrer;headers.Origin=new URL(media.referrer).origin;if(plan?.rule.userAgent)headers['User-Agent']=plan.rule.userAgent;}cb({requestHeaders:headers});});
  network.webRequest.onHeadersReceived((details,cb)=>{const headers={...details.responseHeaders};if(child&&details.webContentsId===child.webContents.id){const type=Object.entries(headers).find(([key])=>key.toLowerCase()==='content-type')?.[1]?.[0]||'',format=mediaFormat(details.url,type);if(format)found(details.url,format,plan?.episode.url);}if(details.webContentsId===getPlayerContents()?.id&&webURL(details.url)){for(const key of Object.keys(headers))if(/^access-control-/i.test(key))delete headers[key];headers['Access-Control-Allow-Origin']=['*'];headers['Access-Control-Allow-Headers']=['*'];headers['Access-Control-Expose-Headers']=['Content-Length, Content-Range, Accept-Ranges'];}cb({responseHeaders:headers});});
  function cancel(){const current=active;active=null;if(current){clearTimeout(current.timer);current.reject(Object.assign(new Error('视频解析已取消'),{name:'AbortError'}));}child?.destroy();child=null;}
  return {session:network,async resolve(value){
    if(disposed)throw new Error('视频解析器已关闭');cancel();plan=value;media=null;
    const supplied=webURL(plan.media?.url),direct=mediaFormat(supplied||plan.episode.url,plan.media?.contentType||'');if(direct){media={url:supplied||plan.episode.url,format:direct,referrer:plan.rule.referer||plan.episode.url};return media;}
    return new Promise((resolve,reject)=>{
      active={resolve,reject,timer:setTimeout(()=>{const current=active;active=null;child?.destroy();child=null;current?.reject(new Error('该来源暂未解析到可播放的视频，请返回详情切换线路。'));},25000)};
      child=new BrowserWindow({show:false,width:960,height:600,webPreferences:{session:network,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:true,autoplayPolicy:'no-user-gesture-required'}});
      child.webContents.setAudioMuted(true);child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      for(const eventName of ['will-navigate','will-redirect'])child.webContents.on(eventName,(event,url)=>{if(!webURL(url))event.preventDefault();});
      child.webContents.on('did-finish-load',()=>child?.webContents.executeJavaScript("document.querySelectorAll('video').forEach(v=>{v.muted=true;v.play().catch(()=>{});})").catch(()=>{}));
      child.loadURL(plan.episode.url,{userAgent:plan.rule.userAgent||undefined,extraHeaders:plan.rule.referer?`Referer: ${plan.rule.referer}\r\n`:undefined}).catch(()=>{});
    });
  },cancel,getStatus:()=>({resolving:!!active,remoteWindow:!!child}),async dispose(){disposed=true;cancel();network.webRequest.onBeforeRequest(null);network.webRequest.onBeforeSendHeaders(null);network.webRequest.onHeadersReceived(null);await network.closeAllConnections();await network.clearStorageData();}};
}
module.exports={createVideoResolver,webURL,mediaFormat};
