'use strict';
// Real dashboard integration: verify the graph consumes the same deduped daily
// snapshot as the existing counters. No invented sample records are persisted.
async function checkTokenActivity(dashboard){
  return dashboard.webContents.executeJavaScript(`(async()=>{
    document.querySelector('[data-view="overview"]').click();
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let snapshot=await window.pulse.getSnapshot();
    for(let i=0;i<180&&snapshot.diagnostics?.loading;i++){await pause(250);snapshot=await window.pulse.getSnapshot();}
    acceptSnapshot(snapshot);await pause(40);snapshot=state.snapshot||snapshot;
    const root=document.getElementById('token-activity'),checks={},today=beijingDay(),format=value=>value>=1e8?(value/1e8).toFixed(1)+'亿':(value/1e4).toFixed(1)+'万';
    const value=day=>Number.isFinite(day.total)?day.total:(Number(day.input)||0)+(Number(day.output)||0),rows=snapshot.dailyUsage||[];
    const todayTotal=rows.filter(day=>day.date===today).reduce((sum,day)=>sum+value(day),0),date=new Date(today+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
    const monday=date.toISOString().slice(0,10),weekTotal=rows.filter(day=>day.date>=monday&&day.date<=today).reduce((sum,day)=>sum+value(day),0),cumulativeTotal=rows.filter(day=>day.date<=today).reduce((sum,day)=>sum+value(day),0);
    const mode=name=>root.querySelector('.token-activity-modes [data-activity-mode="'+name+'"]'),cell=()=>root.querySelector('[data-activity-date="'+today+'"]');
    mode('daily').click();const original=cell(),grid=root.querySelector('.token-activity-grid'),columns=Number(grid.getAttribute('aria-colcount'));
    // Twelve calendar months include only elapsed days in the current month.
    // On November 1 this is 48 weeks, not a fixed full 52-week interval.
    const calendarFirst=new Date(today+'T00:00:00Z');calendarFirst.setUTCDate(1);calendarFirst.setUTCMonth(calendarFirst.getUTCMonth()-11);calendarFirst.setUTCDate(calendarFirst.getUTCDate()-(calendarFirst.getUTCDay()+6)%7);
    const expectedColumns=Math.floor((Date.parse(today+'T00:00:00Z')-calendarFirst.getTime())/(7*86400000))+1;
    checks.activityCalendarStructure=root.querySelectorAll('[role="row"]').length===7&&root.querySelectorAll('.token-activity-cell').length===columns*7&&columns===expectedColumns&&root.querySelectorAll('.token-activity-months span').length===12;
    checks.activityDailyUsesActualTokens=original.getAttribute('aria-label').includes(format(todayTotal)+' 个 Token');
    checks.activityFutureDaysDisabled=[...root.querySelectorAll('.token-activity-cell[data-future="true"]')].every(button=>button.disabled);
    mode('weekly').click();const lastColumn=[...root.querySelectorAll('.token-activity-cell[aria-colindex="'+columns+'"]')];
    checks.activityWeeklyTotals=cell()===original&&lastColumn.length===7&&lastColumn.every(button=>!button.disabled&&button.getAttribute('aria-label').includes(format(weekTotal)+' 个 Token'))&&new Set(lastColumn.map(button=>button.dataset.level)).size===1;
    mode('cumulative').click();checks.activityCumulativeTotals=cell()===original&&cell().getAttribute('aria-label').includes(format(cumulativeTotal)+' 个 Token');
    mode('daily').click();original.focus();
    // A hidden diagnostic window does not always dispatch native focus events;
    // exercise the actual hover listener without moving the user's mouse.
    original.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));
    const zero=root.querySelector('.token-activity-cell[data-level="0"]:not(:disabled)'),positive=root.querySelector('.token-activity-cell[data-level="5"]');
    const tooltip=root.querySelector('[role="tooltip"]'),tip=tooltip.getBoundingClientRect(),bounds=root.getBoundingClientRect();
    const tooltipObservation={hidden:tooltip.hidden,text:tooltip.textContent,bounds:tip.toJSON(),panel:bounds.toJSON()};
    checks.activityTooltip=tooltip.hidden===false&&tooltip.textContent.includes(format(todayTotal)+' 个 Token')&&tip.left>=bounds.left&&tip.right<=bounds.right&&tip.top>=bounds.top&&tip.bottom<=bounds.bottom;
    checks.activityCompactUnits=[...root.querySelectorAll('.token-activity-cell:not(:disabled)')].every(button=>/[0-9]+[.][0-9][万亿] 个 Token/.test(button.getAttribute('aria-label')))&&!tooltip.textContent.includes(new Intl.NumberFormat('en-US').format(todayTotal)+' 个 Token');
    original.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
    const focused=document.activeElement,focusDate=focused.dataset.activityDate;
    acceptSnapshot({...snapshot,dailyUsage:rows.map(day=>({...day}))});
    checks.activityKeyboardAndStableUpdates=focused!==original&&root.contains(focused)&&document.activeElement===focused&&focused.dataset.activityDate===focusDate&&cell()===original&&root.querySelectorAll('.token-activity-cell[tabindex="0"]').length===1;
    checks.activityThemeIntensity=!zero||!positive||getComputedStyle(zero).backgroundColor!==getComputedStyle(positive).backgroundColor;
    const scroll=root.querySelector('.token-activity-scroll'),before=scroll.scrollLeft,event=new WheelEvent('wheel',{deltaY:-16,bubbles:true,cancelable:true});scroll.dispatchEvent(event);
    checks.activityHorizontalAccess=scroll.scrollWidth<=scroll.clientWidth||before===0||scroll.scrollLeft<before&&event.defaultPrevented;
    checks.activityNoWindowDrag=root.hasAttribute('data-no-window-drag');
    scroll.scrollLeft=Math.max(0,scroll.scrollWidth-scroll.clientWidth);
    mode('daily').focus();root.dispatchEvent(new PointerEvent('pointerleave',{bubbles:false}));
    return {checks,today,monday,todayTotal,weekTotal,cumulativeTotal,globalTotal:snapshot.totals.total,columns,expectedColumns,cells:columns*7,tooltip:tooltipObservation};
  })()`);
}
module.exports={checkTokenActivity};
