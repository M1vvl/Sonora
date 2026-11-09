'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {createVideoResolver,webURL,mediaFormat}=require('./player-resolver.cjs');
const {createPlayerHost}=require('./player-host.cjs');
function progressRecord(plan,value){
  if(!plan||!Number.isFinite(value?.position)||value.position<1)return null;
  return {subject:plan.subject,ruleId:plan.rule.id,episodeName:plan.episode.name,episodeUrl:plan.episode.url,roadIndex:plan.roadIndex,episodeIndex:plan.episodeIndex,
    ...(plan.sourceUrl?{sourceUrl:plan.sourceUrl}:{}),position:Math.min(7*86400,Math.max(0,value.position)),duration:Number.isFinite(value.duration)?Math.min(7*86400,Math.max(0,value.duration)):0};
}
// Composition only: resolver, embedded host, native process, preferences and
// controls have separate owners. Native frames never rebuild a catalog or chat.
function createAnimePlayer({electron,root,dataDir,getHostWindow,onProgress,onEpisode,onClosed,getTheme=()=> 'carbon-lime',nativeOptions,muted=false}){
  const {ipcMain,shell}=electron;
  const {createPlayerSettings}=require('./player-settings.cjs');
  const {processingShaders}=require('./player-output.cjs');
  const preferences=createPlayerSettings(path.join(dataDir,'player-settings.json'));
  const page=pathToFileURL(path.join(root,'ui/anime-player/player.html')).href;
  let state=null,plan=null,resolver=null,native=null,ready=false,disposed=false,generation=0,openRequest=0,lastWrite=0,frame=null,viewport=null,closing=null,commandTail=Promise.resolve(),initialFullscreen=false;
  const host=createPlayerHost({electron,getWindow:getHostWindow,preload:path.join(root,'src/anime-player-preload.cjs'),onClosed:()=>close().catch(()=>{})});
  const contents=()=>host.getContents();
  const valid=event=>!disposed&&contents()&&event.sender===contents()&&event.senderFrame?.url===page;
  const broadcast=()=>{if(ready&&state&&contents())contents().send('anime-player:state',state);};
  const patch=value=>{if(state){state={...state,...value};broadcast();}};
  const queue=job=>{const result=commandTail.catch(()=>{}).then(job);commandTail=result.catch(()=>{});return result;};
  let fullscreenCleanup=null;
  async function persistProgress(value,final=false){const record=progressRecord(plan,value);if(record&&(final||Date.now()-lastWrite>=4500)){lastWrite=Date.now();await onProgress?.(record);}}
  function sendFrame(value){if(!state)return;frame=value;if(ready&&contents())contents().send('anime-player:frame',value);persistProgress(value).catch(()=>{});}
  function ensureView(){
    if(contents())return;
    resolver=createVideoResolver({electron,getPlayerContents:contents});
    const owner=getHostWindow();initialFullscreen=owner?.isFullScreen()||false;
    const web=host.attach(resolver.session);ready=false;
    const escape=(event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'&&owner?.isFullScreen()){event.preventDefault();setFullscreen(false);}};
    const syncFullscreen=()=>patch({fullscreen:owner.isFullScreen()});
    web.on('before-input-event',escape);owner.webContents.on('before-input-event',escape);
    owner.on('enter-full-screen',syncFullscreen);owner.on('leave-full-screen',syncFullscreen);
    fullscreenCleanup=()=>{if(!web.isDestroyed())web.removeListener('before-input-event',escape);if(!owner.isDestroyed()){owner.webContents.removeListener('before-input-event',escape);owner.removeListener('enter-full-screen',syncFullscreen);owner.removeListener('leave-full-screen',syncFullscreen);}};
    web.setWindowOpenHandler(()=>({action:'deny'}));
    web.on('will-navigate',(event,url)=>{if(url!==page)event.preventDefault();});
    web.on('did-finish-load',()=>{ready=true;broadcast();});
    web.loadFile(path.join(root,'ui/anime-player/player.html'));
  }
  async function applyPreference(key,value){
    const ticket=generation,backend=native,next=preferences.preview({[key]:value});
    if(!state||state.phase!=='ready')throw new Error('正在准备播放，请稍后调整。');
    if(backend){
      if(key==='superResolution'||key==='outputResolution'){const list=processingShaders(next,nativeOptions.shaderDirectory);await backend.command('change-list',['glsl-shaders',list.length?'set':'clr',list.join(';')]);}
      else if(key==='aspect'){await backend.set('video-aspect-override',next.aspect==='16:9'?16/9:next.aspect==='4:3'?4/3:next.aspect==='fill'&&viewport?.height?viewport.width/viewport.height:-1);await backend.set('panscan',next.aspect==='cover'?1:0);}
      else if(['mute','speed','volume','brightness','contrast','saturation','gamma'].includes(key))await backend.set(key,key==='mute'?muted||next.mute:next[key]);
    }else if((key==='superResolution'&&next.superResolution!=='off')||(key==='outputResolution'&&next.outputResolution!=='auto'))throw new Error('当前兼容播放器不支持 GPU 超分输出，请重试原生引擎。');
    if(ticket!==generation||backend!==native||!state)return preferences.get();
    const saved=preferences.save({[key]:next[key]});patch({settings:saved,muted:muted||saved.mute});return saved;
  }
  async function startNative(media,ticket){
    if(!nativeOptions||!fs.existsSync(nativeOptions.executablePath)||!fs.existsSync(nativeOptions.libraryPath))throw new Error('原生视频组件不可用');
    const {createNativePlayer}=require('./native-player/index.cjs');
    const backend=createNativePlayer({...nativeOptions,parentHwnd:host.hwnd(),onState:value=>{
      if(ticket!==generation||!state)return;
      const normalized={...value,position:Number(value.position)||0,duration:Number(value.duration)||0,paused:!!value.paused,muted:!!value.mute,ended:!!value.eof,volume:Number(value.volume)||0,speed:Number(value.speed)||1};
      sendFrame(normalized);if(state.phase==='loading'&&normalized.duration>0)patch({phase:'ready'});
    },onPointer:value=>{
      if(ticket===generation&&ready&&state&&contents())contents().send('anime-player:pointer',value);
    },onInteraction:value=>{
      const interaction=typeof value==='string'?{action:value}:value;
      if(ticket!==generation||!state)return;
      if(interaction.action==='fullscreen')toggleFullscreen();
      else if(interaction.action==='togglePause')control({type:'togglePause'}).catch(()=>{});
      else if(interaction.action==='seekBackward'||interaction.action==='seekForward')control({type:'seek',value:Math.max(0,(frame?.position||0)+(interaction.action==='seekForward'?5:-5))}).catch(()=>{});
      else if(interaction.action==='exitFullscreen')setFullscreen(false);
      contents()?.focus();
    },onError:error=>{if(ticket===generation&&state)patch({phase:'error',error:String(error?.message||error)});}});
    native=backend;
    await backend.start();if(ticket!==generation){await backend.stop();return;}
    if(viewport)await backend.viewport(viewport);
    const settings=preferences.get();
    for(const key of ['volume','speed','brightness','contrast','saturation','gamma'])await backend.set(key,settings[key]);
    await backend.set('mute',muted||settings.mute);
    await backend.set('video-aspect-override',settings.aspect==='16:9'?16/9:settings.aspect==='4:3'?4/3:settings.aspect==='fill'&&viewport?.height?viewport.width/viewport.height:-1);await backend.set('panscan',settings.aspect==='cover'?1:0);
    const list=processingShaders(settings,nativeOptions.shaderDirectory);await backend.command('change-list',['glsl-shaders',list.length?'set':'clr',list.join(';')]);
    if(ticket!==generation)return;
    patch({engine:'native',phase:'loading',media:{url:media.url,format:media.format},capabilities:{superResolution:true,outputResolution:true,pictureAdjustments:true},settings});
    await backend.load({url:media.url,headers:{...(plan.rule.userAgent?{'User-Agent':plan.rule.userAgent}:{}),Referer:media.referrer},start:Math.max(0,plan.position||0),muted:muted||settings.mute});
  }
  async function resolve(){
    const ticket=++generation,currentPlan=plan,previous=native;frame=null;native=null;await previous?.stop();if(ticket!==generation)return;patch({phase:'resolving',media:null,error:null,notice:null});
    try{
      const media=await resolver.resolve(currentPlan);if(ticket!==generation)return;
      try{await startNative(media,ticket);}catch(error){if(ticket!==generation)return;await native?.stop();native=null;patch({engine:'html5',phase:'ready',media:{url:media.url,format:media.format},settings:{...preferences.get(),superResolution:'off',outputResolution:'auto'},capabilities:{superResolution:false,outputResolution:false,pictureAdjustments:false},notice:'原生引擎暂不可用，使用兼容播放：'+String(error.message).slice(0,180)});}
    }catch(error){if(ticket===generation&&state&&error.name!=='AbortError')patch({phase:'error',error:error.message});}
  }
  function setFullscreen(target){const owner=host.getWindow();if(owner){if(owner.isFullScreen()!==target)owner.setFullScreen(target);patch({fullscreen:target});}}
  function toggleFullscreen(){const owner=host.getWindow();if(owner)setFullscreen(!owner.isFullScreen());}
  async function control(value){
    if(!value||typeof value.type!=='string')throw new Error('无效的播放控制');
    if(value.type==='fullscreen'){toggleFullscreen();return;}
    if(value.type==='exitFullscreen'){setFullscreen(false);return;}
    if(value.type==='episode'){
      const index=Number(value.value),currentPlan=plan,ticket=generation;if(!Number.isInteger(index)||index<0||index>=(currentPlan.episodes?.length||0))throw new Error('无效的剧集');await persistProgress(frame,true);if(ticket!==generation)return;const next=await onEpisode?.(currentPlan,index);if(!next||ticket!==generation)return;return open(next);
    }
    if(['superResolution','outputResolution','speed','volume','mute','aspect','brightness','contrast','saturation','gamma'].includes(value.type)){const ticket=generation;return queue(()=>ticket===generation&&state?applyPreference(value.type,value.value):undefined);}
    if(!['togglePause','seek'].includes(value.type))throw new Error('未知的播放控制');
    if(!native)return {html5:true};
    if(value.type==='togglePause')return native.set('pause',!frame?.paused);
    if(value.type==='seek'){const position=Number(value.value);if(!Number.isFinite(position)||position<0)throw new Error('无效的播放进度');return native.command('seek',[String(Math.min(position,frame?.duration||7*86400)),'absolute']);}
    throw new Error('未知的播放控制');
  }
  async function close(){
    ++openRequest;
    if(closing)return closing;if(!contents()&&!native&&!resolver)return;
    ++generation;const previousFrame=frame;ready=false;
    closing=(async()=>{await persistProgress(previousFrame,true).catch(()=>{});resolver?.cancel();await native?.stop();native=null;await resolver?.dispose();resolver=null;const owner=host.getWindow();if(owner&&!initialFullscreen&&owner.isFullScreen())owner.setFullScreen(false);fullscreenCleanup?.();fullscreenCleanup=null;host.detach();state=null;plan=null;frame=null;viewport=null;await onClosed?.();closing=null;})();return closing;
  }
  async function open(value){
    if(disposed)throw new Error('播放器已关闭');if(!webURL(value?.episode?.url)||!value?.rule||!value?.subject)throw new Error('无效的剧集');
    const request=++openRequest;
    if(closing)await closing;
    // Persist the old title before replacing its identity, including when the
    // next video was opened directly from another history card.
    if(plan&&frame)await persistProgress(frame,true);
    if(disposed||request!==openRequest)return {opened:false,canceled:true};
    ensureView();plan=structuredClone(value);lastWrite=0;
    state={phase:'resolving',playbackId:randomUUID(),subject:plan.subject,episode:plan.episode,episodeIndex:plan.episodeIndex||0,episodes:(plan.episodes||[{title:plan.episode.name,url:plan.episode.url}]).map((item,index)=>({index,name:item.title||item.name||'第'+(index+1)+'集'})),ruleName:plan.rule.name,theme:getTheme(),fullscreen:host.getWindow()?.isFullScreen()||false,resume:Math.max(0,Number(plan.position)||0),muted:muted||preferences.get().mute,media:null,settings:preferences.get(),engine:'native',capabilities:{superResolution:true,outputResolution:true,pictureAdjustments:true}};
    broadcast();resolve().catch(()=>{});return {opened:true,embedded:true};
  }
  const handlers={
    'anime-player:get':event=>{if(!valid(event))throw new Error('Untrusted player');return state;},
    'anime-player:action':async(event,action,value)=>{
      if(!valid(event))throw new Error('Untrusted player');const actionGeneration=generation;try{
        if(action==='close')await close();else if(action==='retry'&&plan)await resolve();else if(action==='source'&&plan)await shell.openExternal(plan.episode.url);
        else if(action==='viewport'){const backend=native,next=host.viewport(value);viewport=next;await backend?.viewport(next);if(actionGeneration===generation&&backend===native&&backend&&preferences.get().aspect==='fill')await backend.set('video-aspect-override',next.width/next.height);}
        else if(action==='control')return {ok:true,result:await control(value)};
        else if(action==='progress'&&state.engine==='html5'&&value?.playbackId===state.playbackId){frame=value;await persistProgress(value,!!value.final);}
        else if(action!=='progress')throw new Error('未知的播放器操作');return {ok:true};
      }catch(error){if(state&&actionGeneration===generation)patch({notice:error.message});return {error:error.message};}
    }
  };
  for(const[channel,handler]of Object.entries(handlers))ipcMain.handle(channel,handler);
  return {open,close,getStatus:()=>({open:!!contents(),embedded:true,subjectId:plan?.subject?.id,episodeIndex:plan?.episodeIndex||0,engine:state?.engine,phase:state?.phase||'closed',viewport:viewport?{...viewport}:null,video:frame?{...frame}:null,native:native?.getStatus?.()}),getContents:contents,getNative:()=>native,async dispose(){disposed=true;await close();for(const channel of Object.keys(handlers))ipcMain.removeHandler(channel);}};
}
module.exports={createAnimePlayer,webURL,mediaFormat,progressRecord};
