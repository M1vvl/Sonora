'use strict';
// Hidden Chromium integration of the real dashboard and production preload.
// All IPC below is synthetic; this check never reads a user's account or logs.
const fs=require('node:fs'),path=require('node:path');
const workspace=path.resolve(__dirname,'..');
const argument=name=>{const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);};
const root=path.resolve(argument('--root')||process.env.PULSE_MUSIC_ROOT||workspace);
const out=path.resolve(argument('--output')||process.env.PULSE_MUSIC_OUTPUT||path.join(workspace,'artifacts/v'+require('../package.json').version+'-music-ui'));
const childMode=process.argv.includes('--music-ui-child'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runner(){
  if(!fs.existsSync(path.join(root,'ui/dashboard.html'))&&!root.endsWith('.asar'))throw new Error('Dashboard root does not exist');
  const {spawn}=require('node:child_process'),electron=require('electron');
  fs.mkdirSync(out,{recursive:true});const profile=path.join(out,'profile-'+Date.now());fs.mkdirSync(profile,{recursive:true});
  const env={...process.env,PULSE_MUSIC_PROFILE:profile,PULSE_MUSIC_ROOT:root,PULSE_MUSIC_OUTPUT:out};delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject)=>{
    const child=spawn(electron,[__filename,'--music-ui-child'],{env,cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';
    child.stdout.on('data',()=>{});child.stderr.on('data',data=>{if(stderr.length<20000)stderr+=data;});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Hidden music UI check timed out'));},65000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error('Music UI failed: '+stderr));else resolve();});
  });
  const report=JSON.parse(fs.readFileSync(path.join(out,'music-ui-report.json'),'utf8'));
  console.log(JSON.stringify({checks:report.checks,output:out}));
  if(report.error||Object.values(report.checks).some(value=>value!==true))process.exitCode=1;
}
async function child(){
  const {app,BrowserWindow,ipcMain,nativeImage,protocol}=require('electron');
  protocol.registerSchemesAsPrivileged([{scheme:'pulse-music-image',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}},{scheme:'pulse-music-audio',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,corsEnabled:true}}]);
  app.setPath('userData',process.env.PULSE_MUSIC_PROFILE);
  const report={root,profile:process.env.PULSE_MUSIC_PROFILE,checkedAt:new Date().toISOString(),checks:{},layouts:[],normalQuit:false};
  const save=()=>fs.writeFileSync(path.join(out,'music-ui-report.json'),JSON.stringify(report,null,2));
  app.once('will-quit',()=>{report.normalQuit=true;report.checks.normalQuit=true;save();});
  const checks=report.checks,check=(name,value)=>{checks[name]=!!value;if(!value)throw new Error('Failed music UI check: '+name);};
  let owner,pendingCheck=null,mode='waiting',checkCount=0,cancelCount=0,beginCount=0,authenticated=false,preferences={quality:'hires'},history=[];
  const syntheticProfile={nickname:'诊断账号',avatarDataURL:null,vip:true};
  const songs=Array.from({length:6},(_,index)=>({id:String(index+1),title:['月光与回声','慢慢晴朗','凌晨的海','在路上','遥远的声音','周末来信'][index],artist:['音乐人甲','音乐人乙','音乐人丙'][index%3],album:'隔离诊断专辑',duration:10,coverURL:'pulse-music-image://cover/'+(index+1)}));
  const playlists=Array.from({length:18},(_,index)=>({id:'list-'+index,title:['此刻，轻轻按下播放','午后的独处时光','向远方出发','耳边的温柔'][index%4],subtitle:'高播放精选',playCount:1000000-index,coverURL:'pulse-music-image://playlist/'+(index+1)}));
  const modeTitles={daily:'每日推荐',radar:'私人雷达',fm:'私人漫游',heart:'心动模式',similar:'相似歌曲'};
  const modeSongs=Object.fromEntries(Object.keys(modeTitles).map((name,index)=>[name,name==='daily'?songs:Array.from({length:2},(_,at)=>({...songs[at],id:String(100+index*10+at),title:modeTitles[name]+'真实首曲'+at,coverURL:'pulse-music-image://mode/'+name+'/'+at}))]));
  const libraryCalls=[],discoveryCalls=[];let heldDiscoveryMode=null,pendingDiscoveries=[];
  const settings={interfaceTheme:'electric-purple',islandEnabled:false,islandEdge:'off',musicReactive:false,musicCover:false,pollIntervalMs:1500};
  const total={input:0,cached:0,output:0,reasoning:0,total:0,costUSD:0,knownCostUSD:0,unpricedTokens:0};
  const snapshot={sessions:[],projects:[],dailyUsage:[],totals:total,today:total,processes:[],settings,diagnostics:{loading:false,progress:1,historyComplete:true},updatedAt:new Date().toISOString()};
  const respond={
    'pulse:settings':()=>settings,'pulse:snapshot':()=>snapshot,'pulse:refresh':()=>snapshot,'pulse:dashboard-state':()=>null,
    'pulse:save-dashboard-state':()=>({ok:true}),'pulse:move-dashboard':()=>({ok:true}),'pulse:window-action':()=>({ok:true}),
    'pulse:anime':()=>({ok:true}),'pulse:movies':()=>({ok:true}),
    'pulse:music':async(_event,action,payload={})=>{
      if(action==='bootstrap')return {state:authenticated?'signedIn':'signedOut',profile:authenticated?syntheticProfile:null,selected:'netease'};
      if(action==='home')return {cards:songs.slice(0,5),songs,playlists,recent:history,preferences,listening:{todaySeconds:1980,todaySongs:11,streakDays:3},recommendationMode:authenticated?'personal':'public'};
      if(action==='search')return {songs:[{...songs[0],id:'search-result',title:'检索到的歌曲'}],playlists:[]};
      if(action==='discovery'){discoveryCalls.push({...payload});if(payload.mode===heldDiscoveryMode)await new Promise(resolve=>pendingDiscoveries.push(resolve));else await sleep(60);return {songs:modeSongs[payload.mode]||[],label:modeTitles[payload.mode],playlists:[{id:'mode-private-radar',title:'私人雷达',coverURL:'pulse-music-image://mode/radar/0'}]};}
      if(action==='playlist')return payload.id==='user-10'?{playlist:{id:'user-10',title:'账号歌单'},songs:payload.offset?songs.slice(3):songs.slice(0,3),total:6,nextOffset:payload.offset?6:3,hasMore:!payload.offset}:{playlist:playlists[0],songs};
      if(action==='userPlaylists'){libraryCalls.push({action,payload});return {playlists:[{id:'user-10',title:'账号歌单',creator:'本人',trackCount:6,owned:true,coverURL:songs[0].coverURL},{id:'user-11',title:'收藏歌单',creator:'他人',trackCount:12,owned:false,coverURL:songs[1].coverURL}],nextOffset:2,hasMore:false};}
      if(action==='playlistAdd'){libraryCalls.push({action,payload});return {added:true,...payload};}
      if(action==='play')return {song:songs[0],audioURL:'pulse-music-audio://diagnostic/track.wav',quality:payload.quality||'exhigh',bitrate:320000,playable:true};
      if(action==='lyrics')return {lines:[{time:0,text:'月光照亮此刻'},{time:2,text:'回声轻轻经过'},{time:5,text:'把音乐留在心间'}]};
      if(action==='historyProgress'){history=[songs[0]];return {ok:true};}
      if(action==='like')return authenticated?{liked:true}:{error:'请先登录网易云音乐，再收藏歌曲'};
      if(action==='comments')return {comments:[{nickname:'隔离听众',content:'这是一条诊断评论。'}],total:1};
      if(action==='preferences')return {preferences};
      if(action==='deck')return {cards:songs};
      if(action==='deactivate'||action==='stopAudio')return {ok:true};
      if(action==='beginQR'){beginCount++;return {requestId:'diagnostic-'+beginCount,qrImage:syntheticProfile.avatarDataURL,status:'waiting',expiresAt:Date.now()+180000};}
      if(action==='cancelQR'){cancelCount++;return {ok:true};}
      if(action==='logout'){authenticated=false;return {state:'signedOut',profile:null};}
      if(action==='checkQR'){
        checkCount++;
        if(mode==='deferred')return new Promise(resolve=>{pendingCheck=resolve;});
        if(mode==='confirmed'){authenticated=true;return {status:'confirmed',profile:syntheticProfile};}
        return {status:mode};
      }
      throw new Error('Unknown synthetic music action');
    }
  };
  Object.entries(respond).forEach(([channel,handler])=>ipcMain.handle(channel,handler));
  ipcMain.on('pulse:flush-dashboard-state',event=>{event.returnValue={ok:true};});
  const until=async(predicate,timeout=10000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await predicate();if(value)return value;await sleep(50);}throw new Error('Music UI condition timed out');};
  try{
    await app.whenReady();
    // A generated checker image is deliberately not a usable login challenge.
    // Chromium still decodes a real PNG through the production QR renderer.
    const size=240,pixels=Buffer.alloc(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const v=((Math.floor(x/8)*7+Math.floor(y/8)*11)%5)<2?0:255,at=(y*size+x)*4;pixels[at]=pixels[at+1]=pixels[at+2]=v;pixels[at+3]=255;}
    syntheticProfile.avatarDataURL=nativeImage.createFromBitmap(pixels,{width:size,height:size,scaleFactor:1}).toDataURL();
    protocol.handle('pulse-music-image',()=>new Response(Buffer.from(syntheticProfile.avatarDataURL.split(',')[1],'base64'),{headers:{'content-type':'image/png','access-control-allow-origin':'*'}}));
    const wave=Buffer.alloc(44+16000*2*10);wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
    protocol.handle('pulse-music-audio',()=>new Response(wave,{headers:{'content-type':'audio/wav','content-length':String(wave.length),'access-control-allow-origin':'*'}}));
    owner=new BrowserWindow({width:1260,height:850,useContentSize:true,show:false,frame:false,webPreferences:{preload:path.join(root,'src/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    owner.webContents.setAudioMuted(true);
    owner.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
    const rendererErrors=[];owner.webContents.on('console-message',(_event,...values)=>{const detail=typeof values[0]==='object'?values[0]:{level:values[0],message:values[1]};if(detail.level==='error'||detail.level===3)rendererErrors.push(String(detail.message||''));});
    await owner.loadFile(path.join(root,'ui/dashboard.html'));
    const web=owner.webContents,js=source=>web.executeJavaScript(source);
    await until(()=>js(`typeof workspaceReady!=='undefined'&&workspaceReady&&Boolean(state.snapshot)`));
    check('productionPreload',await js(`typeof window.pulse?.musicRequest==='function'&&typeof window.pulse?.onMusicStatus==='function'`));
    check('fiveRailItemsInOrder',await js(`JSON.stringify([...document.querySelectorAll('.rail-navigation [data-view]')].map(node=>node.dataset.view))===JSON.stringify(['overview','anime','movies','music','settings'])`));
    const themeBefore=await js(`({id:document.documentElement.dataset.interfaceTheme,bg:getComputedStyle(document.documentElement).getPropertyValue('--bg'),accent:getComputedStyle(document.documentElement).getPropertyValue('--accent-text')})`);
    await js(`window.__musicResize=[];const NativeMusicResizeObserver=window.ResizeObserver;window.ResizeObserver=class extends NativeMusicResizeObserver{constructor(callback){const entry={count:0,targets:[]};super((entries,observer)=>{entry.count++;entry.sizes=entries.map(item=>[item.target.className,item.contentRect.width,item.contentRect.height]);callback(entries,observer)});this.diagnosticEntry=entry;window.__musicResize.push(entry)}observe(target,...options){this.diagnosticEntry.targets.push(target.className);return super.observe(target,...options)}};document.getElementById('nav-music').click()`);
    await until(()=>js(`musicUI?.getState().active`));
    check('activationOnlyBootstraps',beginCount===0&&checkCount===0);
    check('musicSelected',await js(`state.view==='music'&&!document.getElementById('music-view').hidden&&document.getElementById('nav-music').classList.contains('active')`));
    await until(()=>js(`document.querySelectorAll('.music-song-list [data-music-song]').length===6`));
    check('sixPlatformsAndNoArrows',await js(`JSON.stringify([...document.querySelectorAll('[data-music-platform]')].map(button=>button.dataset.musicPlatform))===JSON.stringify(['netease','apple','qq','kugou','qishui','spotify'])&&!document.querySelector('.music-search').textContent.includes('↗')&&!document.querySelector('[data-music-action="qr"]').textContent.includes('↗')`));
    check('homeHasNoRecentSection',await js(`document.querySelectorAll('#music-view .music-section').length===2&&document.querySelectorAll('#music-view audio').length===1&&document.querySelectorAll('#music-view .music-playlist').length===18&&document.querySelectorAll('[data-music-discovery]').length===5&&!document.querySelector('.music-recent-section')`));
    await js(`document.querySelectorAll('#music-view img').forEach(image=>{image.loading='eager'})`);await until(()=>js(`[...document.querySelectorAll('.music-playlist-cover img[src]')].every(image=>image.complete&&image.naturalWidth>0)`));
    check('listeningTodayStats',await js(`document.querySelector('[data-listening="minutes"]').textContent==='33'&&document.querySelector('[data-listening="songs"]').textContent==='11'&&document.querySelector('[data-listening="streak"]').textContent==='3'`));
    await js(`document.querySelector('.music-search input').focus()`);
    check('searchHasNoAccentFrame',await js(`getComputedStyle(document.querySelector('.music-search input')).outlineStyle==='none'`));
    await js(`document.activeElement.blur()`);
    check('fiveRealCoverLayers',await js(`document.querySelectorAll('.music-cover-back:not([hidden])').length===4&&document.querySelectorAll('.music-cards img[src]').length===5`));
    await web.capturePage();await sleep(150);fs.writeFileSync(path.join(out,'music-workspace-1260.png'),(await web.capturePage()).toPNG());
    await js(`document.querySelector('.music-account-pill').click()`);
    const geometry=()=>js(`(()=>{const root=document.querySelector('#music-view'),graph=root.querySelector('.music-connection-graph'),svg=root.querySelector('.music-connections'),line=root.querySelector('.music-connection-line'),from=root.querySelector('.music-platform-row.selected .music-platform-port'),to=root.querySelector('.music-account-port'),sheet=root.querySelector('.music-login-sheet'),rail=document.querySelector('.dashboard-rail');if(!line.getAttribute('d'))return null;const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},g=rect(graph),f=rect(from),t=rect(to),s=rect(sheet),r=rect(rail),v=rect(svg),a=line.getPointAtLength(0),b=line.getPointAtLength(line.getTotalLength());return {viewport:[innerWidth,innerHeight],sheet:s,rail:r,svg:v,graph:g,from:f,to:t,path:line.getAttribute('d'),endpointError:Math.max(Math.abs(g.x+a.x-f.x-f.width/2),Math.abs(g.y+a.y-f.y-f.height/2),Math.abs(g.x+b.x-t.x-t.width/2),Math.abs(g.y+b.y-t.y-t.height/2)),visible:getComputedStyle(svg).display!=='none'&&Number(getComputedStyle(line).opacity)>0};})()`);
    for(const [width,height]of [[1260,850],[960,660],[1536,864]]){
      owner.setContentSize(width,height);await sleep(150);await web.capturePage();
      const value=await until(async()=>{const found=await geometry();return found?.viewport[0]===width&&Math.abs(found.svg.width-found.graph.width)<1&&found.endpointError<1?found:null;});
      report.layouts.push(value);
      check('portsAndCurve'+width,value.endpointError<1&&value.visible&&value.to.x>value.from.right&&Math.abs(value.svg.width-value.graph.width)<1&&Math.abs(value.svg.height-value.graph.height)<1);
      check('discoveryAndBottomLayout'+width,await js(`(()=>{const rect=selector=>document.querySelector(selector)?.getBoundingClientRect(),front=rect('.music-cover-front'),feature=rect('.music-discovery-modes'),player=rect('.music-player-bar'),lyrics=rect('.music-lyrics-card');return !!front&&!!feature&&front.left>feature.right&&front.top<feature.bottom&&feature.width>front.width&&player.right<lyrics.left&&Math.abs(player.bottom-lyrics.bottom)<1&&lyrics.height>player.height&&player.height<=108&&lyrics.right<=innerWidth-80&&Math.abs((innerHeight-lyrics.bottom)-rect('.music-search').top)<=1})()`));
      check('compactControlsAligned'+width,await js(`(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),center=s=>{const v=r(s);return v.top+v.height/2},y=center('.music-play-toggle');return ['.music-disc','.music-like','[data-player-action="comments"]','[data-player-action="previous"]','[data-player-action="next"]','.music-mute'].every(s=>Math.abs(center(s)-y)<1)&&r('.music-track-copy').width>45})()`));
      check('squarePlaylistRail'+width,await js(`(()=>{const r=document.querySelector('.music-playlist-cover').getBoundingClientRect(),rail=document.querySelector('.music-playlist-list');return Math.abs(r.width-r.height)<1&&rail.scrollWidth>rail.clientWidth})()`));
      check('singleCardCaptionRow'+width,await js(`(()=>{const a=document.querySelector('.music-card-gesture').getBoundingClientRect(),b=document.querySelector('.music-recommendation-mode').getBoundingClientRect();return Math.abs(a.y-b.y)<1})()`));
      check('noSheetOverflow'+width,value.sheet.x>=0&&value.sheet.right<=value.rail.x-10&&value.sheet.bottom<=height-8);
      await js(`document.getAnimations().forEach(animation=>{try{if(animation.effect?.getTiming().iterations!==Infinity)animation.finish();}catch{}})`);
      check('compactTopLayerModal'+width,await js(`document.querySelector('.music-login-sheet').matches(':modal')&&document.querySelector('.music-login-sheet').getBoundingClientRect().height<=370&&!document.querySelector('.music-login-sheet').textContent.includes('MUSIC CONNECTIONS')`));
      await web.capturePage();await sleep(80);
      fs.writeFileSync(path.join(out,'music-login-'+width+'.png'),(await web.capturePage()).toPNG());
    }
    const material=await js(`(()=>{const sheet=document.querySelector('.music-login-sheet'),r=sheet.getBoundingClientRect(),style=getComputedStyle(sheet),backdrop=getComputedStyle(sheet,'::backdrop');const fixture=document.createElement('div');fixture.id='diagnostic-material-fixture';Object.assign(fixture.style,{position:'fixed',inset:'0',zIndex:'2147483640',background:'#e84028',pointerEvents:'none'});document.body.append(fixture);return {x:Math.round(r.x+70),y:Math.round(r.y+22),background:style.backgroundColor,filter:style.backdropFilter,primaryFilter:backdrop.backdropFilter};})()`);
    await web.capturePage();await sleep(80);const materialA=await web.capturePage({x:material.x,y:material.y,width:3,height:3});
    await js(`document.getElementById('diagnostic-material-fixture').style.background='#2850e8'`);await web.capturePage();await sleep(80);const materialB=await web.capturePage({x:material.x,y:material.y,width:3,height:3});
    const pixelsA=materialA.toBitmap(),pixelsB=materialB.toBitmap();material.pixelDifference=Array.from(pixelsA).reduce((sum,value,index)=>sum+Math.abs(value-pixelsB[index]),0)/pixelsA.length;
    await js(`document.getElementById('diagnostic-material-fixture').remove()`);report.material=material;check('glassTransmitsUnderlyingPixels',material.pixelDifference>10&&material.filter.includes('24px')&&material.primaryFilter.includes('8px'));
    const firstPath=await js(`document.querySelector('.music-connection-line').getAttribute('d')`);
    await js(`document.querySelector('[data-music-platform="qq"]').click()`);await sleep(100);await web.capturePage();
    check('dynamicPlatformConnection',await js(`document.querySelector('.music-connection-line').getAttribute('d')!==${JSON.stringify(firstPath)}&&document.querySelector('.music-unavailable').hidden===false&&document.querySelector('.music-login-methods').hidden===true`));
    await js(`document.querySelector('[data-music-platform="netease"]').click();document.querySelector('[data-music-action="qr"]').click()`);
    await until(()=>js(`document.querySelector('.music-qr-image img').naturalWidth===240&&musicUI.getState().pendingTimer`));
    check('realImageDecoded',beginCount===1&&await js(`musicUI.getState().qrStatus==='waiting'&&!document.querySelector('.music-qr-image img').hidden`));
    mode='scanned';await until(()=>js(`musicUI.getState().qrStatus==='scanned'`),5000);
    check('scannedUpdatesInPlace',await js(`document.querySelector('.music-qr-status').textContent.includes('手机上确认')&&!musicUI.getState().authenticated`));
    mode='deferred';await until(()=>pendingCheck!==null,5000);const beforeCloseChecks=checkCount;
    await js(`document.querySelector('[data-music-action="close"]').click()`);await until(()=>cancelCount>0);
    pendingCheck({status:'confirmed',profile:syntheticProfile});pendingCheck=null;await sleep(150);
    check('lateConfirmationIgnored',await js(`!musicUI.getState().authenticated&&document.querySelector('.music-pill-name').textContent==='登录音乐'`));
    check('closeClearsQRAndTimer',await js(`!musicUI.getState().panelOpen&&!musicUI.getState().pendingTimer&&!document.querySelector('.music-qr-image img').getAttribute('src')`));
    await sleep(2150);check('noPollingAfterClose',checkCount===beforeCloseChecks);
    mode='confirmed';await js(`document.querySelector('.music-account-pill').click();document.querySelector('[data-music-action="qr"]').click()`);
    await until(()=>js(`musicUI.getState().authenticated`),5000);
    check('confirmedAccountPill',await js(`document.querySelector('.music-pill-name').textContent==='诊断账号'&&!document.querySelector('.music-account-pill>.music-vip').hidden&&document.querySelector('.music-login-methods').hidden`));
    await js(`document.querySelector('[data-music-action="logout"]').click()`);await until(()=>js(`!musicUI.getState().authenticated`));
    check('logoutRestoresLogin',!authenticated&&await js(`document.querySelector('.music-pill-name').textContent==='登录音乐'`));
    await js(`document.querySelector('[data-music-action="close"]').click();document.getAnimations().forEach(animation=>{try{if(animation.effect?.getTiming().iterations!==Infinity)animation.finish();}catch{}})`);await sleep(100);
    await js(`document.querySelector('.music-account-pill').focus();musicUI.open();musicUI.close()`);await until(()=>js(`!document.querySelector('.music-login-sheet').open`));check('closeAnimationRestoresFocus',await js(`document.activeElement===document.querySelector('.music-account-pill')`));
    await js(`musicUI.open();musicUI.close();musicUI.deactivate()`);check('interruptedCloseReleasesModal',await js(`!document.querySelector('.music-login-sheet').open&&!document.querySelector('.music-login-sheet').matches(':modal')`));await js(`musicUI.activate()`);
    await js(`document.querySelector('.music-search input').value='完整音乐搜索';document.querySelector('.music-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);await until(()=>js(`document.querySelector('[data-music-song="search-result"]')!==null`));
    check('fullMusicSearch',await js(`document.querySelector('.music-songs-heading').textContent==='搜索结果'`));
    await js(`document.querySelector('.music-search-clear').click()`);await until(()=>js(`document.querySelector('[data-music-song="1"]')!==null`));
    // Use a synthetic signed-in provider only. Every click traverses the
    // actual production preload, module, result rendering and scroll path.
    authenticated=true;await js(`(async()=>{musicUI.deactivate();await musicUI.activate()})()`);
    await until(()=>js(`musicUI.getState().workspace.modePreviews.filter(value=>['radar','fm','heart','similar'].includes(value.mode)&&value.status==='ready').length===4`));
    const originalRecommended=await js(`JSON.stringify([...document.querySelectorAll('.music-playlist')].map(value=>value.dataset.musicPlaylist))`);
    for(const discoveryMode of Object.keys(modeTitles)){
      const expected=modeSongs[discoveryMode][0];
      check('modeFirstSongCover_'+discoveryMode,await js(`(()=>{const image=document.querySelector('[data-music-discovery="${discoveryMode}"] .music-mode-art img');return !!image&&(image.getAttribute('src')||image.getAttribute('data-cover-src'))===${JSON.stringify(expected.coverURL)}&&!Array.from(document.querySelectorAll('.music-playlist-cover img')).some(other=>(other.getAttribute('src')||other.getAttribute('data-cover-src'))===${JSON.stringify(expected.coverURL)})})()`));
    }
    for(const discoveryMode of Object.keys(modeTitles)){
      heldDiscoveryMode=discoveryMode;pendingDiscoveries=[];
      await js(`(async()=>{musicUI.deactivate();await musicUI.activate();document.querySelector('.music-explore-main').scrollTop=0})()`);
      await web.capturePage();
      await js(`document.querySelector('[data-music-discovery="${discoveryMode}"]').click()`);
      check('modeClickBusy_'+discoveryMode,await js(`document.querySelector('[data-music-discovery="${discoveryMode}"]').getAttribute('aria-busy')==='true'&&document.querySelector('.music-songs-heading').textContent.includes('正在载入')`));
      await until(()=>pendingDiscoveries.length>0);heldDiscoveryMode=null;pendingDiscoveries.splice(0).forEach(resolve=>resolve());
      const expected=modeSongs[discoveryMode][0];
      await until(()=>js(`document.querySelector('.music-songs-heading').textContent===${JSON.stringify(modeTitles[discoveryMode])}&&document.querySelector('.music-song-list [data-music-song]')?.dataset.musicSong===${JSON.stringify(expected.id)}`));
      check('modeClickRealSongs_'+discoveryMode,await js(`document.querySelector('[data-music-discovery="${discoveryMode}"]').getAttribute('aria-busy')==='false'&&document.querySelector('.music-song-list .music-song-copy strong').textContent===${JSON.stringify(expected.title)}`));
      await until(()=>js(`document.querySelector('.music-explore-main').scrollTop>0`));
      check('modeResultScrolledIntoView_'+discoveryMode,await js(`(()=>{const view=document.querySelector('.music-explore-main').getBoundingClientRect(),heading=document.querySelector('.music-songs-heading').getBoundingClientRect();return heading.top>=view.top-2&&heading.top<view.bottom-20})()`));
      check('modeDoesNotReplacePlaylists_'+discoveryMode,await js(`JSON.stringify([...document.querySelectorAll('.music-playlist')].map(value=>value.dataset.musicPlaylist))===${JSON.stringify(originalRecommended)}&&!document.querySelector('.music-playlist-list').textContent.includes('私人雷达')`));
    }
    check('fiveModeClicksUseProvider',Object.keys(modeTitles).every(name=>discoveryCalls.some(call=>call.mode===name)));
    await web.capturePage();fs.writeFileSync(path.join(out,'music-mode-result.png'),(await web.capturePage()).toPNG());
    authenticated=false;await js(`(async()=>{musicUI.deactivate();await musicUI.activate()})()`);await until(()=>js(`document.querySelector('[data-music-song="1"]')!==null`));
    await js(`document.querySelector('[data-music-song="1"]').click()`);await until(()=>js(`musicUI.getState().player.phase==='playing'`),10000);
    check('liveLyricsAndActualQuality',await js(`document.querySelector('.music-quality-badge').textContent==='HQ'&&document.querySelector('.music-source-badge').textContent==='NE'&&document.querySelectorAll('.music-lyrics-lines p').length===3&&document.querySelector('.music-lyrics-lines .is-current')?.textContent==='月光照亮此刻'`));
    await js(`window.__sameMusicAudio=document.querySelector('#music-view audio');document.querySelector('.music-lyrics-card').click()`);await web.capturePage();await sleep(420);await web.capturePage();
    check('immersiveFromActualMusicShell',await js(`(()=>{const r=document.querySelector('.music-immersive').getBoundingClientRect();return musicUI.getState().immersive.open&&Math.abs(r.y)<1&&r.height===innerHeight&&r.width===innerWidth&&document.querySelector('.app-shell').inert&&document.querySelector('.music-immersive audio')===__sameMusicAudio;})()`));
    await js(`document.querySelector('.music-immersive-diy').click();document.querySelector('.music-visual-trigger').click()`);check('immersiveDIYFromActualMusicShell',await js(`musicUI.getState().immersive.settingsPanel&&document.querySelectorAll('[data-visual-preset]').length===9`));
    await js(`document.querySelector('.music-immersive-home').click()`);await web.capturePage();await sleep(420);await web.capturePage();check('immersiveReturnRestoresActualMusicShell',await js(`!musicUI.getState().immersive.open&&!document.querySelector('.app-shell').inert&&document.querySelector('#music-view audio')===__sameMusicAudio&&!document.querySelector('.music-immersive-diy')`));
    check('realAudioDecodeAndHistory',await js(`document.querySelector('#music-view audio').duration>0&&document.querySelector('.music-track-title').textContent==='月光与回声'&&!document.querySelector('.music-recent-list')`));
    await js(`document.querySelector('[data-player-action="toggle"]').click()`);
    await js(`document.querySelector('[data-track-menu="source"]').click()`);check('unavailableSourcesAreDisabled',await js(`document.querySelector('[data-track-panel="source"]').hidden===false&&[...document.querySelectorAll('[data-source-choice]:not([data-source-choice="netease"])')].every(button=>button.disabled)`));
    await js(`document.querySelector('[data-source-choice="netease"]').click();document.querySelector('[data-track-menu="quality"]').click()`);
    check('fiveRealQualityChoices',await js(`JSON.stringify([...document.querySelectorAll('[data-quality-choice]')].map(button=>button.dataset.qualityChoice))===JSON.stringify(['jymaster','hires','lossless','exhigh','standard'])`));
    await web.capturePage();await sleep(100);fs.writeFileSync(path.join(out,'music-quality-menu.png'),(await web.capturePage()).toPNG());
    await js(`document.querySelector('[data-quality-choice="standard"]').click()`);await until(()=>js(`musicUI.getState().player.quality==='standard'&&!musicUI.getState().player.qualityPending`));check('qualitySwitchUpdatesActualBadge',await js(`document.querySelector('.music-quality-badge').textContent==='标准'`));
    check('noPersistentPlaybackStatus',await js(`!document.querySelector('.music-playback-status')&&!document.querySelector('.music-workspace-notice')`));
    check('volumeHiddenAtRest',await js(`getComputedStyle(document.querySelector('.music-volume-popover')).visibility==='hidden'`));
    const speakerPoint=await js(`(()=>{const r=document.querySelector('.music-mute').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    await web.capturePage();web.sendInputEvent({type:'mouseMove',x:5,y:5});await sleep(60);web.sendInputEvent({type:'mouseMove',...speakerPoint});await web.capturePage();await sleep(200);
    report.volumeHover=await js(`(()=>{const b=document.querySelector('.music-mute'),r=b.getBoundingClientRect(),e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {x:r.x,y:r.y,w:r.width,h:r.height,hit:e?.outerHTML,hover:b.matches(':hover'),parentHover:b.parentElement.matches(':hover'),panel:getComputedStyle(document.querySelector('.music-volume-popover')).visibility}})()`);
    check('volumeMouseHoverReveal',await js(`getComputedStyle(document.querySelector('.music-volume-popover')).visibility==='visible'`));
    const sliderPoint=await js(`(()=>{const r=document.querySelector('.music-volume').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    web.sendInputEvent({type:'mouseMove',...sliderPoint});await sleep(180);
    check('volumePointerCanReachSlider',await js(`getComputedStyle(document.querySelector('.music-volume-popover')).visibility==='visible'`));
    fs.writeFileSync(path.join(out,'music-volume-hover.png'),(await web.capturePage()).toPNG());
    web.sendInputEvent({type:'mouseMove',x:5,y:5});await sleep(200);
    check('volumeMouseLeaveCloses',await js(`getComputedStyle(document.querySelector('.music-volume-popover')).visibility==='hidden'`));
    await js(`document.querySelector('.music-mute').focus()`);await sleep(180);
    check('volumeKeyboardReveal',await js(`getComputedStyle(document.querySelector('.music-volume-popover')).visibility==='visible'`));
    await js(`document.activeElement.blur()`);await sleep(180);
    check('volumeClosesAfterFocus',await js(`getComputedStyle(document.querySelector('.music-volume-popover')).visibility==='hidden'`));
    await js(`document.querySelector('.music-volume').value=.57;document.querySelector('.music-volume').dispatchEvent(new Event('input'))`);
    check('volumeNumberWhileAdjusting',await js(`!document.querySelector('.music-volume-number').hidden&&document.querySelector('.music-volume-number').textContent==='57'`));
    await js(`document.querySelector('.music-volume').dispatchEvent(new Event('change'))`);
    check('volumeNumberGoneAfterAdjusting',await js(`document.querySelector('.music-volume-number').hidden`));
    await js(`document.querySelector('.music-volume').value=.43;document.querySelector('.music-volume').dispatchEvent(new Event('input'));document.querySelector('[data-player-action="mute"]').click()`);
    check('muteMusicLocally',await js(`document.querySelector('#music-view audio').muted===true&&Math.abs(document.querySelector('#music-view audio').volume-.43)<.001&&document.querySelector('.music-mute').getAttribute('aria-pressed')==='true'`));
    await js(`document.querySelector('[data-player-action="mute"]').click()`);check('unmutePreservesVolume',await js(`!document.querySelector('#music-view audio').muted&&Math.abs(document.querySelector('#music-view audio').volume-.43)<.001`));
    await js(`document.querySelector('[data-player-action="like"]').click()`);await until(()=>js(`document.querySelector('.music-feedback:not([hidden])')!==null`));
    check('borderlessFloatingFeedback',await js(`(()=>{const node=document.querySelector('.music-feedback'),style=getComputedStyle(node);return ['absolute','fixed'].includes(style.position)&&style.borderStyle==='none'&&style.backgroundColor==='rgba(0, 0, 0, 0)'&&!document.querySelector('.music-workspace-notice')})()`));
    await sleep(4400);check('feedbackDisappears',await js(`document.querySelector('.music-feedback').hidden`));
    check('fivePlayerControlsOrdered',await js(`JSON.stringify([...document.querySelectorAll('.music-transport > button')].map(button=>button.dataset.playerAction))===JSON.stringify(['mode','previous','toggle','next','queue'])`));
    await js(`document.querySelector('[data-player-action="mode"]').click();document.querySelector('[data-player-mode="shuffle"]').click()`);check('realPlaybackModeSelected',await js(`musicUI.getState().player.mode==='shuffle'&&document.querySelector('[data-player-mode="shuffle"]').getAttribute('aria-checked')==='true'`));
    await js(`document.querySelector('.music-library-edge').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}))`);await until(()=>js(`document.querySelectorAll('[data-library-playlist]').length===2`));check('edgeHoverRevealsAccountPlaylists',await js(`musicUI.getState().library.open&&document.querySelector('.music-library-panel').getAttribute('aria-hidden')==='false'&&getComputedStyle(document.querySelector('.music-library-panel')).backdropFilter.includes('blur')`));
    await sleep(300);await web.capturePage();check('drawerWithinWindow',await js(`(()=>{const r=document.querySelector('.music-library-panel').getBoundingClientRect();return r.left>=0&&r.right<innerWidth-80&&r.top>0&&r.bottom<innerHeight})()`));
    await js(`document.querySelector('[data-library-playlist="user-10"]').click()`);await until(()=>js(`document.querySelectorAll('[data-library-song]').length===3`));await js(`document.querySelector('[data-library-action="more-songs"]').click()`);await until(()=>js(`document.querySelectorAll('[data-library-song]').length===6`));check('drawerLoadsNextSongBatch',await js(`!musicUI.getState().library.hasMoreSongs&&document.querySelector('.music-library-selected strong').textContent==='账号歌单'`));
    fs.writeFileSync(path.join(out,'music-library-playlist.png'),(await web.capturePage()).toPNG());await js(`document.querySelector('[data-library-action="close"]').click();document.querySelector('[data-player-action="queue"]').click()`);check('currentQueueOpensFromPlayer',await js(`musicUI.getState().library.tab==='queue'&&document.querySelectorAll('.music-library-song').length>0`));await js(`document.querySelector('[data-library-action="close"]').click();document.querySelector('[data-player-action="add-playlist"]').click()`);await until(()=>js(`document.querySelectorAll('[data-library-playlist]').length===1`));check('saveToPlaylistOnlyOwnedTargets',await js(`document.querySelector('[data-library-playlist]').dataset.libraryPlaylist==='user-10'`));check('playlistMutationRequiresClick',!libraryCalls.some(value=>value.action==='playlistAdd'));await js(`document.querySelector('[data-library-playlist="user-10"]').click()`);await until(()=>libraryCalls.some(value=>value.action==='playlistAdd'));check('clickedSongAddedToChosenPlaylist',libraryCalls.find(value=>value.action==='playlistAdd').payload.playlistId==='user-10');
    check('drawerClosesAfterConfirmedAdd',await js(`!musicUI.getState().library.open`));
    check('accountAlwaysVisible',await js(`!document.querySelector('.music-account-autohide')&&!document.querySelector('.music-account-peek')&&getComputedStyle(document.querySelector('.music-account-pill')).opacity==='1'`));
    await web.capturePage();fs.writeFileSync(path.join(out,'music-workspace-1536.png'),(await web.capturePage()).toPNG());
    await js(`document.querySelector('.music-account-pill').click()`);
    mode='waiting';await js(`document.querySelector('[data-music-action="qr"]').click()`);await until(()=>js(`musicUI.getState().pendingTimer`));
    const beforeDeactivate=cancelCount;await js(`document.getElementById('nav-settings').click()`);await until(()=>cancelCount>beforeDeactivate);
    check('navigationStopsChallenge',await js(`!musicUI.getState().active&&!musicUI.getState().pendingTimer`));
    check('preservedElectricPurple',await js(`document.documentElement.dataset.interfaceTheme==='electric-purple'&&JSON.stringify({id:document.documentElement.dataset.interfaceTheme,bg:getComputedStyle(document.documentElement).getPropertyValue('--bg'),accent:getComputedStyle(document.documentElement).getPropertyValue('--accent-text')})===${JSON.stringify(JSON.stringify(themeBefore))}`));
    report.rendererErrors=rendererErrors;report.resizeObservers=await js(`window.__musicResize`);check('noRendererErrors',rendererErrors.length===0);
    report.apiCounts={begin:beginCount,check:checkCount,cancel:cancelCount};
    await js(`workspace.flush();musicUI.dispose()`);check('disposeClearsRoot',await js(`musicUI.getState().disposed&&document.getElementById('music-view').childElementCount===0`));
    save();app.quit();
  }catch(error){report.error=error.stack;save();console.error(error.stack);app.exit(1);}
}
if(childMode)child();else runner().catch(error=>{console.error(error.stack);process.exitCode=1;});
