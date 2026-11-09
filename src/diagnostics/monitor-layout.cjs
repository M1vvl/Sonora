'use strict';
// Hidden-window geometry checks run only during explicit release diagnostics.
// They use actual Chromium layout, including statistics range changes.
async function checkMonitorLayout(dashboard){
  const web=dashboard.webContents,original=dashboard.getBounds(),originalContent=dashboard.getContentSize(),samples=[];
  const previous=await web.executeJavaScript(`({view:document.querySelector('.nav-button.active')?.dataset.view,range:document.querySelector('[data-range].active')?.dataset.range,scroll:document.querySelector('.content-scroll').scrollTop,composition:!!document.querySelector('.token-composition')?.open})`);
  try{
    await web.executeJavaScript(`document.querySelector('[data-view="overview"]').click()`);
    for(const [width,height] of [[960,660],[960,850],[1100,850],[1260,850],[1536,1000]]){
      dashboard.setContentSize(width,height);
      // Hidden Chromium views may defer resize acknowledgement until a frame
      // is requested. Bound the synchronization and verify the requested width.
      for(let attempt=0;attempt<12;attempt++){
        await web.capturePage();
        if(await web.executeJavaScript(`innerWidth===${width}&&innerHeight===${height}`))break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      for(const range of ['today','history'])for(const expanded of [false,true]){
        samples.push(await web.executeJavaScript(`(async()=>{
          document.querySelector('[data-range="${range}"]').click();document.querySelector('.content-scroll').scrollTop=0;
          const composition=document.querySelector('.token-composition');if(composition)composition.open=${expanded};
          await new Promise(resolve=>setTimeout(resolve,70));
          const root=document.getElementById('monitor-view'),main=document.querySelector('main'),toolbar=root.querySelector('.range-toolbar');
          const box=element=>element.getBoundingClientRect().toJSON(),mainBox=box(main),row=box(toolbar),tabs=box(root.querySelector('.range-tabs')),stats=box(document.getElementById('stats-grid'));
          const buttons=[document.getElementById('refresh-button'),document.getElementById('island-button')].map(box),date=document.getElementById('day-picker'),dateBox=box(date.querySelector('input'));
          const activity=document.getElementById('token-activity'),detail=document.getElementById('detail-panel'),project=root.querySelector('.sessions-panel'),outer=document.querySelector('.content-scroll');
          const bottom={activity:box(activity),detail:box(detail),project:box(project),rail:box(document.querySelector('.dashboard-rail'))},events=detail.querySelector('.event-list');
          const firstCell=activity.querySelector('.token-activity-cell'),tile=box(firstCell),months=box(activity.querySelector('.token-activity-months'));
          const near=(a,b)=>Math.abs(a-b)<.75;
          return {width:innerWidth,height:innerHeight,range:${JSON.stringify(range)},expanded:${expanded},row,tabs,buttons,date:date.hidden?null:dateBox,bottom,tile,months,readable:{projects:root.querySelector('.sessions-list').clientHeight,events:events?.clientHeight,eventBottom:events?box(events).bottom:null},
            checks:{removedMonitorCopy:!root.querySelector('.page-heading,#page-title,#page-description,#range-description,.billing-strip,#pricing-source,#monitor-scope'),
              monitorViewportSize:innerWidth===${width}&&innerHeight===${height},
              equalMonitorGutters:near(row.top,24)&&near(row.left-mainBox.left,24)&&near(mainBox.right-row.right,24),
              alignedMonitorControls:buttons.every(b=>near(b.top,tabs.top)&&near(b.bottom,tabs.bottom))&&(date.hidden||near(dateBox.top,tabs.top)&&near(dateBox.bottom,tabs.bottom)),
              alignedMonitorColumns:near(stats.left,row.left)&&near(stats.right,row.right)&&near(buttons[1].right,row.right),
              alignedSummaryGap:near(box(document.getElementById('history-overview')).top-stats.bottom,12),
              monitorControlsFit:tabs.right+12<=buttons[0].left&&(date.hidden||dateBox.right+12<=buttons[0].left)&&document.documentElement.scrollWidth<=innerWidth&&toolbar.scrollWidth<=toolbar.clientWidth,
              monitorRangeDate:date.hidden===(${JSON.stringify(range)}==='history'),
              removedGlobalFooter:!document.querySelector('.page-footer,#footer-status')&&!document.body.textContent.includes('LOCAL BY DESIGN'),
              sharedBottomEdge:near(bottom.detail.bottom,bottom.activity.bottom)&&near(bottom.activity.bottom,bottom.rail.bottom)&&near(innerHeight-bottom.activity.bottom,12),
              symmetricRailInsets:near(bottom.rail.top,innerHeight-bottom.rail.bottom)&&near(bottom.rail.top,12),
              alignedMonitorStack:near(bottom.activity.left,bottom.project.left)&&near(bottom.activity.right,bottom.project.right)&&near(bottom.project.top,bottom.detail.top),
              noMonitorPageOverflow:getComputedStyle(outer).overflowY==='hidden'&&outer.scrollHeight<=outer.clientHeight+1&&root.scrollHeight<=root.clientHeight+1,
              usableMonitorPanels:root.querySelector('.sessions-list').clientHeight>=32&&(!events||events.clientHeight>=79),
              detailContentFillsRemovedFooter:!detail.querySelector('.detail-footer')&&(!events||near(box(events).bottom,bottom.detail.bottom-1)),
              activityFooterRemoved:!activity.querySelector('.token-activity-footer,.token-activity-period,.token-activity-legend'),
              enlargedSquareActivityCells:tile.width>=7.99&&near(tile.width,tile.height),
              activityFitsPanel:activity.scrollHeight<=activity.clientHeight+1&&months.bottom<=bottom.activity.bottom-3}};
        })()`));
      }
    }
    const keys=Object.keys(samples[0].checks);
    return {checks:Object.fromEntries(keys.map(key=>[key,samples.every(sample=>sample.checks[key]===true)])),samples};
  }finally{
    dashboard.setBounds(original);
    for(let attempt=0;attempt<12;attempt++){await web.capturePage();if(await web.executeJavaScript(`innerWidth===${originalContent[0]}&&innerHeight===${originalContent[1]}`))break;await new Promise(resolve=>setTimeout(resolve,50));}
    await web.executeJavaScript(`document.querySelector('[data-range="${previous.range==='history'?'history':'today'}"]').click();const composition=document.querySelector('.token-composition');if(composition)composition.open=${previous.composition};document.querySelector('[data-view="${['overview','settings','anime'].includes(previous.view)?previous.view:'overview'}"]').click();document.querySelector('.content-scroll').scrollTop=${Number(previous.scroll)||0}`);
  }
}
module.exports={checkMonitorLayout};
