'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create}=require('../ui/token-activity.js');
const today='2026-10-29';
const sample={today,dailyUsage:[{date:'2024-01-01',total:100},{date:'2026-10-28',input:800,cached:700,output:200},{date:today,total:2000}],totalTokens:3100};
function fixture(options={}){
  const dom=new JSDOM('<main><section id="activity"></section><button id="outside">outside</button></main>',{pretendToBeVisual:true,url:'https://local.test/'}),view=dom.window,root=view.document.getElementById('activity'),timers=new Map(),observers=[];let timerId=0,width=226,left=0;
  view.setTimeout=callback=>{const id=++timerId;timers.set(id,callback);return id;};view.clearTimeout=id=>timers.delete(id);
  view.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}disconnect(){this.disconnected=true;}};
  root.getBoundingClientRect=()=>({x:10,y:20,left:10,top:20,right:width+34,bottom:176,width:width+24,height:156});
  const modes=[],controller=create({root,onModeChange:value=>modes.push(value),...options}),scroll=root.querySelector('.token-activity-scroll');
  Object.defineProperties(scroll,{clientWidth:{get:()=>width},scrollWidth:{get:()=>Math.max(width,parseFloat(root.style.getPropertyValue('--activity-render-width'))||581)},scrollLeft:{get:()=>left,set:value=>{left=Math.max(0,Math.min(scroll.scrollWidth-width,value));}}});
  const flush=()=>{for(const [id,callback]of [...timers]){timers.delete(id);callback();}};
  return {dom,view,root,controller,scroll,timers,observers,modes,flush,setWidth(value){width=value;observers[0].callback();flush();},cell:date=>root.querySelector('[data-activity-date="'+date+'"]'),close(){controller.dispose();dom.window.close();}};
}

test('activity renders a seven-row year with twelve month markers and one keyboard entry',()=>{
  const f=fixture();try{
    f.controller.update(sample);f.flush();const state=f.controller.getState();
    assert(state.columns>=52&&state.columns<=54);assert.equal(state.cells,state.columns*7);assert.equal(f.root.querySelectorAll('[role="row"]').length,7);assert.equal(f.root.querySelectorAll('.token-activity-months span').length,12);
    assert.deepEqual([...f.root.querySelectorAll('[data-activity-mode]')].map(button=>button.textContent),['每天','每周','累计总量']);
    assert.equal(f.root.querySelectorAll('.token-activity-cell[tabindex="0"]').length,1);assert.equal(f.cell(today).tabIndex,0);assert.equal(f.cell('2026-10-30').disabled,true);
    assert.match(f.cell('2026-10-28').getAttribute('aria-label'),/0\.1万 个 Token/);assert.equal(f.root.getAttribute('data-no-window-drag'),'');assert(f.scroll.scrollLeft>0,'narrow chart starts at recent months');
  }finally{f.close();}
});

test('live updates preserve focused cells and user scroll while equivalent snapshots skip work',()=>{
  const f=fixture();try{
    f.controller.update(sample);f.flush();f.scroll.scrollLeft=36;const grid=f.root.querySelector('.token-activity-grid'),cell=f.cell(today);cell.focus();
    const before=f.controller.getState().builds;f.controller.update({...sample,dailyUsage:sample.dailyUsage.map(day=>({...day}))});f.flush();assert.equal(f.controller.getState().builds,before);
    f.controller.update({...sample,totalTokens:4100,dailyUsage:[...sample.dailyUsage.slice(0,-1),{date:today,total:3000}]});f.flush();
    assert.equal(f.cell(today),cell);assert.equal(f.root.querySelector('.token-activity-grid'),grid);assert.equal(f.view.document.activeElement,cell);assert.equal(f.scroll.scrollLeft,36);assert.match(f.root.querySelector('[role="tooltip"]').textContent,/0\.3万 个 Token/);
  }finally{f.close();}
});

test('mode controls delegate weekly/cumulative aggregation and keep the calendar DOM and scroll',()=>{
  const f=fixture();try{
    f.controller.update(sample);f.flush();f.scroll.scrollLeft=40;const cell=f.cell(today),future=f.cell('2026-10-30');
    f.root.querySelector('[data-activity-mode="weekly"]').click();f.flush();assert.equal(f.controller.getState().mode,'weekly');assert.equal(f.cell(today),cell);assert.equal(future.disabled,false);assert.match(cell.getAttribute('aria-label'),/0\.3万 个 Token/);assert.equal(cell.dataset.level,future.dataset.level);assert.equal(f.scroll.scrollLeft,40);
    f.root.querySelector('[data-activity-mode="cumulative"]').click();f.flush();assert.match(cell.getAttribute('aria-label'),/0\.3万 个 Token/);assert.deepEqual(f.modes,['weekly','cumulative']);assert.equal(f.scroll.scrollLeft,40);
    f.controller.setMode('invalid');assert.equal(f.controller.getState().mode,'cumulative');
  }finally{f.close();}
});

test('grid keyboard navigation skips disabled days and exposes bounded focus tooltips',()=>{
  const f=fixture();try{
    f.controller.update(sample);f.flush();const cell=f.cell(today);cell.focus();
    const key=value=>f.view.document.activeElement.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
    key('ArrowUp');assert.equal(f.view.document.activeElement,f.cell('2026-10-28'));key('ArrowDown');assert.equal(f.view.document.activeElement,cell);key('ArrowRight');assert.equal(f.view.document.activeElement,cell,'no future column to focus');
    key('ArrowLeft');assert.equal(f.view.document.activeElement,f.cell('2026-10-22'));key('End');assert.equal(f.view.document.activeElement,cell);
    const tip=f.root.querySelector('[role="tooltip"]');assert.equal(tip.hidden,false);assert(tip.textContent.includes('0.2万'));assert.equal(cell.getAttribute('aria-describedby'),tip.id);assert(Number.parseFloat(tip.style.left)>=8);assert(Number.parseFloat(tip.style.top)>=8);
    key('Escape');assert.equal(tip.hidden,true);assert.equal(cell.hasAttribute('aria-describedby'),false);
    f.root.querySelector('[data-activity-mode="daily"]').focus();key('ArrowRight');assert.equal(f.controller.getState().mode,'weekly');assert.equal(f.view.document.activeElement.dataset.activityMode,'weekly');
  }finally{f.close();}
});

