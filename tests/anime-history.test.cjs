'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createAnimeService}=require('../src/anime/index.cjs');
const {installAnimeBridge}=require('../src/anime-bridge.cjs');
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pulse-anime-history-'));
const progress=(id=42,position=35)=>({subject:{id,title:'真实观看 '+id,cover:'https://image.example/'+id+'.jpg'},ruleId:'giriGiriLove',episodeName:'第1集',episodeUrl:'https://media.example/'+id+'.mp4',sourceUrl:String(id),position,duration:1400,roadIndex:0,episodeIndex:0});
function makeBridge(dataDir){
  const handlers=new Map(),notifications=[];let playerOptions,opened;
  const contents={isDestroyed:()=>false,send:(channel,payload)=>{
    const persisted=JSON.parse(fs.readFileSync(path.join(dataDir,'anime-state.json'),'utf8'));
    notifications.push({channel,payload,persisted});
  }};
  const network={setPermissionRequestHandler(){},setPermissionCheckHandler(){},async closeAllConnections(){},async fetch(url){
    if(url.includes('/subjects/42'))return Response.json({id:42,name_cn:'真实观看 42',images:{large:'https://image.example/42.jpg'}});
    if(url.includes('get_detail'))return Response.json({info:{vod_play_from:'线路',vod_play_url:'第1集$https://media.example/42.mp4'}});
    throw new Error('Unexpected network '+url);
  }};
  const electron={ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},protocol:{handle(){},unhandle(){}},session:{fromPartition:()=>network}};
  const bridge=installAnimeBridge({electron,root:path.resolve(__dirname,'..'),dataDir,isDashboard:event=>event.sender===contents,getHostWindow:()=>({webContents:contents}),getTheme:()=> 'carbon-lime',packaged:false,
    factories:{createTransport:({fetchImpl})=>({fetch:fetchImpl,dispose:async()=>{}}),createPlayer:options=>{playerOptions=options;return {open:async value=>{opened=value;return {opened:true,embedded:true};},close:async()=>{},dispose:async()=>{},getStatus:()=>({open:!!opened})};}}});
  return {bridge,notifications,call:(action,payload)=>handlers.get('pulse:anime')({sender:contents},action,payload),getPlayer:()=>({options:playerOptions,opened})};
}
test('production playback bridge persists real progress, emits only after disk commit, and restores after restart',async()=>{
  const dir=temporary();let app=makeBridge(dir);
  try{
    assert.deepEqual((await app.call('bootstrap')).history,[]);
    await app.call('detail',{id:42});
    await app.call('episodes',{ruleId:'giriGiriLove',url:'42'});
    await app.call('play',{id:42,ruleId:'giriGiriLove',episode:{url:'https://media.example/42.mp4'}});
    assert.equal(app.notifications.length,0);assert.equal((await app.call('history')).history.length,0);
    const result=await app.getPlayer().options.onProgress(progress());
    assert.equal(result.revision,1);assert.equal(app.notifications.length,1);
    const notification=app.notifications[0];assert.equal(notification.channel,'pulse:anime-history-update');
    assert.equal(notification.payload.history[0].position,35);assert.equal(notification.persisted.history[0].position,35);assert.equal(notification.persisted.historyRevision,notification.payload.revision);
    await app.bridge.dispose();app=makeBridge(dir);
    const restored=await app.call('bootstrap');assert.equal(restored.history[0].position,35);assert.equal(restored.revision,1);
    await app.call('continue',{id:42});assert.equal(app.getPlayer().opened.position,35);
    const removed=await app.call('openKazumi',{id:42});assert.match(removed.error,/未知/);
  }finally{await app.bridge.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});
test('concurrent history and preference writes retain both titles and monotonic durable revisions',async()=>{
  const dir=temporary(),events=[];
  const service=createAnimeService({dataDir:dir,installedRulesPath:path.join(dir,'absent'),onHistoryChange:value=>{const disk=JSON.parse(fs.readFileSync(path.join(dir,'anime-state.json'),'utf8'));events.push({value,disk});}});
  try{
    await Promise.all([service.request('historyProgress',progress(42,10)),service.request('networkSave',{images:'mirror'}),service.request('historyProgress',progress(43,20))]);
    assert.deepEqual(events.map(event=>event.value.revision),[1,2]);
    assert(events.every(event=>event.disk.historyRevision===event.value.revision));
    const result=await service.request('bootstrap');assert.deepEqual(result.history.map(record=>record.id),[43,42]);assert.equal(result.network.images,'mirror');
    const disk=JSON.parse(fs.readFileSync(path.join(dir,'anime-state.json'),'utf8'));assert.equal(disk.history.length,2);assert.equal(disk.network.images,'mirror');
    await service.request('historyClear');assert.equal(events.at(-1).value.revision,3);assert.deepEqual(events.at(-1).value.history,[]);
  }finally{await service.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});
test('unplayed and failed writes cannot publish phantom history or overwrite existing history',async()=>{
  const dir=temporary(),blocked=path.join(dir,'not-a-directory');fs.writeFileSync(blocked,'keep');let events=0;
  const service=createAnimeService({dataDir:blocked,installedRulesPath:path.join(dir,'absent'),onHistoryChange:()=>events++});
  try{
    await assert.rejects(service.request('historyProgress',progress(42,0)),/播放后/);
    await assert.rejects(service.request('historyProgress',progress(42,10)));
    const result=await service.request('history');assert.deepEqual(result,{history:[],revision:0});assert.equal(events,0);assert.equal(fs.readFileSync(blocked,'utf8'),'keep');
  }finally{await service.dispose().catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});}
});
