'use strict';
// Fresh-profile, hidden, muted integration of the production movie IPC and
// shared native player. Public network calls are bounded and no real logs load.
const fs=require('node:fs'),path=require('node:path');
const workspace=path.resolve(__dirname,'..'),root=process.env.PULSE_MOVIES_ROOT||workspace;
const out=path.resolve(process.env.PULSE_MOVIES_OUTPUT||path.join(workspace,'artifacts/v'+require('../package.json').version+'-movies'));
const skipVideo=process.env.PULSE_SKIP_VIDEO_INTEGRATION==='1';
const phase=process.argv.find(value=>value.startsWith('--movies-phase='))?.split('=')[1];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runner(){
  const {spawn}=require('node:child_process'),electron=require('electron');
  const profile=path.join(out,'profile-'+Date.now());fs.mkdirSync(path.join(profile,'anime'),{recursive:true});
  fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({interfaceTheme:'electric-purple',islandEnabled:false,musicReactive:false,musicCover:false,islandEdge:'off',launchAtLogin:false}));
  fs.writeFileSync(path.join(profile,'anime','player-settings.json'),JSON.stringify({mute:true}));
  const run=mode=>new Promise((resolve,reject)=>{
    const env={...process.env,PULSE_MOVIES_PROFILE:profile,CODEX_HOME:path.join(profile,'empty-codex'),CLAUDE_CONFIG_DIR:path.join(profile,'empty-claude')};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(electron,[__filename,'--movies-phase='+mode],{env,cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';
    child.stdout.on('data',()=>{});child.stderr.on('data',data=>{if(stderr.length<24000)stderr+=data;});
    const timer=setTimeout(()=>{child.kill();reject(new Error(mode+' movie check timed out'));},200000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error(mode+' failed: '+stderr));else resolve(child.pid);});
  });
  const first=await run('write'),second=await run('read'),write=JSON.parse(fs.readFileSync(path.join(out,'write.json'),'utf8')),read=JSON.parse(fs.readFileSync(path.join(out,'read.json'),'utf8'));
  const checks={distinctProcesses:first!==second,normalQuit:write.normalQuit&&read.normalQuit,writeCompleted:write.completed===true&&!write.error,readCompleted:read.completed===true&&!read.error,...write.checks,...read.checks};
  fs.writeFileSync(path.join(out,'movies-report.json'),JSON.stringify({root,profile,checkedAt:new Date().toISOString(),checks,skipped:[...(write.skipped||[]),...(read.skipped||[])],write,read},null,2));
  console.log(JSON.stringify({checks,output:out}));if(Object.values(checks).some(value=>value!==true))process.exitCode=1;
}
async function child(){
  const electron=require('electron'),{app,BrowserWindow,webContents}=electron,profile=process.env.PULSE_MOVIES_PROFILE;
  app.setPath('userData',profile);for(const name of ['show','showInactive','focus'])BrowserWindow.prototype[name]=function(){};
  const report={phase,pid:process.pid,checks:{},normalQuit:false,completed:false,stage:'startup',quitCalls:[],windowEvents:[]},save=()=>fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify(report,null,2));let diagnosticWeb=null;
  const originalQuit=app.quit.bind(app);
  app.quit=function(){if(report.quitCalls.length<5)report.quitCalls.push({stage:report.stage,stack:new Error('Diagnostic quit origin').stack.split('\n').slice(1,7).join('\n')});return originalQuit();};
  app.on('browser-window-created',(_event,win)=>{for(const name of ['close','closed'])win.on(name,()=>{if(report.windowEvents.length<12)report.windowEvents.push({id:win.id,event:name,stage:report.stage});});});
  if(root.endsWith('.asar')){
    // This runner is launched by the development Electron binary but loads the
    // staged application archive. Point its resource discovery at that stage,
    // matching the real packaged EXE already exercised by the full smoke test.
    const resources=path.dirname(root);
    if(!fs.existsSync(path.join(resources,'native/player/AgentPulse.Player.exe')))throw new Error('Staged native player missing');
    Object.defineProperty(app,'isPackaged',{value:true});
    Object.defineProperty(process,'resourcesPath',{value:resources});report.stagedResources=resources;
  }
  app.once('will-quit',()=>{report.normalQuit=true;if(!report.completed&&!report.error)report.error='Diagnostic exited before completing phase at '+report.stage;save();});require(path.join(root,'src/main.cjs'));
  const until=async(predicate,timeout=45000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await predicate();if(value)return value;await sleep(100);}throw new Error('Movie integration condition timed out');};
  try{
    await app.whenReady();const owner=await until(()=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith('/ui/dashboard.html')&&!win.webContents.isLoading()));
    const web=owner.webContents;diagnosticWeb=web;await until(()=>web.executeJavaScript(`typeof workspaceReady!=='undefined'&&workspaceReady`));
    const api=(name,payload={})=>web.executeJavaScript(`(async()=>{const result=await window.pulse.moviesRequest(${JSON.stringify(name)},${JSON.stringify(payload)});if(result?.error)throw new Error(result.error);return result;})()`);
    const bootstrap=await api('bootstrap');report.checks.bundledSources=bootstrap.rules.length===6&&bootstrap.rules.every(source=>/^https:/.test(source.url));
    if(phase==='read'){
      if(skipVideo)report.skipped=['realHistoryAfterRestart'];else report.checks.realHistoryAfterRestart=bootstrap.history.length===1&&bootstrap.history[0].position>=20;
      report.checks.lastMoviesViewRestored=await web.executeJavaScript(`state.view==='movies'&&!document.getElementById('movies-view').hidden`);
      report.history=bootstrap.history.map(({id,position,duration,ruleId})=>({id,position,duration,ruleId}));report.completed=true;report.stage='read-complete';app.quit();save();return;
    }
    report.checks.emptyFreshHistory=bootstrap.history.length===0;
    await web.executeJavaScript(`document.getElementById('nav-movies').click()`);
    report.stage='homepage';
    await until(()=>web.executeJavaScript(`document.querySelectorAll('#movies-view .anime-feature-card').length===4&&document.querySelectorAll('#movies-view .movie-metal-card').length>=4`),65000);
    report.checks.highScoreMetalFilmStrip=await web.executeJavaScript(`document.querySelectorAll('#movies-view .anime-hero').length===0&&document.querySelectorAll('#movies-view .anime-featured-row .anime-feature-card').length===4&&moviesUI.getState().carousel.items.every(item=>item.score>=7.5)`);
    report.checks.homeWidthContained=await web.executeJavaScript(`(()=>{const content=document.querySelector('#movies-view .anime-home-layout').getBoundingClientRect(),featured=document.querySelector('#movies-view .anime-featured').getBoundingClientRect(),rail=document.querySelector('.rail-navigation').getBoundingClientRect();return featured.right<=content.right+1&&content.right<rail.left&&document.documentElement.scrollWidth<=innerWidth;})()`);
    report.checks.railOrder=await web.executeJavaScript(`JSON.stringify([...document.querySelectorAll('.rail-navigation [data-view]')].map(node=>node.dataset.view))===JSON.stringify(['overview','anime','movies','music','settings'])`);
    await web.capturePage();await sleep(100);
    await until(()=>web.executeJavaScript(`document.querySelectorAll('#movies-view .anime-feature-card img').length===4&&[...document.querySelectorAll('#movies-view .anime-feature-card img')].every(img=>img.complete&&img.naturalWidth>0)`));
    report.checks.realMovieCovers=true;
    report.checks.moviesNavigationSelected=await web.executeJavaScript(`document.getElementById('nav-movies').classList.contains('active')&&!document.getElementById('nav-overview').classList.contains('active')`);
    // Hidden windows do not always advance CSS transition clocks. Capture the
    // settled UI; the visible application retains its normal transitions.
    await web.executeJavaScript(`document.getAnimations().filter(item=>item instanceof CSSTransition).forEach(item=>item.finish())`);
    await web.capturePage();await sleep(100);fs.writeFileSync(path.join(out,'movies-home.png'),(await web.capturePage()).toPNG());
    report.carouselLayouts=[];
    for(const width of [960,1260,1536]){
      owner.setContentSize(width,850);await web.capturePage();await sleep(100);await web.capturePage();
      const layout=await web.executeJavaScript(`(()=>{const viewport=document.querySelector('#movies-view .movie-carousel-viewport').getBoundingClientRect(),card=document.querySelector('#movies-view .movie-metal-card').getBoundingClientRect(),rail=document.querySelector('.rail-navigation').getBoundingClientRect(),home=document.querySelector('#movies-view .anime-home-layout').getBoundingClientRect();return {width:innerWidth,viewport:{left:viewport.left,right:viewport.right,height:viewport.height},card:{width:card.width,height:card.height},contained:home.right<rail.left&&viewport.right<=home.right+1&&document.documentElement.scrollWidth<=innerWidth};})()`);
      report.carouselLayouts.push(layout);report.checks['filmDeckLayout'+width]=layout.contained&&layout.card.width>=150&&layout.card.height>layout.card.width&&layout.card.height<310;
      fs.writeFileSync(path.join(out,'movies-home-'+width+'.png'),(await web.capturePage()).toPNG());
    }
    owner.setContentSize(1260,850);await web.capturePage();
    await web.executeJavaScript(`window.movieDeckFirst=document.querySelector('#movies-view [data-movie-card]');window.movieDeckInitial=moviesUI.getState().carousel.items.map(item=>item.id);const viewport=document.querySelector('#movies-view .movie-carousel-viewport');viewport.scrollLeft=viewport.scrollWidth;viewport.dispatchEvent(new Event('scroll'));`);
    await until(()=>web.executeJavaScript(`!moviesUI.getState().carousel.pending&&moviesUI.getState().carousel.items.length>window.movieDeckInitial.length`));
    report.checks.highScoreAppendPreservesVisitedCards=await web.executeJavaScript(`(()=>{const deck=moviesUI.getState().carousel;return window.movieDeckFirst===document.querySelector('#movies-view [data-movie-card]')&&window.movieDeckInitial.every((id,index)=>deck.items[index].id===id)&&deck.items.every(item=>item.score>=7.5);})()`);
    await web.executeJavaScript(`document.querySelector('#movies-view .movie-carousel-viewport').scrollLeft=0`);
    report.stage='search';save();
    await web.executeJavaScript(`const input=document.getElementById('movies-query');input.value='流浪地球';input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
    await until(()=>web.executeJavaScript(`document.querySelectorAll('#movies-view .anime-grid-card').length>0`));
    const catalog=await api('catalog',{query:'流浪地球',category:'热门',offset:0});
    const item=catalog.items.find(value=>value.title==='流浪地球');if(!item)throw new Error('Exact movie missing from full search');
    report.checks.fullMovieSearch=true;await web.executeJavaScript(`document.querySelector('#movies-view .anime-grid-card').click()`);await until(()=>web.executeJavaScript(`document.querySelector('#movies-view .anime-detail')&&document.querySelector('#movies-view [data-action="find-sources"]')`));report.checks.detailAutomaticallySearches=await web.executeJavaScript(`document.querySelector('#movies-view .anime-cancel-search')!==null||document.querySelector('#movies-view .anime-source-status')!==null`);report.catalog={count:catalog.items.length,total:catalog.total};
    // The source discovery is now automatic. Let that real operation settle
    // before the separate quality/playback phase starts more API requests.
    await until(()=>web.executeJavaScript(`document.querySelector('#movies-view [data-action="find-sources"]')?.disabled===false`));
    report.checks.automaticDiscoveryCompletes=true;
    report.stage='source-and-quality';
    const source=await api('searchSource',{ruleId:'ry',keyword:'流浪地球'}),match=source.items.find(value=>value.title==='流浪地球');if(!match)throw new Error('Verified movie source missing');
    const episodes=await api('episodes',{ruleId:'ry',url:match.url});
    report.checks.verifiedSources=episodes.lines.some(line=>line.episodes.length>0)&&Number.isFinite(source.latencyMs);
    const quality=await api('quality',{ruleId:'ry',url:match.url});
    report.checks.measuredSourceQuality=Number.isInteger(quality.width)&&Number.isInteger(quality.height)&&quality.width>0&&quality.height>0&&['segment','manifest'].includes(quality.method);
    report.sourceQuality={width:quality.width,height:quality.height,method:quality.method,label:quality.label,...(quality.reason?{reason:quality.reason}:{})};
    report.apiResponseMs=source.latencyMs;
    if(skipVideo){
      report.skipped=['nativeMoviePlayback','defaultBestGPUOutput','decodedSourceVisible','sameEmbeddedWindow','movieAdGateway','sharedPictureAndSR','secondsHistory','gatewayReleased','continueWatchingOnHome','nativeResumeSeconds'];
      report.checks.preservedTheme=await web.executeJavaScript(`document.documentElement.dataset.interfaceTheme==='electric-purple'`);
      await web.executeJavaScript(`workspace.flush()`);report.completed=true;report.stage='write-complete-video-manual';app.quit();save();return;
    }
    await api('play',{id:item.id,ruleId:'ry',episode:{url:episodes.lines[0].episodes[0].url}});
    report.stage='native-playback';
    const player=await until(()=>webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/ui/anime-player/player.html')&&!contents.isLoading()));
    const state=()=>player.executeJavaScript('window.animePlayer.get()');
    await until(async()=>{const value=await state();if(value.phase==='error')throw new Error(value.error);return value.phase==='ready';},65000);
    const control=(type,value)=>player.executeJavaScript(`window.animePlayer.action('control',${JSON.stringify({type,value})})`);
    await control('mute',true);await control('seek',25);await sleep(800);await control('togglePause');
    const playing=await state();report.checks.nativeMoviePlayback=playing.engine==='native'&&playing.phase==='ready';
    report.checks.defaultBestGPUOutput=playing.settings.outputResolution==='2160p'&&playing.settings.superResolution==='quality';
    report.checks.decodedSourceVisible=await player.executeJavaScript(`document.getElementById('source-quality').textContent.includes('原始像素')&&/\\d+ × \\d+/.test(document.getElementById('source-quality').textContent)`);
    report.checks.sameEmbeddedWindow=BrowserWindow.getAllWindows().length===2&&owner.contentView.children.length===1;
    report.checks.movieAdGateway=/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\//.test(playing.media.url);
    report.checks.sharedPictureAndSR=playing.capabilities.superResolution&&playing.capabilities.pictureAdjustments;
    const gatewayURL=playing.media.url;
    await player.executeJavaScript(`window.animePlayer.action('close')`).catch(error=>{if(!/Render frame was disposed|Object has been destroyed/.test(error.message))throw error;});await until(()=>player.isDestroyed()&&owner.contentView.children.length===0);await sleep(100);
    const history=await api('history');report.checks.secondsHistory=history.history.length===1&&history.history[0].position>=20;
    report.checks.gatewayReleased=await fetch(gatewayURL).then(()=>false,()=>true);
    await web.executeJavaScript(`document.querySelector('#movies-view [data-category="主页"]').click()`);
    await until(()=>web.executeJavaScript(`document.querySelectorAll('#movies-view [data-history]').length===1`));report.checks.continueWatchingOnHome=true;
    await api('continue',{id:item.id});const resumed=await until(()=>webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/ui/anime-player/player.html')&&!contents.isLoading()));
    report.stage='resume';
    await until(()=>resumed.executeJavaScript(`(async()=>{const state=await window.animePlayer.get();if(state.phase==='error')throw new Error(state.error);return state.phase==='ready';})()`),65000);
    report.checks.nativeResumeSeconds=await resumed.executeJavaScript(`window.animePlayer.get().then(state=>state.resume>=20)`);
    await resumed.executeJavaScript(`window.animePlayer.action('close')`).catch(error=>{if(!/Render frame was disposed|Object has been destroyed/.test(error.message))throw error;});await until(()=>resumed.isDestroyed()&&owner.contentView.children.length===0);
    report.checks.preservedTheme=await web.executeJavaScript(`document.documentElement.dataset.interfaceTheme==='electric-purple'`);
    await web.executeJavaScript(`workspace.flush()`);report.completed=true;report.stage='write-complete';app.quit();save();
  }catch(error){report.error=error.stack;if(diagnosticWeb&&!diagnosticWeb.isDestroyed()){
    try{report.failureContext=await diagnosticWeb.executeJavaScript(`(async()=>{const rules=await window.pulse.moviesRequest('rules');const result=await window.pulse.moviesRequest('catalog',{query:'流浪地球',category:'热门',offset:0});return {view:state.view,movies:moviesUI?.getState(),content:document.querySelector('#movies-view .anime-content')?.textContent.slice(0,600),message:document.querySelector('#movies-view .anime-message')?.textContent,rules:rules.rules?.map(({id,status,error,latencyMs})=>({id,status,error,latencyMs})),directCatalog:{error:result.error,count:result.items?.length,total:result.total}};})()`);}catch(contextError){report.failureContextError=String(contextError.message).slice(0,300);}
  }save();console.error(error.stack);app.quit();}
}
if(phase)child();else runner().catch(error=>{console.error(error.stack);process.exitCode=1;});
