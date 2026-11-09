'use strict';
const fs=require('node:fs'),path=require('node:path');

// Real public network and actual rendered UI; never inserts viewing history.
async function checkAnime({dashboard,out}){
  const result=await dashboard.webContents.executeJavaScript(`(async()=>{
    const checks={},sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const api=async(action,payload={})=>{const result=await window.pulse.animeRequest(action,payload);if(result?.error)throw new Error(result.error);return result;};
    const nav=[...document.querySelectorAll('.rail-navigation [data-view]')].map(b=>b.dataset.view);
    checks.animeRailOrder=JSON.stringify(nav)===JSON.stringify(['overview','anime','movies','music','settings']);
    document.getElementById('nav-anime').click();
    try{
      const bootstrap=await api('bootstrap');
      checks.kazumiRulesImported=bootstrap.rules.length===18&&bootstrap.rules.some(r=>r.name==='AGE')&&bootstrap.rules.some(r=>r.searchMode==='api');
      checks.kazumiNetworkDefaults=bootstrap.network.bangumi==='mirror'&&bootstrap.network.rules==='ghProxy'&&bootstrap.network.images==='ech'&&bootstrap.networkOptions.rules.length===4;
      for(let i=0;i<160&&!document.querySelector('.anime-feature-card');i++)await sleep(125);
      const root=document.getElementById('anime-view');
      checks.animeHomeLayout=!root.hidden&&document.getElementById('monitor-view').hidden&&root.querySelectorAll('.anime-feature-card').length===5&&root.querySelectorAll('.anime-hero').length===1&&root.querySelectorAll('.anime-featured-row .anime-feature-card').length===4;
      checks.persistedViewingHistory=bootstrap.history.length===0?root.querySelector('.anime-history-list')?.children.length===0:bootstrap.history.slice(0,5).every(record=>root.querySelector('[data-history="'+record.id+'"]'));
      for(let i=0;i<400&&![...root.querySelectorAll('.anime-feature-card img')].every(img=>img.complete&&img.naturalWidth>0);i++)await sleep(100);
      // Async-decoding posters can have dimensions before they are ready to
      // paint. Wait for decoded pixels before taking the hidden-window frame.
      await Promise.all([...root.querySelectorAll('.anime-poster img')].filter(img=>img.complete&&img.naturalWidth>0).map(img=>img.decode().catch(()=>{})));
      checks.realAnimeCovers=[...root.querySelectorAll('.anime-feature-card img')].length===5&&[...root.querySelectorAll('.anime-feature-card img')].every(img=>img.complete&&img.naturalWidth>0&&!img.hidden&&getComputedStyle(img).display!=='none'&&img.src.startsWith('pulse-anime-image:'));
      const viewport=root.querySelector('.anime-category-viewport');viewport.scrollLeft=200;
      checks.animeCategoryScroll=viewport.scrollWidth>viewport.clientWidth&&viewport.scrollLeft>0&&getComputedStyle(viewport).scrollbarWidth==='none'&&viewport.hasAttribute('data-no-window-drag');viewport.scrollLeft=0;
      checks.animeNoOverflow=document.documentElement.scrollWidth<=innerWidth&&root.getBoundingClientRect().right<=document.querySelector('.dashboard-rail').getBoundingClientRect().left;
      return {checks,bootstrap:{rules:bootstrap.rules.map(r=>({name:r.name,version:r.version})),network:bootstrap.network},covers:[...root.querySelectorAll('.anime-feature-card img')].map(img=>({src:img.src,complete:img.complete,width:img.naturalWidth,hidden:img.hidden})),visibleTitles:[...root.querySelectorAll('.anime-feature-copy>strong')].map(n=>n.textContent)};
    }catch(error){return {checks,error:error.stack};}
  })()`);
  if(result.error){result.checks.animeLiveNetwork=false;}
  else{
    await dashboard.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await dashboard.webContents.capturePage();
    await new Promise(resolve=>setTimeout(resolve,120));
    fs.writeFileSync(path.join(out,'anime-home.png'),(await dashboard.webContents.capturePage()).toPNG());
    Object.assign(result.checks,await dashboard.webContents.executeJavaScript(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms)),root=document.getElementById('anime-view'),checks={};
      root.querySelector('[data-action="settings"]').click();
      for(let i=0;i<40&&!root.querySelector('.anime-rule-row');i++)await sleep(50);
      checks.animeRulesUI=root.querySelectorAll('.anime-rule-row').length===18;
      const tabs=[...root.querySelectorAll('[data-settings-tab]')];tabs.find(b=>b.dataset.settingsTab==='network')?.click();
      checks.animeNetworkUI=root.querySelectorAll('[data-network]').length===3&&[...root.querySelectorAll('[data-network]')].map(s=>s.value).join(',')==='mirror,ghProxy,ech';
      const wait=async predicate=>{for(let i=0;i<240;i++){if(predicate())return;await sleep(100);}throw new Error('番剧交互检查超时');};
      root.querySelector('#anime-query').value='钢之炼金术士';root.querySelector('.anime-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      await wait(()=>root.querySelectorAll('.anime-grid-card').length>0);
      checks.fullCatalogSearch=[...root.querySelectorAll('.anime-grid-card')].some(card=>/钢之炼金术/.test(card.textContent));
      const hot=root.querySelector('[data-category="热门"]');hot.click();await wait(()=>root.querySelector('.anime-results-heading h1')?.textContent==='热门'&&root.querySelectorAll('.anime-grid-card').length>=20);
      const first=root.querySelector('.anime-grid-card'),firstCount=root.querySelectorAll('.anime-grid-card').length,scroll=document.querySelector('.content-scroll');scroll.scrollTop=scroll.scrollHeight;scroll.dispatchEvent(new Event('scroll'));
      await wait(()=>root.querySelectorAll('.anime-grid-card').length>firstCount);
      checks.continuousCatalogLoading=root.querySelector('.anime-grid-card')===first&&root.querySelectorAll('.anime-grid-card').length>firstCount;
      checks.noGenericHomepageError=root.querySelector('.anime-message').hidden||root.querySelector('.anime-message').textContent.trim()!=='Error';
      root.querySelector('[data-category="主页"]').click();await wait(()=>root.querySelector('.anime-hero'));
      document.getElementById('nav-overview').click();checks.animeNavigationRestoresMonitor=!document.getElementById('monitor-view').hidden&&root.hidden;
      return checks;
    })()`));
  }
  // Cleanup even when an endpoint failed; old diagnostics can still run.
  await dashboard.webContents.executeJavaScript(`document.getElementById('nav-overview').click()`);
  return result;
}
module.exports={checkAnime};
