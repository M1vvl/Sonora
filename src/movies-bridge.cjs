'use strict';
// Movie requests are local, lazy and isolated from the monitor snapshot path.
function installMoviesBridge({electron,root,dataDir,isDashboard,getHostWindow,playback,factories={}}){
  const {ipcMain,protocol,session}=electron;
  let service=null,apiSession=null,gateway=null,disposed=false,generation=0,openTail=Promise.resolve();
  const publish=value=>{const web=getHostWindow?.()?.webContents;if(!disposed&&web&&!web.isDestroyed())web.send('pulse:movies-history-update',value);};
  function ensure(){
    if(disposed)throw new Error('影视模块已关闭');
    if(!service){
      apiSession=session.fromPartition('pulse-movies-api');apiSession.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));apiSession.setPermissionCheckHandler(()=>false);
      service=(factories.createService||require('./movies/index.cjs').createMoviesService)({dataDir,fetchImpl:(url,init)=>apiSession.fetch(url,init),onHistoryChange:publish});
    }
    return service;
  }
  async function prepare(plan){
    const settings=await ensure().request('settings');
    if((settings.settings||settings).adFilter===false)return plan;
    gateway||=(factories.createGateway||require('./media-stream/gateway.cjs').createStreamGateway)({fetchImpl:(url,init)=>apiSession.fetch(url,init)});
    return gateway.prepare(plan,{adFilter:true});
  }
  const callbacks={onProgress:value=>ensure().request('historyProgress',value),onClosed:()=>gateway?.stop(),onEpisode:async(plan,index)=>prepare(await ensure().request('play',{id:plan.subject.id,ruleId:plan.rule.id,episode:{url:plan.episodes[index].url}}))};
  ipcMain.handle('pulse:movies',async(event,action,payload={})=>{
    if(!isDashboard(event))throw new Error('Untrusted movie caller');
    if(typeof action!=='string'||action.length>80)throw new Error('无效的影视操作');
    try{
      if(action==='closePlayer'){generation++;await playback.close('movies');await gateway?.stop();return {closed:true};}
      const opening=['play','continue'].includes(action),ticket=opening?++generation:generation;
      const result=await ensure().request(action,payload);
      if(opening){
        const job=openTail.catch(()=>{}).then(async()=>{
          if(disposed||ticket!==generation)return {opened:false,canceled:true};
          // Stop old playback first: its close callback releases its gateway.
          // Preparing the new URL beforehand would have that callback stop it.
          const previous=playback.getStatus('movies');
          const position=previous.open&&previous.subjectId===result.subject.id&&previous.episodeIndex===result.episodeIndex&&previous.video?.position>=1?previous.video.position:null;
          await playback.close();
          if(disposed||ticket!==generation)return {opened:false,canceled:true};
          const plan=await prepare(result);
          if(disposed||ticket!==generation){await gateway?.stop();return {opened:false,canceled:true};}
          if(position!==null)plan.position=position;
          return playback.open('movies',plan,callbacks);
        });openTail=job;return job;
      }
      return result;
    }catch(error){return {error:String(error?.message||error)};}
  });
  protocol.handle('pulse-movie-image',async request=>{
    try{
      if(request.method!=='GET')return new Response(null,{status:405});
      const url=new URL(request.url).searchParams.get('url');if(!url||url.length>4096)return new Response(null,{status:400});
      const image=await ensure().image(url);
      return new Response(new Uint8Array(image.bytes),{headers:{'Content-Type':image.contentType,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'}});
    }catch{return new Response(null,{status:502});}
  });
  return {
    getStatus:()=>({loaded:!!service,service:service?.getStatus(),player:playback.getStatus('movies'),gateway:gateway?.getStatus()}),
    async dispose(){disposed=true;generation++;ipcMain.removeHandler('pulse:movies');protocol.unhandle('pulse-movie-image');await playback.close('movies');await gateway?.dispose();await service?.dispose();await apiSession?.closeAllConnections();}
  };
}
module.exports={installMoviesBridge};
