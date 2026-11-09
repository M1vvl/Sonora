'use strict';
const path = require('node:path');

// Lazy composition boundary: no catalog request, HTML parser, native ECH
// worker, or player window exists until the user opens the anime module.
function installAnimeBridge({ electron, root, dataDir, isDashboard, getTheme, getHostWindow, packaged, resourcesPath, playback, factories={} }) {
  const { ipcMain, protocol, session } = electron;
  let service = null, transport = null, player = null, apiSession = null, disposed = false;
  function publishHistory(value){
    const contents=getHostWindow?.()?.webContents;
    if(!disposed&&contents&&!contents.isDestroyed())contents.send('pulse:anime-history-update',value);
  }
  function ensureService() {
    if (disposed) throw new Error('番剧模块已关闭');
    if (!service) {
      const createAnimeService=factories.createService||require('./anime/index.cjs').createAnimeService;
      const createEchTransport=factories.createTransport||require('./ech-transport/index.cjs').createEchTransport;
      // The service owns one bounded byte LRU. Do not create a second HTTP
      // cache (or a persistent partition) for the same artwork.
      apiSession = session.fromPartition('pulse-anime-api', { cache: false });
      apiSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
      apiSession.setPermissionCheckHandler(() => false);
      transport = createEchTransport({ dllPath: packaged ? path.join(resourcesPath, 'native/ech/ech_http.dll') : path.join(root, 'native/ech/ech_http.dll'),
        fetchImpl: (url, init) => apiSession.fetch(url, init) });
      service = createAnimeService({ dataDir, fetchImpl: (url, init) => transport.fetch(url, init),onHistoryChange:publishHistory });
    }
    return service;
  }
  function ensurePlayer() {
    if(playback)return {open:plan=>playback.open('anime',plan,{onProgress:value=>ensureService().request('historyProgress',value),onEpisode:(plan,index)=>ensureService().request('play',{id:plan.subject.id,ruleId:plan.rule.id,episode:{url:plan.episodes[index].url}})}),close:()=>playback.close('anime'),getStatus:()=>playback.getStatus('anime'),dispose:async()=>{}};
    player ||= (factories.createPlayer||require('./anime-player.cjs').createAnimePlayer)({ electron, root, dataDir, getTheme, getHostWindow,
      nativeOptions:{executablePath:packaged?path.join(resourcesPath,'native/player/AgentPulse.Player.exe'):path.join(root,'native/player/bin/AgentPulse.Player.exe'),libraryPath:packaged?path.join(resourcesPath,'native/player/libmpv-2.dll'):path.join(root,'native/player/resources/libmpv-2.dll'),shaderDirectory:packaged?path.join(resourcesPath,'native/player/shaders'):path.join(root,'native/player/resources/shaders')},
      onProgress: value => service.request('historyProgress', value),
      onEpisode:(plan,index)=>ensureService().request('play',{id:plan.subject.id,ruleId:plan.rule.id,episode:{url:plan.episodes[index].url}}) });
    return player;
  }
  ipcMain.handle('pulse:anime', async (event, action, payload = {}) => {
    if (!isDashboard(event)) throw new Error('Untrusted anime caller');
    if (typeof action !== 'string' || action.length > 80) throw new Error('无效的番剧操作');
    try {
      if(action==='closePlayer'){if(playback)await playback.close('anime');else await player?.close();return {closed:true};}
      const result = await ensureService().request(action, payload);
      if (action === 'play' || action === 'continue') {
        const history = await service.request('history');
        const previous = history.history.find(value => value.subject?.id === result.subject.id && value.episodeUrl === result.episode.url);
        return ensurePlayer().open({ ...result, position: previous?.position || result.position || 0 });
      }
      return result;
    } catch (error) { return { error: String(error?.message || error) }; }
  });
  protocol.handle('pulse-anime-image', async request => {
    try {
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      const url = new URL(request.url).searchParams.get('url');
      if (!url || url.length > 4096) return new Response(null, { status: 400 });
      const result = await ensureService().image(url);
      return new Response(new Uint8Array(result.bytes), { status: 200, headers: { 'Content-Type': result.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response(null, { status: 502 }); }
  });
  return {
    preparePlayback:payload=>ensureService().request('play',payload),
    getStatus: () => ({ loaded: !!service, service: service?.getStatus(), transport: transport?.status?.(), player: playback?playback.getStatus('anime'):player?.getStatus() }),
    async dispose() { disposed = true; ipcMain.removeHandler('pulse:anime'); protocol.unhandle('pulse-anime-image'); await player?.dispose(); await service?.dispose(); await transport?.dispose(); await apiSession?.closeAllConnections(); }
  };
}
module.exports = { installAnimeBridge };
