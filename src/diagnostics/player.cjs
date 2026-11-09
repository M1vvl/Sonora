'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){const value=await test();if(value)return value;await sleep(125);}throw new Error('Playback check timed out');}
function strings(value){if(typeof value==='string')return [value];if(Array.isArray(value))return value.flatMap(strings);if(value&&typeof value==='object')return Object.values(value).flatMap(strings);return [];}
async function checkEmbeddedPlayer({electron,root,out,owner,nativeOptions,dataDir,plan,onProgress}){
  const {BrowserWindow,nativeImage}=electron;
  fs.mkdirSync(out,{recursive:true});
  const result={startedAt:new Date().toISOString(),root,checks:{},progress:[],modes:{}};
  const originalURL=owner.webContents.getURL(),originalWindows=BrowserWindow.getAllWindows().length;
  await owner.webContents.executeJavaScript("window.__pulsePlaybackNode=document.getElementById('anime-view')||document.body");
  const originalChildren=owner.contentView.children.length;
  const {createAnimePlayer}=require(path.join(root,'src/anime-player.cjs'));
  const {shaderPaths}=require(path.join(root,'src/player-settings.cjs'));
  let server,player;
  try{
    player=createAnimePlayer({electron,root,dataDir,getHostWindow:()=>owner,muted:true,nativeOptions:{...nativeOptions,diagnostic:true},onProgress:async value=>{result.progress.push(value);await onProgress?.(value);}});
    await player.open(plan);
    result.console=[];player.getContents().on('console-message',event=>{if(event.level==='error')result.console.push({level:event.level,message:event.message});});
    await until(async()=>{if(player.getStatus().engine==='html5'){const state=await player.getContents().executeJavaScript('window.animePlayer.get()');throw new Error(state.notice||'Native engine fell back');}return player.getStatus().video?.position>1;});
    const web=player.getContents(),control=(type,value)=>player.getContents().executeJavaScript(`window.animePlayer.action('control',${JSON.stringify({type,value})})`);
    result.playback=player.getStatus();
    result.dom=await player.getContents().executeJavaScript(`({ready:document.readyState,hidden:document.hidden,model:typeof window.PulsePlayerSettings,ui:typeof window.PulseAnimePlayer,dataset:{...document.body.dataset},text:document.body.innerText.slice(-500),box:document.getElementById('video-stage').getBoundingClientRect().toJSON()})`);
    result.checks.videoViewport=!!result.playback.viewport&&result.playback.viewport.width>300&&result.playback.viewport.height>200;
    result.checks.embeddedSingleWindow=BrowserWindow.getAllWindows().length===originalWindows&&owner.contentView.children.length===originalChildren+1;
    result.checks.nativeRealVideo=result.playback.engine==='native'&&result.playback.video.duration>10;
    result.checks.sandboxedPlayback=await web.executeJavaScript(`!!window.animePlayer&&!window.pulse&&typeof require==='undefined'`);
    result.checks.fullPlayerInterface=await web.executeJavaScript(`innerWidth===${owner.getContentSize()[0]}&&innerHeight===${owner.getContentSize()[1]}&&!document.querySelector('.dashboard-rail')`);
    result.checks.removedPlayerClutter=await web.executeJavaScript(`!document.getElementById('video-resolution')&&!document.getElementById('screenshot')&&!document.querySelector('.playback-status')&&!document.getElementById('episode-name')&&!document.getElementById('play-state')`);
    const removed=await control('screenshot');result.checks.removedScreenshotAction=typeof player.getNative().screenshot==='undefined'&&!!removed.error;
    await control('togglePause');await until(()=>player.getStatus().video?.paused===true);
    await control('seek',35);await until(()=>Math.abs(player.getStatus().video?.position-35)<1);
    await control('speed',1.25);await until(()=>player.getStatus().video?.speed===1.25);
    result.checks.seekPauseSpeed=true;
    await control('brightness',8);const settings=await web.executeJavaScript('window.animePlayer.get()');result.checks.pictureSettings=settings.settings.brightness===8;
    await control('brightness',0);
    // Exercise the real preload/IPC observer boundary, without moving the user's
    // mouse or creating a visible verification window.
    const geometry=()=>web.executeJavaScript(`({hidden:document.body.dataset.chromeHidden==='true',header:document.querySelector('.player-header').getBoundingClientRect().height,footer:document.querySelector('.player-controls').getBoundingClientRect().height,video:document.getElementById('video-stage').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight})`);
    web.send('anime-player:pointer',{insideApp:true,insideVideo:true,x:400,y:300,changed:true});
    await until(async()=>!(await geometry()).hidden);result.visibleGeometry=await geometry();
    await until(async()=>{const g=await geometry();return g.hidden&&g.header===0&&g.footer===0;},5000);await sleep(100);result.hiddenGeometry=await geometry();
    result.checks.coordinatedIdleHide=result.visibleGeometry.header>0&&result.visibleGeometry.footer>0&&result.hiddenGeometry.header===0&&result.hiddenGeometry.footer===0&&Math.abs(result.hiddenGeometry.video.height-result.hiddenGeometry.height)<1;
    web.send('anime-player:pointer',{insideApp:true,insideVideo:true,x:410,y:300,changed:true});await until(async()=>!(await geometry()).hidden);
    web.send('anime-player:pointer',{insideApp:false,insideVideo:false,x:-1,y:-1,changed:true});await until(async()=>{const g=await geometry();return g.hidden&&g.header===0&&g.footer===0;},1500);result.checks.outsideAppHide=true;
    web.send('anime-player:pointer',{insideApp:true,insideVideo:true,x:420,y:300,changed:true});await until(async()=>!(await geometry()).hidden);
    await web.executeJavaScript(`document.getElementById('picture-toggle').click()`);await sleep(2800);
    result.checks.menuHoldsChrome=!(await geometry()).hidden;
    await web.executeJavaScript(`document.getElementById('picture-toggle').click()`);
    await until(async()=>{const g=await geometry();return g.hidden&&g.header===0&&g.footer===0;},5000);await sleep(100);
    result.aspect=await player.getNative().requestStats();
    const aspectOK=stats=>{const v=stats.videoOutput||stats.video,d=stats.osdDimensions;if(!v||!d||stats.aspectOverride!==-1||stats.panscan!==0)return false;const source=Number(v.dw||v.w)/Number(v.dh||v.h),display=(d.w-d.ml-d.mr)/(d.h-d.mt-d.mb);return Number.isFinite(display)&&Math.abs(source-display)<.025;};
    result.checks.nativeSourceAspect=aspectOK(result.aspect);
    await control('fullscreen');await until(()=>owner.isFullScreen());await sleep(350);
    web.send('anime-player:pointer',{insideApp:true,insideVideo:true,x:430,y:300,changed:true});await until(async()=>!(await geometry()).hidden);
    await until(async()=>{const g=await geometry();return g.hidden&&g.header===0&&g.footer===0;},5000);await sleep(100);result.fullscreenGeometry=await geometry();result.fullscreenAspect=await player.getNative().requestStats();
    result.checks.fullscreenFullViewport=result.fullscreenGeometry.header===0&&result.fullscreenGeometry.footer===0&&Math.abs(result.fullscreenGeometry.video.width-result.fullscreenGeometry.width)<1&&Math.abs(result.fullscreenGeometry.video.height-result.fullscreenGeometry.height)<1&&aspectOK(result.fullscreenAspect);
    await web.executeJavaScript(`document.getElementById('volume').focus();document.getElementById('volume').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
    await until(()=>!owner.isFullScreen());result.checks.escapeFromFocusedControls=true;await sleep(250);
    await control('fullscreen');await until(()=>owner.isFullScreen());
    await player.getNative().diagnosticEscape();await until(()=>!owner.isFullScreen());result.checks.escapeFromNativeVideo=true;
    const keyEvent={preventDefault(){this.prevented=true;}};
    await control('fullscreen');await until(()=>owner.isFullScreen());web.emit('before-input-event',keyEvent,{type:'keyDown',key:'Escape'});await until(()=>!owner.isFullScreen());result.checks.escapeMainInputFallback=keyEvent.prevented===true;
    await sleep(250);
    await player.getNative().captureFrame(path.join(out,'video.png'));
    await player.close();
    result.checks.backRestoresOriginalPage=!player.getStatus().open&&owner.contentView.children.length===originalChildren&&owner.webContents.getURL()===originalURL&&await owner.webContents.executeJavaScript("window.__pulsePlaybackNode===(document.getElementById('anime-view')||document.body)");
    result.checks.progressSaved=result.progress.some(value=>value.position>=30);
    await player.open(plan);await until(()=>player.getStatus().video?.position>1);
    const backend=player.getNative();
    // The real picture panel holds chrome visible. Pixel comparisons must use
    // one fixed viewport rather than race automatic control-bar hiding.
    await player.getContents().executeJavaScript(`document.getElementById('picture-toggle').click()`);
    await until(()=>player.getContents().executeJavaScript(`!document.getElementById('player-panel').hidden&&document.body.dataset.chromeHidden==='false'&&document.body.dataset.chromeCollapsed==='false'`));
    await sleep(250);
    await until(async()=>{const d=(await backend.requestStats()).osdDimensions,v=player.getStatus().viewport;return d&&v&&d.w===v.width&&d.h===v.height;});
    const fixedViewport=player.getStatus().viewport;result.shaderViewport=fixedViewport;
    await player.getContents().executeJavaScript(`window.animePlayer.action('control',{type:'outputResolution',value:'auto'})`);
    const image=nativeImage.createFromPath(path.join(out,'video.png')).resize({width:320}).toPNG();
    server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'image/png','content-length':image.length});response.end(image);});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    await backend.load({url:'http://127.0.0.1:'+server.address().port+'/frame.png',headers:{},start:0,muted:true});
    await sleep(1000);
    for(const mode of ['off','efficiency','quality']){
      await backend.command('change-list',['glsl-shaders',mode==='off'?'clr':'set',shaderPaths(mode,nativeOptions.shaderDirectory).join(';')]);
      await sleep(1000);
      const stats=await backend.requestStats();
      await backend.captureFrame(path.join(out,mode+'.png'));
      const rendered=nativeImage.createFromPath(path.join(out,mode+'.png')),bitmap=rendered.toBitmap();
      result.modes[mode]={size:rendered.getSize(),pixelDigest:crypto.createHash('sha256').update(bitmap).digest('hex'),shaderNames:strings(stats.voPasses).filter(name=>name.includes('Anime4K')),stats};
    }
    result.checks.efficiencyShaderExecution=result.modes.efficiency.shaderNames.some(name=>/Upscale.*CNN/i.test(name))&&result.modes.efficiency.stats.shaders?.length===7;
    result.checks.qualityShaderExecution=result.modes.quality.shaderNames.some(name=>/Upscale.*CNN/i.test(name))&&result.modes.quality.stats.shaders?.length===6;
    result.checks.processedImageSize=Object.values(result.modes).every(mode=>mode.size.width>300&&mode.size.height>200&&mode.size.width===fixedViewport.width&&mode.size.height===fixedViewport.height&&mode.stats.osdDimensions?.w===fixedViewport.width&&mode.stats.osdDimensions?.h===fixedViewport.height);
    result.checks.superResolutionChangesPixels=result.modes.off.pixelDigest!==result.modes.efficiency.pixelDigest&&result.modes.off.pixelDigest!==result.modes.quality.pixelDigest;
    result.outputTargets={};
    for(const [value,width,height]of [['1080p',1920,1080],['1440p',2560,1440],['2160p',3840,2160]]){
      await player.getContents().executeJavaScript(`window.animePlayer.action('control',{type:'outputResolution',value:${JSON.stringify(value)}})`);await sleep(500);
      const stats=await backend.requestStats();result.outputTargets[value]=stats;
      result.checks['gpuTarget'+value]=strings(stats.voPasses).some(name=>name.includes(`AgentPulse GPU target ${width}x${height}`));
    }
    await player.getContents().executeJavaScript(`window.animePlayer.action('control',{type:'outputResolution',value:'auto'})`);
    await control('superResolution','off');
    await player.getContents().executeJavaScript(`window.animePlayer.action('close')`).catch(()=>{});
    await sleep(200);
    result.checks.backRestoresOriginalPage=result.checks.backRestoresOriginalPage&&!player.getStatus().open&&owner.contentView.children.length===originalChildren;
    result.checks.nativeReleased=player.getNative()===null;
  }catch(error){result.error=error.stack;result.status=player?.getStatus();if(player?.getContents())result.publicState=await player.getContents().executeJavaScript('window.animePlayer.get()').catch(()=>null);}
  finally{await player?.dispose();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'player-report.json'),JSON.stringify(result,null,2));}
  return result;
}
module.exports={checkEmbeddedPlayer};
