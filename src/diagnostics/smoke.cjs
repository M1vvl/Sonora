'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {getMaterialDiagnostics}=require('../material.cjs');
const {ISLAND_COMPACT,ISLAND_EXPANDED}=require('../window-layout.cjs');
const {buildEdgeMap,refractEdges}=require('../refraction-map.cjs');
const {createGDICapture}=require('../refraction.cjs');
const {previewMaterial}=require('./material-preview.cjs');
const {checkDashboardDrag}=require('./dashboard-drag.cjs');
const {checkMonitorLayout}=require('./monitor-layout.cjs');
const {checkTokenActivity}=require('./token-activity.cjs');
const {checkIslandChrome}=require('./island-chrome.cjs');
const {checkAnime}=require('./anime.cjs');
const {checkEmbeddedPlayer}=require('./player.cjs');
async function dashboardPaintState(contents) {
  return contents.executeJavaScript(`(async () => {
    document.querySelector('.content-scroll').scrollTop=0;
    const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await nextPaint();
    const transitions=document.getAnimations().filter(animation=>animation instanceof CSSTransition&&(animation.playState==='running'||animation.pending));
    let timeout;
    await Promise.race([Promise.allSettled(transitions.map(animation=>animation.finished)),new Promise(resolve=>{timeout=setTimeout(resolve,300);})]);
    clearTimeout(timeout);
    await nextPaint();
    const rail=document.querySelector('.dashboard-rail'),active=document.querySelector('[data-view="overview"]'),inactive=document.querySelector('[data-view="settings"]');
    const railBox=rail.getBoundingClientRect(),activeBox=active.getBoundingClientRect(),inactiveBox=inactive.getBoundingClientRect();
    const feature=document.querySelector('#stats-grid > .stat-card:nth-child(2)'),featureBox=feature.getBoundingClientRect();
    const channels=color=>color.match(/[0-9.]+/g).map(Number);
    const railRGB=channels(getComputedStyle(rail).backgroundColor).slice(0,3);
    const overRail=element=>{const color=channels(getComputedStyle(element).backgroundColor),alpha=color[3]??1;return color.slice(0,3).map((channel,index)=>Math.round(channel*alpha+railRGB[index]*(1-alpha)));};
    return {theme:document.documentElement.dataset.interfaceTheme,width:innerWidth,height:innerHeight,
      transitionsSettled:!document.getAnimations().some(animation=>animation instanceof CSSTransition&&(animation.playState==='running'||animation.pending)),
      overviewVisible:active.classList.contains('active')&&!document.getElementById('monitor-view').hidden&&document.getElementById('settings-view').hidden,
      probes:[
        {name:'rail',x:railBox.left+railBox.width/2,y:railBox.top+railBox.height/2,rgb:railRGB},
        {name:'overview-active',x:activeBox.left+6,y:activeBox.top+activeBox.height/2,rgb:overRail(active)},
        {name:'settings-inactive',x:inactiveBox.left+6,y:inactiveBox.top+inactiveBox.height/2,rgb:overRail(inactive)},
        {name:'complete-palette-feature',x:featureBox.left+8,y:featureBox.top+featureBox.height/2,rgb:channels(getComputedStyle(feature).backgroundColor).slice(0,3)}
      ]};
  })()`);
}
async function captureDashboard(contents, expectedTheme) {
  const state=await dashboardPaintState(contents);
  // Hidden Chromium compositors can return the preceding frame once. Discard
  // that frame, then validate actual bitmap pixels instead of trusting the DOM.
  await contents.capturePage();
  let image,probes=[],matched=false,attempts=0;
  for(;attempts<5;attempts++){
    if(attempts)await new Promise(resolve=>setTimeout(resolve,50));
    image=await contents.capturePage();
    const bitmap=image.toBitmap(),size=image.getSize();
    probes=state.probes.map(probe=>{
      const x=Math.min(size.width-1,Math.max(0,Math.floor(probe.x*size.width/state.width)));
      const y=Math.min(size.height-1,Math.max(0,Math.floor(probe.y*size.height/state.height)));
      const offset=(y*size.width+x)*4;
      const actual=[bitmap[offset+2],bitmap[offset+1],bitmap[offset],bitmap[offset+3]];
      // Highly saturated 8-bit readbacks can differ by a few levels (the
      // magenta feature reads G=5 for CSS G=1 here). Keep a tight, bounded
      // aggregate allowance; a stale theme or missing dark selection still
      // differs by tens/hundreds of levels and cannot pass this check.
      const channelErrors=probe.rgb.map((channel,index)=>Math.abs(channel-actual[index]));
      return {name:probe.name,x,y,expected:probe.rgb,actual,channelErrors,matched:actual[3]===255&&Math.max(...channelErrors)<=6&&channelErrors.reduce((sum,error)=>sum+error,0)<=8};
    });
    matched=state.transitionsSettled&&state.overviewVisible&&(!expectedTheme||state.theme===expectedTheme)&&probes.every(probe=>probe.matched);
    if(matched){attempts++;break;}
  }
  return {image,validation:{theme:state.theme,matched,attempts,transitionsSettled:state.transitionsSettled,overviewVisible:state.overviewVisible,probes}};
}
async function runSmoke({ app, ROOT, monitor, dashboard, island, animeBridge, scanProcesses, broadcast, rendererErrors, snapshot, getExpanded, quit }) {
  const material = getMaterialDiagnostics(island)?.material || 'css';
  const out = process.env.PULSE_SMOKE_OUTPUT || (app.isPackaged ? path.join(os.tmpdir(), 'agent-pulse-packaged-smoke') : path.join(ROOT, 'artifacts'));
  fs.mkdirSync(out, { recursive: true });
  async function islandExpansion(target){
    const current=await island.webContents.executeJavaScript(`!document.getElementById('island-details').hidden`);
    if(current!==target)await island.webContents.executeJavaScript(`document.querySelector('.island-header').click()`);
    for(let attempt=0;attempt<20;attempt++){
      await island.webContents.capturePage();
      if(getExpanded()===target&&await island.webContents.executeJavaScript(`innerHeight===${target?ISLAND_EXPANDED.height:ISLAND_COMPACT.height}&&document.getElementById('island-details').hidden===${!target}`))return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Island diagnostic resize did not settle');
  }
  if(process.env.PULSE_SMOKE_MONITOR_ONLY==='1'){
    while(dashboard.webContents.isLoading())await new Promise(resolve=>setTimeout(resolve,50));
    const layout=await checkMonitorLayout(dashboard);
    layout.activity=await checkTokenActivity(dashboard);Object.assign(layout.checks,layout.activity.checks);
    if(process.env.PULSE_SMOKE_DRAG_CHECK==='1'){
      while(!await dashboard.webContents.executeJavaScript(`!!document.querySelector('#detail-panel .event p')`))await new Promise(resolve=>setTimeout(resolve,100));
      layout.drag=await checkDashboardDrag(dashboard);Object.assign(layout.checks,layout.drag.checks);
    }
    await dashboard.webContents.capturePage();await new Promise(resolve=>setTimeout(resolve,120));
    fs.writeFileSync(path.join(out,'monitor-layout.png'),(await dashboard.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(out,'monitor-layout-report.json'),JSON.stringify(layout,null,2));
    console.log(JSON.stringify({checks:layout.checks,output:out}));quit(Object.values(layout.checks).some(value=>value!==true)||rendererErrors.length?1:0);return;
  }
  if(process.env.PULSE_SMOKE_ANIME_ONLY==='1'){
    while(dashboard.webContents.isLoading())await new Promise(resolve=>setTimeout(resolve,50));
    const anime=await checkAnime({dashboard,out});anime.status=animeBridge.getStatus();
    fs.writeFileSync(path.join(out,'anime-only-report.json'),JSON.stringify(anime,null,2));
    console.log(JSON.stringify(anime));quit(anime.error||Object.values(anime.checks).some(value=>value!==true)?1:0);return;
  }
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const data = monitor.getSnapshot();
    if (data.sessions?.length && !data.diagnostics?.loading && !dashboard.webContents.isLoading() && !island.webContents.isLoading()) break;
  }
  await monitor.refresh(); await scanProcesses(); broadcast();
  await new Promise((resolve) => setTimeout(resolve, 700));
  await dashboard.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const check = await dashboard.webContents.executeJavaScript(`({title:document.title,text:document.body.innerText.slice(0,1500),hasBridge:!!window.pulse,hasNode:typeof require!=='undefined',scrollWidth:document.documentElement.scrollWidth,width:innerWidth})`);
  const islandCheck = await island.webContents.executeJavaScript(`({title:document.title,text:document.body.innerText.slice(0,700),hasBridge:!!window.pulse,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,visibility:document.visibilityState})`);
  const interaction = await dashboard.webContents.executeJavaScript(`(async () => {
    const checks={};
    document.querySelector('[data-view="settings"]').click();
    checks.settingsNavigation=!document.getElementById('settings-view').hidden && document.getElementById('monitor-view').hidden;
    const scrollArea=document.querySelector('.content-scroll'),scrollStyle=getComputedStyle(scrollArea),oldScroll=scrollArea.scrollTop;
    scrollArea.scrollTop=40;
    checks.hiddenDashboardScrollbar=scrollStyle.scrollbarWidth==='none'&&getComputedStyle(scrollArea,'::-webkit-scrollbar').display==='none'&&scrollStyle.overflowY==='auto'&&scrollArea.scrollTop>0;
    scrollArea.scrollTop=oldScroll;
    checks.pricingTable=!!document.querySelector('#pricing-table tbody tr');
    checks.noSubscriptionDisplay=!/ChatGPT Plus|订阅|月费/.test(document.body.innerText);
    const detected=(await window.pulse.getSnapshot()).processes || [];
    checks.processDetection=detected.some(process=>/^codex/i.test(process.name));
    document.querySelector('[data-view="overview"]').click();
    const overview=document.getElementById('monitor-view'),overviewNav=document.querySelector('[data-view="overview"]');
    checks.conversationsInOverview=!document.querySelector('[data-view="sessions"]') && overviewNav.classList.contains('active') && !overview.hidden && !document.getElementById('stats-grid').hidden && ['session-search','sessions-list','detail-panel'].every(id=>overview.contains(document.getElementById(id)));
    checks.trimmedDashboardChrome=['.sidebar','.brand','.workspace-label','.sidebar-bottom','.breadcrumb','.connection'].every(selector=>!document.querySelector(selector)) && ['minimize-button','maximize-button','connection-label','connection-dot'].every(id=>!document.getElementById(id)) && !document.getElementById('footer-status') && !document.querySelector('.page-footer') && document.querySelectorAll('.nav-button[data-view]').length===5;
    checks.centeredExitControl=(()=>{
      const button=document.getElementById('close-button'),svg=button?.querySelector('svg');
      if(!button||!svg)return false;
      const control=button.getBoundingClientRect(),icon=svg.getBoundingClientRect();
      return control.width===44 && control.height===44 && icon.width>0 && icon.height>0 && svg.getAttribute('viewBox')==='0 0 24 24' && Math.abs(control.left+control.width/2-icon.left-icon.width/2)<1 && Math.abs(control.top+control.height/2-icon.top-icon.height/2)<1 && [...button.childNodes].every(node=>node.nodeType!==3||!node.textContent.trim());
    })();
    checks.rightRailGeometry=(()=>{
      const rail=document.querySelector('.dashboard-rail'),main=document.querySelector('main'),exit=document.getElementById('close-button'),nav=document.querySelector('.rail-navigation');
      if(!rail||!main||!exit||!nav)return false;
      const box=rail.getBoundingClientRect(),mainBox=main.getBoundingClientRect(),exitBox=exit.getBoundingClientRect(),navBox=nav.getBoundingClientRect();
      return Math.abs(box.width-60)<1 && Math.abs(box.height-(innerHeight-24))<1 && Math.abs(box.top-12)<1 && box.left>=mainBox.right-1 && Math.abs(innerWidth-box.right-12)<1 && exitBox.top>navBox.bottom+40 && Math.abs(box.bottom-exitBox.bottom-12)<1 && getComputedStyle(document.querySelector('.topbar')).webkitAppRegion==='drag';
    })();
    checks.railNavigation=(()=>{
      const rail=document.querySelector('.dashboard-rail'),active=rail?.querySelector('.nav-button.active');
      if(!rail||!active)return false;
      const channels=getComputedStyle(active).backgroundColor.match(/[0-9.]+/g)?.slice(0,3).map(Number)||[];
      return rail.querySelectorAll('.rail-navigation .nav-button[data-view]').length===5 && rail.querySelectorAll('.rail-navigation .nav-button svg').length===5 && rail.contains(document.getElementById('close-button')) && channels.length===3 && Math.max(...channels)<100;
    })();
    const input=document.getElementById('session-search');
    input.value='__pulse_no_such_session__'; input.dispatchEvent(new Event('input',{bubbles:true}));
    checks.search=document.querySelectorAll('.session-row').length===0;
    input.value=''; input.dispatchEvent(new Event('input',{bubbles:true}));
    checks.searchReset=document.querySelectorAll('.session-row').length>0;
    document.querySelector('[data-agent="Claude"]').click();
    checks.agentFilter=[...document.querySelectorAll('.agent-name')].every(element=>element.textContent==='Claude');
    document.querySelector('[data-agent="all"]').click();
    const snap=await window.pulse.getSnapshot();
    checks.projectHierarchy=document.querySelectorAll('details[data-project]').length===snap.projects.length && snap.projects.length>0;
    checks.mainConversations=[...document.querySelectorAll('.session-row:not(.child-session)')].length===snap.sessions.filter(session=>!session.isSubagent).length;
    document.querySelector('[data-range="history"]').click();
    checks.historyRange=document.getElementById('metric-token-label').textContent==='历史 Token' && document.getElementById('today-tokens').title===new Intl.NumberFormat('en-US').format(snap.totals.total)+' tokens';
    document.querySelector('[data-range="today"]').click();
    checks.dailyRange=document.getElementById('metric-token-label').textContent==='今日 Token';
    const historicalDay=snap.dailyUsage.find(day=>day.date!==document.getElementById('usage-date').value);
    if(historicalDay){const dateInput=document.getElementById('usage-date');const original=dateInput.value;dateInput.value=historicalDay.date;dateInput.dispatchEvent(new Event('change',{bubbles:true}));checks.dateSelection=document.getElementById('today-tokens').title===new Intl.NumberFormat('en-US').format(historicalDay.total)+' tokens';dateInput.value=original;dateInput.dispatchEvent(new Event('change',{bubbles:true}));}
    const active=snap.sessions.find(session=>!session.isSubagent && session.status==='working' && session.tokens.total>0)||snap.sessions.find(session=>!session.isSubagent && session.events.some(event=>event.type==='usage'));
    if(active){document.querySelectorAll('[data-session]').forEach(row=>{if(row.dataset.session===active.id)row.click();});}
    if(active){checks.overviewConversationDetail=overviewNav.classList.contains('active') && !overview.hidden && !document.getElementById('stats-grid').hidden && document.querySelector('.session-row.selected')?.dataset.session===active.id && !!document.querySelector('#detail-panel .detail-heading h2');}
    checks.largeHighlightedPrice=Number.parseFloat(getComputedStyle(document.querySelector('.event-cost-value')).fontSize)>=15;
    checks.independentRoleIcons=!!document.querySelector('.robot-icon') && !!document.querySelector('.event.tool svg');
    const before=await window.pulse.getSettings();
    checks.audioSettings=before.musicReactive===true && before.audioSourceMode==='auto' && document.querySelector('#setting-audio-source').value==='auto';
    await window.pulse.saveSettings({musicReactive:false,audioSourceMode:'music'});
    checks.manualAudioOverride=document.querySelector('#setting-music').checked===false && document.querySelector('#setting-audio-source').value==='music';
    await window.pulse.saveSettings({musicReactive:before.musicReactive,audioSourceMode:before.audioSourceMode});
    const saved=await window.pulse.saveSettings({alwaysOnTop:!before.alwaysOnTop});
    checks.settingsIPC=saved.alwaysOnTop===!before.alwaysOnTop;
    await window.pulse.saveSettings({alwaysOnTop:before.alwaysOnTop});
    const hidden=await window.pulse.toggleIsland(false); const shown=await window.pulse.toggleIsland(true);
    checks.islandToggle=hidden.islandEnabled===false && shown.islandEnabled===true;
    document.querySelector('[data-view="overview"]').click();
    checks.overviewNavigation=!document.getElementById('stats-grid').hidden;
    return checks;
  })()`);
  const dashboardDrag=await checkDashboardDrag(dashboard);
  Object.assign(interaction,dashboardDrag.checks);
  const monitorLayout=await checkMonitorLayout(dashboard);
  Object.assign(interaction,monitorLayout.checks);
  monitorLayout.activity=await checkTokenActivity(dashboard);Object.assign(interaction,monitorLayout.activity.checks);
  if (process.platform === 'win32') {
    // Allocate a tiny DIB, write a synthetic byte pattern and copy it back.
    // This exercises Electron's actual native ABI without reading the desktop.
    const nativeMemory = createGDICapture();
    try { interaction.nativeDIBMemory = nativeMemory.testMemory(); }
    finally { nativeMemory.dispose(); }
  }
  const themeSetup = await dashboard.webContents.executeJavaScript(`(async () => {
    const api=window.PulseThemes,inputs=[...document.querySelectorAll('#theme-options input[type="radio"]')];
    const settings=await window.pulse.getSettings();
    return {available:!!api,ids:api?.list?.map(theme=>theme.id)||[],original:api?.normalize(settings.interfaceTheme),view:document.querySelector('.nav-button.active')?.dataset.view,
      nativeChoices:inputs.length===8&&inputs.every(input=>input.name.startsWith('interface-theme-')&&input.closest('label')?.dataset.themeId===input.value)&&new Set(inputs.map(input=>input.name)).size===1,
      fallback:api?.normalize('__unknown_theme__')===api?.DEFAULT_THEME};
  })()`);
  const expectedThemes=['carbon-lime','electric-purple','ember-orange','charcoal-pink','wisteria-lime','neon-pop','klein-yellow','mars-rose'];
  interaction.themeChoices = themeSetup.available && themeSetup.nativeChoices && themeSetup.fallback && JSON.stringify(themeSetup.ids)===JSON.stringify(expectedThemes);
  const themeResults=[];
  if (interaction.themeChoices) {
    const selectTheme = id => dashboard.webContents.executeJavaScript(`(async () => {
      const id=${JSON.stringify(id)};
      document.querySelector('[data-view="settings"]').click();
      const input=[...document.querySelectorAll('#theme-options input[type="radio"]')].find(input=>input.value===id);
      input.click();
      const deadline=Date.now()+5000;
      let settings=await window.pulse.getSettings();
      while(Date.now()<deadline&&(settings.interfaceTheme!==id||document.documentElement.dataset.interfaceTheme!==id)){
        await new Promise(resolve=>setTimeout(resolve,50));settings=await window.pulse.getSettings();
      }
      document.querySelector('[data-view="overview"]').click();
      const transitions=document.getAnimations().filter(animation=>animation instanceof CSSTransition&&(animation.playState==='running'||animation.pending));
      let timeout;
      await Promise.race([Promise.allSettled(transitions.map(animation=>animation.finished)),new Promise(resolve=>{timeout=setTimeout(resolve,300);})]);
      clearTimeout(timeout);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const rail=document.querySelector('.dashboard-rail'),active=rail.querySelector('.nav-button.active');
      return {id,persisted:settings.interfaceTheme===id,applied:document.documentElement.dataset.interfaceTheme===id,
        selected:input.checked&&document.querySelectorAll('#theme-options input:checked').length===1,
        background:getComputedStyle(document.body).backgroundColor,rail:getComputedStyle(rail).backgroundColor,
        feature:getComputedStyle(document.querySelector('#stats-grid > .stat-card:nth-child(2)')).backgroundColor,
        references:window.PulseThemes.get(id).colors,
        active:getComputedStyle(active).backgroundColor,railWidth:rail.getBoundingClientRect().width,
        withinViewport:document.documentElement.scrollWidth<=innerWidth};
    })()`);
    try {
      for (const id of themeSetup.ids) {
        const result=await selectTheme(id),capture=await captureDashboard(dashboard.webContents,id);
        themeResults.push({...result,capture:capture.validation});
        // Capture only this app's web contents, never the user's desktop.
        fs.writeFileSync(path.join(out, `theme-${id}.png`),capture.image.toPNG());
      }
    } finally {
      const restored=await selectTheme(themeSetup.original);
      interaction.themeRestore=restored.persisted&&restored.applied&&restored.selected;
      if(themeSetup.view==='settings') await dashboard.webContents.executeJavaScript(`document.querySelector('[data-view="settings"]').click()`);
    }
    interaction.themePersistence=themeResults.length===expectedThemes.length&&themeResults.every(result=>result.persisted&&result.applied&&result.selected);
    interaction.themeScreenshotPixels=themeResults.length===expectedThemes.length&&themeResults.every(result=>result.capture.matched);
    const rgb=color=>color.startsWith('#')?color.slice(1).match(/../g).map(channel=>parseInt(channel,16)).join(','):color.match(/[0-9.]+/g).slice(0,3).map(Number).join(',');
    interaction.completeReferencePalettes=themeResults.length===expectedThemes.length&&themeResults.every(result=>result.references.every(color=>[result.background,result.rail,result.feature].some(actual=>rgb(actual)===rgb(color))));
    interaction.themeVisualVariation=new Set(themeResults.map(result=>result.background+'|'+result.rail)).size===expectedThemes.length&&themeResults.every(result=>result.withinViewport&&Math.abs(result.railWidth-60)<1&&Math.max(...result.active.match(/[0-9.]+/g).slice(0,3).map(Number))<100);
    interaction.themeScopedToDashboard=await island.webContents.executeJavaScript(`!document.documentElement.dataset.interfaceTheme&&!window.PulseThemes`);
  }
  const originalEdge = await dashboard.webContents.executeJavaScript(`(async () => (await window.pulse.getSettings()).islandEdge || 'refract')()`);
  const setEdgeMode = async mode => {
    const saved=await dashboard.webContents.executeJavaScript(`window.pulse.saveSettings({islandEdge:${JSON.stringify(mode)}})`);
    const applied=await island.webContents.executeJavaScript(`(async () => {
      const deadline=Date.now()+2000;
      while(Date.now()<deadline&&document.documentElement.dataset.liquidEdge!==${JSON.stringify(mode)}) await new Promise(resolve=>setTimeout(resolve,25));
      return document.documentElement.dataset.liquidEdge===${JSON.stringify(mode)};
    })()`);
    return saved.islandEdge===mode&&applied;
  };
  let syntheticRefraction;
  try {
    interaction.refractionModeIPC=await setEdgeMode('refract');
    const map=buildEdgeMap({...ISLAND_COMPACT,radius:22,thickness:6,padding:10});
    const source=Buffer.alloc(map.sourceByteLength);
    // Explicit synthetic BGRA pattern: this path never captures desktop pixels.
    for(let y=0;y<map.sourceHeight;y++)for(let x=0;x<map.sourceWidth;x++){
      const offset=(y*map.sourceWidth+x)*4;
      source[offset]=x%256;source[offset+1]=(y*7)%256;source[offset+2]=160;source[offset+3]=255;
    }
    island.webContents.send('pulse:refraction-frame',{active:true,width:map.width,height:map.height,pixels:refractEdges(source,map)});
    await new Promise(resolve=>setTimeout(resolve,80));
    syntheticRefraction=await island.webContents.executeJavaScript(`(() => {
      const canvas=document.querySelector('.refraction-canvas'),edge=document.querySelector('.liquid-edge');
      if(!canvas||!edge)return null;
      const context=canvas.getContext('2d'),middle=context.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;
      const rim=context.getImageData(Math.floor(canvas.width/2),2,1,1).data,corner=context.getImageData(0,0,1,1).data;
      const bounds=canvas.getBoundingClientRect();
      return {width:canvas.width,height:canvas.height,visible:!canvas.hidden,centerAlpha:middle[3],rimAlpha:rim[3],cornerAlpha:corner[3],bridge:typeof window.pulse.onRefractionFrame==='function',passThrough:getComputedStyle(canvas).pointerEvents==='none'&&getComputedStyle(edge).pointerEvents==='none',viewportAligned:bounds.left===0&&bounds.top===0&&Math.abs(bounds.width-innerWidth)<1&&Math.abs(bounds.height-innerHeight)<1};
    })()`);
    interaction.syntheticRefractionFrame=!!syntheticRefraction&&syntheticRefraction.width===ISLAND_COMPACT.width&&syntheticRefraction.height===ISLAND_COMPACT.height&&syntheticRefraction.visible&&syntheticRefraction.centerAlpha===0&&syntheticRefraction.cornerAlpha===0&&syntheticRefraction.rimAlpha>0&&syntheticRefraction.bridge&&syntheticRefraction.passThrough;
    interaction.refractionViewportAlignment=syntheticRefraction?.viewportAligned===true;
    interaction.softTranslucentBevel=Math.max(...map.coverage)<=72&&await island.webContents.executeJavaScript(`(() => {
      const root=document.getElementById('island'),edge=document.querySelector('.liquid-edge');
      return getComputedStyle(root).boxShadow==='none'&&getComputedStyle(root,'::after').content==='none'&&getComputedStyle(edge,'::after').content==='none'&&getComputedStyle(document.querySelector('.refraction-canvas')).filter.includes('blur(0.8px)');
    })()`);
    fs.writeFileSync(path.join(out,'island-synthetic-refraction.png'),(await island.webContents.capturePage()).toPNG());
    await islandExpansion(true);
    island.webContents.send('pulse:refraction-frame',{active:true,width:map.width,height:map.height,pixels:refractEdges(source,map)});
    await new Promise(resolve=>setTimeout(resolve,40));
    interaction.staleRefractionAfterResize=await island.webContents.executeJavaScript(`document.querySelector('.refraction-canvas').hidden&&innerHeight===${ISLAND_EXPANDED.height}`);
    await islandExpansion(false);
    island.webContents.send('pulse:refraction-frame',{active:false});
    await new Promise(resolve=>setTimeout(resolve,30));
    interaction.refractionFrameReset=await island.webContents.executeJavaScript(`(() => {const canvas=document.querySelector('.refraction-canvas');return canvas.hidden&&canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),2,1,1).data[3]===0;})()`);
    interaction.edgeOffMode=await setEdgeMode('off')&&await island.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.liquid-edge')).display==='none'&&document.querySelector('.refraction-canvas').hidden`);
    interaction.edgeLightMode=await setEdgeMode('light')&&await island.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.liquid-edge')).display!=='none'&&document.querySelector('.refraction-canvas').hidden`);
  } finally {
    interaction.edgeModeRestore=await setEdgeMode(originalEdge);
    island.webContents.send('pulse:refraction-frame',{active:false});
  }
  interaction.refractionSamplingDisabled=snapshot().refraction?.enabled===false&&snapshot().refraction?.frames===0;
  interaction.refractionPreservesRecording=snapshot().refraction?.captureExcluded===false;
  interaction.audioFrameBridge = await island.webContents.executeJavaScript(`typeof window.pulse.onAudioFrame==='function' && getComputedStyle(document.querySelector('.drag-handle span')).transform!=='none'`);
  const mediaSample = process.env.PULSE_MEDIA_SAMPLE;
  if (mediaSample && fs.existsSync(mediaSample)) {
    const sample = JSON.parse(fs.readFileSync(mediaSample, 'utf8'));
    const send = value => island.webContents.send('pulse:media-update', value);
    send({ ...sample, rotationMode: 'rotate' });
    await new Promise(resolve=>setTimeout(resolve,300));
    interaction.realMediaCover = await island.webContents.executeJavaScript(`!document.getElementById('music-cover').hidden && document.getElementById('agent-orb').hidden && document.getElementById('music-cover').naturalWidth===96`);
    interaction.coverRotation = await island.webContents.executeJavaScript(`getComputedStyle(document.getElementById('music-cover')).animationName==='pulse-record-spin' && getComputedStyle(document.getElementById('music-cover')).animationPlayState==='running'`);
    send({ ...sample, playing: false, rotationMode: 'rotate' }); await new Promise(resolve=>setTimeout(resolve,50));
    interaction.coverPause = await island.webContents.executeJavaScript(`getComputedStyle(document.getElementById('music-cover')).animationPlayState==='paused'`);
    send({ available: false }); await new Promise(resolve=>setTimeout(resolve,50));
    interaction.coverFallback = await island.webContents.executeJavaScript(`document.getElementById('music-cover').hidden && !document.getElementById('agent-orb').hidden`);
  }
  await dashboard.webContents.executeJavaScript(`document.querySelector('[data-view="overview"]').click()`);
  const dashboardCapture=await captureDashboard(dashboard.webContents,themeSetup.original);
  interaction.dashboardScreenshotPixels=dashboardCapture.validation.matched;
  fs.writeFileSync(path.join(out, 'dashboard.png'),dashboardCapture.image.toPNG());
  await islandExpansion(false);await new Promise(resolve=>setTimeout(resolve,300));await island.webContents.capturePage();
  const compactCapture = await island.webContents.capturePage(), compactBitmap = compactCapture.toBitmap(), compactSize = compactCapture.getSize();
  const compactAlpha = { corner: compactBitmap[3], interior: compactBitmap[(Math.floor(compactSize.height / 2) * compactSize.width + Math.floor(compactSize.width / 2)) * 4 + 3] };
  if (material === 'css') interaction.realTransparentPixels = compactAlpha.corner === 0 && compactAlpha.interior > 0 && compactAlpha.interior < 220;
  fs.writeFileSync(path.join(out, 'island-compact.png'), compactCapture.toPNG());
  await islandExpansion(true);await new Promise((resolve) => setTimeout(resolve, 300));
  interaction.islandExpansion = getExpanded() && island.getBounds().width === ISLAND_EXPANDED.width && await island.webContents.executeJavaScript(`!document.getElementById('island-details').hidden`);
  interaction.expandedSessionLayout = await island.webContents.executeJavaScript(`(() => {
    const row=document.querySelector('.detail-topline').getBoundingClientRect(),select=document.getElementById('island-session-select').getBoundingClientRect();
    const feed=document.getElementById('activity-feed').getBoundingClientRect();
    return !document.getElementById('island-pin') && !document.getElementById('island-close') && Math.abs(row.right-select.right)<2 && Math.abs(row.left-select.left)<2 && feed.bottom<innerHeight && !document.querySelector('.island-footer');
  })()`);
  interaction.noModelSubline = await island.webContents.executeJavaScript(`!document.getElementById('island-model')`);
  await island.webContents.executeJavaScript(`document.getElementById('island-session-select').showPicker()`, true);
  await new Promise(resolve=>setTimeout(resolve,80));
  const picker = await island.webContents.executeJavaScript(`(() => {
    const select=document.getElementById('island-session-select'),trigger=select.getBoundingClientRect(),style=getComputedStyle(select,'::picker(select)');
    const first=select.options[0].getBoundingClientRect();
    return {open:select.matches(':open'),appearance:getComputedStyle(select).appearance,triggerWidth:trigger.width,pickerWidth:style.width,firstLeft:first.left,firstRight:first.right,triggerLeft:trigger.left,triggerRight:trigger.right,background:style.backgroundColor,maxHeight:style.maxHeight};
  })()`);
  interaction.boundedGlassPicker = picker.open && picker.appearance==='base-select' && Math.abs(Number.parseFloat(picker.pickerWidth)-picker.triggerWidth)<2 && picker.firstRight<=picker.triggerRight+1 && picker.firstLeft>=picker.triggerLeft && picker.background!=='rgb(41, 50, 62)';
  fs.writeFileSync(path.join(out, 'session-picker.png'), (await island.webContents.capturePage()).toPNG());
  // Disconnect the test picker to dismiss its native top-layer popup. Synthetic
  // DOM Escape does not perform trusted browser default actions.
  await island.webContents.executeJavaScript(`(async () => { const select=document.getElementById('island-session-select'),parent=select.parentNode,next=select.nextSibling;select.remove();await new Promise(resolve=>requestAnimationFrame(resolve));parent.insertBefore(select,next);document.getElementById('island-toggle').focus(); })()`);
  await new Promise(resolve=>setTimeout(resolve,30));
  Object.assign(interaction, await island.webContents.executeJavaScript(`(() => {
    const checks={},copy=document.querySelector('.island-copy').getBoundingClientRect(),header=document.querySelector('.island-header').getBoundingClientRect();
    const metrics=document.querySelector('.compact-metrics').getBoundingClientRect(),avatar=document.getElementById('agent-avatar').getBoundingClientRect();
    const feed=document.getElementById('activity-feed'),viewport=document.getElementById('activity-viewport'),track=document.getElementById('activity-track'),api=window.PulseActivityFeed;
    checks.centeredHeader=Math.abs(copy.left+copy.width/2-(header.left+header.width/2))<1 && copy.left>avatar.right && copy.right<metrics.left && copy.top>=header.top && copy.bottom<=header.bottom;
    checks.readableType=Number.parseFloat(getComputedStyle(document.getElementById('island-title')).fontSize)>=13 && Number.parseFloat(getComputedStyle(document.querySelector('.island-token-grid small')).fontSize)>=11 && Number.parseFloat(getComputedStyle(document.querySelector('.activity-entry')).fontSize)>=13;
    checks.distinctReadingColor=getComputedStyle(document.querySelector('.activity-entry')).color!==getComputedStyle(document.getElementById('expanded-cost')).color;
    const historyColumns=[...document.querySelectorAll('.island-token-grid > div')],historyWidths=historyColumns.map(column=>column.getBoundingClientRect().width);
    checks.equalCenteredHistoryColumns=historyColumns.length===4 && Math.max(...historyWidths)-Math.min(...historyWidths)<1 && historyColumns.every(column=>{
      const label=column.querySelector('small'),number=column.querySelector('strong'),cell=column.getBoundingClientRect();
      if(!label||!number)return false;
      return getComputedStyle(column).alignItems==='center' && getComputedStyle(label).textAlign==='center' && getComputedStyle(number).textAlign==='center' && [label,number].every(element=>{const rect=element.getBoundingClientRect();return Math.abs(cell.left+cell.width/2-rect.left-rect.width/2)<1;});
    });
    checks.noRedundantFooter=!document.getElementById('island-footer-note')&&!document.getElementById('island-dashboard');
    checks.hiddenScrollbar=getComputedStyle(viewport).scrollbarWidth==='none'&&getComputedStyle(viewport).overflowY==='auto';
    const headerStatus=document.getElementById('island-title'),headerApi=window.PulseHeaderStatus,originalHeight=headerStatus.getBoundingClientRect().height;
    headerApi.setMotion('scroll');headerApi.update({sessionId:'__header_check__',key:'one',text:'正在读取项目文件'});
    headerApi.update({sessionId:'__header_check__',key:'two',text:'正在执行检查'});
    checks.oneLineHarnessSlide=originalHeight===16&&headerStatus.getBoundingClientRect().height===16&&headerStatus.children.length===2&&headerStatus.getAnimations({subtree:true}).length===2;
    headerApi.update({sessionId:'__other_chat__',key:'three',text:'等待你的输入'});
    checks.harnessSwitchCancelsOldState=headerStatus.children.length===1&&headerStatus.textContent==='等待你的输入'&&headerStatus.getAnimations({subtree:true}).length===0;
    const a={id:'smoke-a',type:'text',text:'第一条活动',timestamp:'2026-10-28T00:00:00Z'},b={id:'smoke-b',type:'text',text:'新消息进入玻璃消息框。'.repeat(90),timestamp:'2026-10-28T00:00:01Z'};
    api.setMotion('scroll');api.setExpanded(true);api.update({sessionId:'__feed_check__',events:[a]});
    api.update({sessionId:'__feed_check__',events:[a,b]});
    checks.upwardReplacement=feed.dataset.activityTransitioning==='true'&&track.children.length===2&&track.getAnimations({subtree:true}).length===2;
    checks.longMessageTransitionBound=[...track.children].every(node=>Math.abs(node.getBoundingClientRect().height-viewport.clientHeight)<2);
    api.setExpanded(false);
    checks.cancelFeedOnCollapse=feed.dataset.activityTransitioning==='false'&&track.children.length===1&&track.getAnimations({subtree:true}).length===0;
    viewport.scrollTop=25;
    checks.longMessageScroll=viewport.scrollHeight>viewport.clientHeight&&viewport.scrollTop>0;
    api.setExpanded(true);api.setMotion('still');
    api.update({sessionId:'__clean_check__',events:[{id:'clean',type:'text',text:'**助手消息** :codex-annotation{index="1"}',timestamp:'2026-10-28T00:00:02Z'}]});
    checks.cleanMessagePreview=track.textContent==='助手消息';
    api.setMotion('scroll');
    return checks;
  })()`));
  broadcast();
  await new Promise(resolve=>setTimeout(resolve,100));
  const nativeMaterial = getMaterialDiagnostics(island);
  interaction.materialMatchesSystemPreference = nativeMaterial?.systemTransparencyEnabled === false
    ? nativeMaterial.backend === 'per-pixel-transparent' && nativeMaterial.fallbackReason === 'system-transparency-disabled'
    : nativeMaterial?.backend === 'native-hwnd-blur' && nativeMaterial.nativeAccentAccepted === true && nativeMaterial.requestedAccentState === 4;
  interaction.tightCapsuleBounds = island.getBounds().width === ISLAND_EXPANDED.width && island.getBounds().height === ISLAND_EXPANDED.height && await island.webContents.executeJavaScript(`getComputedStyle(document.body).padding==='0px' && document.querySelector('.island').getBoundingClientRect().x===0`);
  fs.writeFileSync(path.join(out, 'island-expanded.png'), (await island.webContents.capturePage()).toPNG());
  const chosenSession = await island.webContents.executeJavaScript(`(() => {
    const select=document.getElementById('island-session-select'), options=[...select.options];
    const available=options.filter(option=>option.value);
    if(!available.length) return null;
    select.value=available.at(-1).value; select.dispatchEvent(new Event('change',{bubbles:true}));
    return {id:select.value,optionCount:available.length,title:document.getElementById('island-title').title};
  })()`);
  if (chosenSession) {
    const expected = monitor.getSnapshot().sessions.find(value=>value.id===chosenSession.id);
    interaction.islandSessionSwitch = chosenSession.title === expected?.title && chosenSession.optionCount === monitor.getSnapshot().sessions.filter(value=>!value.isSubagent).length;
    broadcast(); await new Promise(resolve=>setTimeout(resolve,150));
    interaction.islandSelectionSurvivesUpdate = await island.webContents.executeJavaScript(`document.getElementById('island-session-select').value`) === chosenSession.id;
  }
  await island.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await new Promise(resolve=>setTimeout(resolve,150));
  interaction.islandEscapeCollapse = !getExpanded() && island.getBounds().width === ISLAND_COMPACT.width && island.getBounds().height === ISLAND_COMPACT.height;
  const materialPreview=await previewMaterial({island,out,ROOT});
  interaction.materialComparison=materialPreview.passed;
  interaction.materialPreviewRestored=materialPreview.restored;
  Object.assign(interaction,await checkIslandChrome(island));
  let anime={skipped:true,reason:'User reserved anime/movie checks for manual review'},player={skipped:true};
  if(process.env.PULSE_INCLUDE_MEDIA_CHECKS==='1'){
  anime=await checkAnime({dashboard,out});anime.status=animeBridge.getStatus();Object.assign(interaction,anime.checks);
  const selectedEpisode=await dashboard.webContents.executeJavaScript(`(async()=>{const api=async(action,payload={})=>{const result=await window.pulse.animeRequest(action,payload);if(result?.error&&!result.ruleId)throw new Error(result.error);return result;};await api('detail',{id:400602});const source=await api('searchSource',{ruleId:'giriGiriLove',keyword:'葬送的芙莉莲'}),match=source.items.find(item=>item.title==='葬送的芙莉莲');if(!match)throw new Error('未返回可测试的真实番剧来源');const episodes=await api('episodes',{ruleId:source.ruleId,url:match.url});return {id:400602,ruleId:source.ruleId,episode:episodes.lines[0].episodes[0]};})()`);
  const playbackPlan=await animeBridge.preparePlayback(selectedEpisode),nativeDirectory=app.isPackaged?path.join(process.resourcesPath,'native/player'):path.join(ROOT,'native/player/resources');
  player=await checkEmbeddedPlayer({electron:require('electron'),root:ROOT,owner:dashboard,out:path.join(out,'player'),dataDir:path.join(out,'player-preferences'),plan:playbackPlan,onProgress:value=>dashboard.webContents.executeJavaScript(`window.pulse.animeRequest('historyProgress',${JSON.stringify(value)})`),nativeOptions:{executablePath:app.isPackaged?path.join(nativeDirectory,'AgentPulse.Player.exe'):path.join(ROOT,'native/player/bin/AgentPulse.Player.exe'),libraryPath:path.join(nativeDirectory,'libmpv-2.dll'),shaderDirectory:path.join(nativeDirectory,'shaders')}});
  Object.assign(interaction,player.checks);interaction.playerIntegration=!player.error;
  interaction.playbackHistoryOnHome=await dashboard.webContents.executeJavaScript(`(async()=>{document.getElementById('nav-anime').click();const root=document.getElementById('anime-view');root.querySelector('[data-category="主页"]').click();for(let i=0;i<80;i++){const card=root.querySelector('[data-history="${playbackPlan.subject.id}"]');if(card){const saved=await window.pulse.animeRequest('history');return saved.history.some(record=>record.id===${playbackPlan.subject.id}&&record.position>=1);}await new Promise(resolve=>setTimeout(resolve,100));}return false;})()`);
  }
  const data = snapshot();
  const report = { version: app.getVersion(), material, materialPreview, dashboardDrag, monitorLayout, anime, player, materialDiagnostics: data.materialDiagnostics, compactAlpha, picker, themes:themeResults, dashboardCapture:dashboardCapture.validation, syntheticRefraction, refraction:data.refraction, dashboard: check, island: islandCheck, interaction, rendererErrors, sessions: data.sessions.length, conversations: data.sessions.filter(value=>!value.isSubagent).length, projects: data.projects.map(({id,name,sessionIds,totals,today})=>({id,name,sessions:sessionIds.length,totals,today})), processes: data.processes.map(({ name, pid }) => ({ name, pid })), totals: data.totals, today: data.today, diagnostics: data.diagnostics };
  fs.writeFileSync(path.join(out, 'smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ smoke: true, version: app.getVersion(), output: out, sessions: report.sessions, errors: rendererErrors, interaction, hasBridge: check.hasBridge, hasNode: check.hasNode }));
  quit(rendererErrors.length || Object.values(interaction).some(value=>value!==true) || !check.hasBridge || check.hasNode || check.scrollWidth > check.width ? 1 : 0);
}

module.exports={runSmoke};