test('horizontal wheel consumes only available chart scrolling and resize preserves mode',()=>{
  const f=fixture();try{
    f.controller.update(sample);f.flush();f.scroll.scrollLeft=20;
    const wheel=new f.view.WheelEvent('wheel',{deltaY:10,bubbles:true,cancelable:true});f.scroll.dispatchEvent(wheel);assert.equal(f.scroll.scrollLeft,30);assert.equal(wheel.defaultPrevented,true);
    f.scroll.scrollLeft=0;const edge=new f.view.WheelEvent('wheel',{deltaY:-10,bubbles:true,cancelable:true});f.scroll.dispatchEvent(edge);assert.equal(edge.defaultPrevented,false,'normal page scroll remains available at chart edge');
    f.controller.setMode('weekly');f.flush();f.setWidth(300);assert.equal(f.controller.getState().mode,'weekly');assert.equal(f.scroll.scrollLeft,f.scroll.scrollWidth-f.scroll.clientWidth);assert.equal(f.root.style.getPropertyValue('--activity-cell-size'),'9px');
  }finally{f.close();}
});

test('enlarged square layout removes the footer and keeps overflow information on the chart',()=>{
  const f=fixture();try{
    f.controller.update(sample);f.flush();
    assert.equal(f.root.querySelector('.token-activity-footer,.token-activity-period,.token-activity-legend'),null);
    assert.equal(f.root.querySelectorAll('.token-activity-months span').length,12);
    assert.equal(f.root.style.getPropertyValue('--activity-cell-size'),'9px');
    assert.equal(f.root.style.getPropertyValue('--activity-render-width'),'581px');
    assert.equal(f.root.style.getPropertyValue('--activity-min-width'),'581px');
    assert.equal(f.scroll.title,'横向滚动查看完整12个月');
    f.controller.setMode('weekly');f.flush();f.controller.update({...sample,totalTokens:3101});f.flush();
    assert.equal(f.scroll.title,'横向滚动查看完整12个月');assert(!f.root.textContent.includes('2025.11'));
    f.setWidth(600);assert.equal(f.scroll.hasAttribute('title'),false);assert.equal(f.scroll.getAttribute('aria-label'),'Token 活动，近12个月');
    f.setWidth(250);assert.equal(f.scroll.title,'横向滚动查看完整12个月');
    // Compact media-query policy can change height without changing width.
    f.root.style.setProperty('--activity-preferred-cell-size','8px');f.observers[0].callback();f.flush();
    assert.equal(f.root.style.getPropertyValue('--activity-cell-size'),'8px');
    assert.equal(f.root.style.getPropertyValue('--activity-render-width'),'528px');
    assert.equal(f.root.style.getPropertyValue('--activity-min-width'),'528px');
    assert.equal(f.controller.getState().mode,'weekly');
  }finally{f.close();}
});

test('hovering a future disabled date clears the previous hover tooltip',()=>{
  const f=fixture();try{f.controller.update(sample);f.flush();const tip=f.root.querySelector('[role="tooltip"]');f.cell(today).dispatchEvent(new f.view.MouseEvent('pointerover',{bubbles:true}));assert.equal(tip.hidden,false);f.cell('2026-10-30').dispatchEvent(new f.view.MouseEvent('pointerover',{bubbles:true}));assert.equal(tip.hidden,true);}finally{f.close();}
});

test('missing/invalid records stay safe and undated history is explained without taking calendar space',()=>{
  const f=fixture();try{
    f.controller.update({today,dailyUsage:[{date:'invalid',total:40},{date:today,total:'bad',input:1,output:1}],totalTokens:50});f.flush();assert.match(f.cell(today).getAttribute('aria-label'),/0\.0万 个 Token/);
    const help=f.root.querySelector('.token-activity-notice');assert.equal(help.hidden,false);help.focus();help.click();const tip=f.root.querySelector('[role="tooltip"]');assert.equal(tip.hidden,false);assert.match(tip.textContent,/有效日期|无效日期/);assert.equal(help.closest('.token-activity-heading')!==null,true);
    f.controller.update({today,dailyUsage:[{date:today,total:null,input:1,output:1}],totalTokens:2});f.flush();assert.match(f.cell(today).getAttribute('aria-label'),/0\.0万 个 Token/);assert.equal(help.hidden,true);assert.equal(tip.hidden,true);
  }finally{f.close();}
});

test('disposal disconnects observers, cancels layout and detaches control handlers',()=>{
  const f=fixture();try{
    const mode=f.controller.getState().mode,oldButton=f.root.querySelector('[data-activity-mode="weekly"]');assert.equal(f.timers.size,1);f.controller.dispose();assert.equal(f.timers.size,0);assert.equal(f.observers[0].disconnected,true);assert.equal(f.root.children.length,0);assert.equal(f.root.hasAttribute('data-no-window-drag'),false);
    oldButton.click();f.controller.update(sample);f.controller.setMode('weekly');assert.equal(f.controller.getState().mode,mode);assert.equal(f.controller.getState().disposed,true);
  }finally{f.close();}
});
