'use strict';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Only called in hidden smoke windows. Sends synthetic DOM pointer events to
// the real controller and checks native window bounds through its IPC bridge.
async function checkDashboardDrag(dashboard) {
  const contents = dashboard.webContents, original = dashboard.getBounds();
  const checks = {}, observations = {};
  const gesture = (kind, hover = 0) => contents.executeJavaScript(`(async () => {
    const title=document.querySelector('#monitor-view .sessions-panel h2');
    document.querySelector('[data-view="overview"]').click();
    document.querySelector('.content-scroll').scrollTop=0;
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const node=[...title.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.length>4);
    if(!node)throw Error('Drag fixture needs an existing heading text node');
    const point=offset=>{const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+1);const box=range.getBoundingClientRect();return{x:box.left+box.width*.2,y:box.top+box.height*.5};};
    const a=point(1),b=point(Math.min(5,node.length-1));
    const target=${JSON.stringify(kind)}==='control'?document.getElementById('refresh-button'):title;
    const box=target.getBoundingClientRect();
    const start=${JSON.stringify(kind)}==='control'?{x:box.left+box.width/2,y:box.top+box.height/2}:a;
    const emit=(type,x,y,buttons)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:73,pointerType:'mouse',isPrimary:true,button:0,buttons,clientX:x,clientY:y,screenX:900+x-start.x,screenY:500+y-start.y}));
    emit('pointermove',start.x,start.y,0);
    await new Promise(resolve=>setTimeout(resolve,${hover}));
    emit('pointerdown',start.x,start.y,1);
    const end=${JSON.stringify(kind)}==='select'?b:${JSON.stringify(kind)}==='vertical'?{x:start.x+8,y:start.y+32}:{x:start.x+42,y:start.y+18};
    emit('pointermove',end.x,end.y,1);
    await new Promise(resolve=>setTimeout(resolve,100));
    emit('pointerup',end.x,end.y,0);
    await new Promise(resolve=>setTimeout(resolve,100));
    return {selection:String(getSelection()),userSelect:getComputedStyle(document.querySelector('main')).userSelect};
  })()`);
  try {
    await contents.executeJavaScript(`getSelection().removeAllRanges()`);
    observations.quick = await gesture('drag');
    const moved = dashboard.getBounds();
    checks.dashboardContentDrag = moved.x - original.x === 42 && moved.y - original.y === 18 && !observations.quick.selection;
    dashboard.setBounds(original);
    observations.selection = await gesture('select', 380);
    const selectedBounds = dashboard.getBounds();
    checks.hoverHorizontalSelection = observations.selection.selection.length > 0 && selectedBounds.x === original.x && selectedBounds.y === original.y;
    await contents.executeJavaScript(`getSelection().removeAllRanges()`);
    observations.vertical = await gesture('vertical', 380);
    const vertical = dashboard.getBounds();
    checks.hoverVerticalDrag = vertical.x - original.x === 8 && vertical.y - original.y === 32 && !observations.vertical.selection;
    dashboard.setBounds(original);
    observations.control = await gesture('control');
    const control = dashboard.getBounds();
    checks.dragControlsBypassed = control.x === original.x && control.y === original.y;
    observations.live=await contents.executeJavaScript(`(async () => {
      let paragraph,node,a,b,emit;
      // Stabilize the hover fixture before asserting preservation during a
      // refresh. Ordinary live updates can replace an unarmed paragraph.
      for(let attempt=0;attempt<4;attempt++){
        paragraph=[...document.querySelectorAll('#detail-panel .event p')].find(element=>element.firstChild?.nodeType===3&&element.firstChild.length>8);
        if(!paragraph)return {passed:false,reason:'No readable event paragraph'};
        paragraph.scrollIntoView({block:'center'});await new Promise(resolve=>requestAnimationFrame(resolve));
        node=paragraph.firstChild;
        const point=offset=>{const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+1);const box=range.getBoundingClientRect();return {x:box.left+box.width*.2,y:box.top+box.height*.5};};
        a=point(1);b=point(6);emit=(type,p,buttons)=>paragraph.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:74,pointerType:'mouse',isPrimary:true,button:0,buttons,clientX:p.x,clientY:p.y,screenX:900+p.x-a.x,screenY:500+p.y-a.y}));
        emit('pointermove',a,0);await new Promise(resolve=>setTimeout(resolve,380));
        if(node.isConnected&&paragraph.hasAttribute('data-pulse-drag-text-armed'))break;
      }
      if(!node.isConnected||!paragraph.hasAttribute('data-pulse-drag-text-armed'))return {passed:false,reason:'Hover did not arm current paragraph',point:a,hit:document.elementFromPoint(a.x,a.y)?.tagName};
      emit('pointerdown',a,1);
      acceptSnapshot(await window.pulse.getSnapshot());
      if(!node.isConnected)return {passed:false,reason:'Reading node replaced on pointer down'};
      emit('pointermove',b,1);emit('pointerup',b,0);
      const selected=String(getSelection());acceptSnapshot(await window.pulse.getSnapshot());
      const retained=selected.length>0&&String(getSelection())===selected&&node.isConnected;
      getSelection().removeAllRanges();document.querySelector('.content-scroll').scrollTop=0;document.querySelector('.event-list').scrollTop=0;
      return {passed:retained,selected,connected:node.isConnected,reason:retained?'Preserved':'Selection changed after live refresh'};
    })()`);
    checks.liveSelectionSurvivesRefresh=observations.live.passed===true;
  } finally {
    dashboard.setBounds(original);
    await contents.executeJavaScript(`getSelection().removeAllRanges();document.querySelector('.content-scroll').scrollTop=0;document.querySelector('.event-list')?.scrollTo(0,0);document.querySelector('main').dispatchEvent(new PointerEvent('pointerleave',{pointerId:73,pointerType:'mouse'}));`);
  }
  return {checks, observations};
}
module.exports = {checkDashboardDrag};
