(function(host,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./token-activity-model.js'));
  else host.PulseTokenActivity=factory(host.PulseTokenActivityModel);
})(typeof window==='object'?window:globalThis,function(defaultModel){
  'use strict';
  const MODES=Object.freeze([{id:'daily',label:'每天'},{id:'weekly',label:'每周'},{id:'cumulative',label:'累计总量'}]);
  let sequence=0;
  function create({root,model=defaultModel,initialMode='daily',onModeChange}={}){
    if(!root?.ownerDocument||typeof model?.buildActivity!=='function')throw new TypeError('Token activity needs a root and an activity model');
    const document=root.ownerDocument,view=document.defaultView,tooltipId='token-activity-tip-'+(++sequence),previousNoDrag=root.getAttribute('data-no-window-drag');
    const listeners=[],buttons=new Map(),rows=[],modeButtons=new Map();
    let mode=MODES.some(item=>item.id===initialMode)?initialMode:'daily',input={dailyUsage:[]},data=null,signature='',disposed=false,activeDate=null,tooltipDate=null,tooltipNotice=false,pan=null,suppressClick=false,layoutTimer=null,observer=null,lastWidth=0,lastCellSize=0,needsInitialScroll=true,builds=0;
    root.classList.add('token-activity');root.setAttribute('data-no-window-drag','');
    const element=(tag,className)=>{const value=document.createElement(tag);if(className)value.className=className;return value;};
    const heading=element('div','token-activity-heading'),titleGroup=element('div','token-activity-title'),title=element('h2'),tabs=element('div','token-activity-modes');
    title.textContent='Token 活动';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Token 活动统计口径');
    for(const item of MODES){const button=element('button');button.type='button';button.dataset.activityMode=item.id;button.textContent=item.label;modeButtons.set(item.id,button);tabs.append(button);}
    titleGroup.append(title);heading.append(titleGroup,tabs);
    const scroll=element('div','token-activity-scroll'),chart=element('div','token-activity-chart'),grid=element('div','token-activity-grid'),months=element('div','token-activity-months');
    scroll.setAttribute('aria-label','Token 活动，可水平滚动查看月份');grid.setAttribute('role','grid');grid.setAttribute('aria-rowcount','7');months.setAttribute('aria-hidden','true');
    for(let row=0;row<7;row++){const node=element('div','token-activity-row');node.setAttribute('role','row');node.setAttribute('aria-rowindex',String(row+1));rows.push(node);grid.append(node);}
    chart.append(grid,months);scroll.append(chart);
    const notice=element('button','token-activity-notice'),tooltip=element('div','token-activity-tooltip');notice.type='button';notice.hidden=true;notice.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>';titleGroup.append(notice);tooltip.id=tooltipId;tooltip.hidden=true;tooltip.setAttribute('role','tooltip');
    root.replaceChildren(heading,scroll,tooltip);
    const on=(target,event,callback,options)=>{target.addEventListener(event,callback,options);listeners.push(()=>target.removeEventListener(event,callback,options));};
    function attribute(node,name,value){const text=String(value);if(node.getAttribute(name)!==text)node.setAttribute(name,text);}
    function hideTooltip(){if(tooltipDate)buttons.get(tooltipDate)?.removeAttribute('aria-describedby');notice.removeAttribute('aria-describedby');tooltipDate=null;tooltipNotice=false;tooltip.hidden=true;}
    function cellFor(date){return data?.cells?.find(cell=>cell.date===date);}
    function positionTooltip(button){
      const owner=root.getBoundingClientRect(),anchor=button.getBoundingClientRect(),tip=tooltip.getBoundingClientRect(),width=tip.width||Math.min(240,Math.max(0,owner.width-24)),height=tip.height||44;
      const left=Math.max(8,Math.min(Math.max(8,owner.width-width-8),anchor.left-owner.left+(anchor.width-width)/2));
      const preferred=anchor.top-owner.top-height-7;
      const top=Math.max(8,Math.min(Math.max(8,owner.height-height-8),preferred>=8?preferred:anchor.bottom-owner.top+7));
      tooltip.style.left=left+'px';tooltip.style.top=top+'px';
    }
    function showTooltip(button){
      const cell=cellFor(button?.dataset.activityDate);if(disposed)return;if(!cell||cell.disabled||pan?.moved){hideTooltip();return;}
      if(tooltipDate&&tooltipDate!==cell.date)buttons.get(tooltipDate)?.removeAttribute('aria-describedby');
      tooltipDate=cell.date;tooltipNotice=false;notice.removeAttribute('aria-describedby');tooltip.textContent=cell.label||cell.date;tooltip.hidden=false;button.setAttribute('aria-describedby',tooltipId);positionTooltip(button);
    }
    function showNotice(){if(disposed||notice.hidden)return;hideTooltip();tooltipNotice=true;tooltip.textContent=String(data.notice);tooltip.hidden=false;notice.setAttribute('aria-describedby',tooltipId);positionTooltip(notice);}
    function chooseDate(date){
      if(!date||buttons.get(date)?.disabled)return;
      if(activeDate!==date){const previous=buttons.get(activeDate);if(previous)previous.tabIndex=-1;activeDate=date;}
      const button=buttons.get(date);if(button)button.tabIndex=0;
    }
    function ensureCellVisible(button){
      const viewport=scroll.getBoundingClientRect(),box=button.getBoundingClientRect();
      if(box.left<viewport.left)scroll.scrollLeft-=viewport.left-box.left;
      else if(box.right>viewport.right)scroll.scrollLeft+=box.right-viewport.right;
    }
    function layout(){
      layoutTimer=null;if(disposed||!data)return;
      const width=scroll.clientWidth;if(width<=0)return;
      const preferred=Number.parseFloat(view.getComputedStyle(root).getPropertyValue('--activity-preferred-cell-size'));
      const size=Number.isFinite(preferred)?Math.max(8,Math.min(9,preferred)):9;
      const columns=Math.max(1,data.columnCount||data.columns?.length||1),renderWidth=columns*(size+2)-2;
      root.style.setProperty('--activity-cell-size',size+'px');
      root.style.setProperty('--activity-render-width',renderWidth+'px');
      root.style.setProperty('--activity-min-width',renderWidth+'px');
      const overflow=renderWidth>width;
      scroll.setAttribute('aria-label',overflow?'Token 活动，可横向滚动查看完整12个月':'Token 活动，近12个月');
      if(overflow)scroll.setAttribute('title','横向滚动查看完整12个月');else scroll.removeAttribute('title');
      if(needsInitialScroll||Math.abs(width-lastWidth)>.5||lastCellSize!==size){scroll.scrollLeft=Math.max(0,scroll.scrollWidth-width);needsInitialScroll=false;lastWidth=width;lastCellSize=size;}
      if(tooltipDate)positionTooltip(buttons.get(tooltipDate));
      else if(tooltipNotice)positionTooltip(notice);
    }
    function scheduleLayout(){if(layoutTimer===null&&!disposed)layoutTimer=view.setTimeout(layout,0);}
    function paint(){
      data=model.buildActivity({...input,mode});builds++;
      const cells=Array.isArray(data.cells)?data.cells:(data.columns||[]).flatMap(column=>column.cells||[]),columns=Math.max(1,data.columnCount||data.columns?.length||1);
      data={...data,cells};root.dataset.activityMode=mode;
      root.style.setProperty('--activity-columns',String(columns));
      grid.setAttribute('aria-colcount',String(columns));grid.setAttribute('aria-label','Token 活动，'+MODES.find(item=>item.id===mode).label+'，每列七天');
      for(const [key,button]of modeButtons)attribute(button,'aria-pressed',key===mode);
      const dates=new Set(cells.map(cell=>cell.date));
      for(const [date,button]of buttons)if(!dates.has(date)){button.remove();buttons.delete(date);}
      const current=cellFor(activeDate);if(!current||current.disabled)activeDate=cells.find(cell=>cell.date===data.today&&!cell.disabled)?.date||[...cells].reverse().find(cell=>!cell.disabled)?.date||null;
      for(const cell of cells){
        let button=buttons.get(cell.date);
        if(!button){button=element('button','token-activity-cell');button.type='button';button.setAttribute('role','gridcell');button.dataset.activityDate=cell.date;buttons.set(cell.date,button);}
        const row=Math.max(0,Math.min(6,Number(cell.row)||0)),column=Math.max(0,Number(cell.column)||0),rowNode=rows[row];
        if(rowNode.children[column]!==button)rowNode.insertBefore(button,rowNode.children[column]||null);
        button.style.gridColumn=String(column+1);button.style.gridRow=String(row+1);
        attribute(button,'data-level',Math.max(0,Math.min(5,Number(cell.level)||0)));attribute(button,'data-future',cell.future===true);attribute(button,'aria-colindex',column+1);attribute(button,'aria-label',cell.label||cell.date);attribute(button,'aria-disabled',!!cell.disabled);
        if(button.disabled!==!!cell.disabled)button.disabled=!!cell.disabled;
        button.tabIndex=cell.date===activeDate?0:-1;
      }
      const monthSignature=JSON.stringify((data.months||[]).map(month=>[month.column,month.label]));
      if(months.dataset.signature!==monthSignature){months.dataset.signature=monthSignature;months.replaceChildren(...(data.months||[]).map(month=>{const label=element('span');label.textContent=month.label;label.style.gridColumn=String((Number(month.column)||0)+1);return label;}));}
      notice.setAttribute('aria-label',String(data.notice||''));notice.hidden=!data.notice;
      if(tooltipDate){const target=buttons.get(tooltipDate);if(target&&!target.disabled)showTooltip(target);else hideTooltip();}
      else if(tooltipNotice){if(notice.hidden)hideTooltip();else showNotice();}
      scheduleLayout();
    }
    function update(value={}){
      if(disposed)return;
      const dailyUsage=Array.isArray(value.dailyUsage)?value.dailyUsage:[],today=typeof value.today==='string'?value.today:undefined,totalTokens=Number(value.totalTokens??value.total);
      const scalar=value=>value===undefined?'undefined':value===null?'null':typeof value==='number'?['number',Number.isFinite(value)?value:String(value)]:[typeof value,typeof value==='string'?value:'invalid'];
      const next=JSON.stringify([today,Number.isFinite(totalTokens)?totalTokens:null,dailyUsage.map(day=>[typeof day?.date==='string'?day.date:'',...['total','input','output'].map(key=>scalar(day?.[key]))])]);
      input={dailyUsage,today,...(Number.isFinite(totalTokens)?{totalTokens}:{})};if(next===signature)return;signature=next;paint();
    }
    function setMode(next,{notify=true}={}){if(disposed||!MODES.some(item=>item.id===next)||mode===next)return;hideTooltip();mode=next;paint();if(notify)onModeChange?.(mode);}
    on(tabs,'click',event=>{const target=event.target.closest('[data-activity-mode]');if(target)setMode(target.dataset.activityMode);});
    on(notice,'pointerenter',showNotice);on(notice,'focus',showNotice);on(notice,'click',showNotice);on(notice,'pointerleave',()=>{if(document.activeElement!==notice)hideTooltip();});on(notice,'blur',hideTooltip);on(notice,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();hideTooltip();}});
    on(tabs,'keydown',event=>{const index=MODES.findIndex(item=>item.id===event.target.dataset.activityMode);if(index<0)return;let next;if(event.key==='ArrowLeft')next=(index+MODES.length-1)%MODES.length;else if(event.key==='ArrowRight')next=(index+1)%MODES.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=MODES.length-1;else return;event.preventDefault();const item=MODES[next];setMode(item.id);modeButtons.get(item.id).focus();});
    on(grid,'pointerover',event=>{const button=event.target.closest('.token-activity-cell');if(button)showTooltip(button);});
    on(grid,'pointerout',event=>{const next=event.relatedTarget?.closest?.('.token-activity-cell');if(next&&grid.contains(next)&&!next.disabled)return;const focused=document.activeElement?.closest?.('.token-activity-cell');if(focused&&grid.contains(focused))showTooltip(focused);else hideTooltip();});
    on(grid,'focusin',event=>{const button=event.target.closest('.token-activity-cell');if(button){chooseDate(button.dataset.activityDate);showTooltip(button);}});
    on(grid,'focusout',event=>{if(!grid.contains(event.relatedTarget))hideTooltip();});
    on(grid,'click',event=>{if(suppressClick){suppressClick=false;event.preventDefault();return;}const button=event.target.closest('.token-activity-cell');if(button&&!button.disabled){chooseDate(button.dataset.activityDate);showTooltip(button);}});
    on(grid,'keydown',event=>{
      const cell=cellFor(event.target.dataset.activityDate);if(!cell)return;if(event.key==='Escape'){hideTooltip();event.preventDefault();return;}
      let candidates;
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){const step=event.key==='ArrowLeft'?-1:1;candidates=data.cells.filter(item=>item.row===cell.row&&(step<0?item.column<cell.column:item.column>cell.column)).sort((a,b)=>step*(a.column-b.column));}
      else if(event.key==='ArrowUp'||event.key==='ArrowDown'){const step=event.key==='ArrowUp'?-1:1;candidates=data.cells.filter(item=>item.column===cell.column&&(step<0?item.row<cell.row:item.row>cell.row)).sort((a,b)=>step*(a.row-b.row));}
      else if(event.key==='Home'||event.key==='End'){const direction=event.key==='Home'?1:-1;candidates=data.cells.filter(item=>event.ctrlKey||item.row===cell.row).sort((a,b)=>direction*(a.index-b.index));}
      else return;event.preventDefault();const next=candidates.find(item=>!item.disabled);if(next){const button=buttons.get(next.date);chooseDate(next.date);ensureCellVisible(button);button.focus();showTooltip(button);}
    });
    on(scroll,'wheel',event=>{if(disposed||scroll.scrollWidth<=scroll.clientWidth)return;const amount=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY,before=scroll.scrollLeft;scroll.scrollLeft+=amount;if(scroll.scrollLeft!==before){event.preventDefault();if(!grid.contains(document.activeElement))hideTooltip();}},{passive:false});
    on(scroll,'scroll',()=>{const focused=document.activeElement?.closest?.('.token-activity-cell');if(pan?.moved||!focused)hideTooltip();else showTooltip(focused);},{passive:true});
    on(scroll,'pointerdown',event=>{suppressClick=false;if(event.button!==0||event.pointerType==='touch')return;pan={id:event.pointerId,x:event.clientX,left:scroll.scrollLeft,moved:false};});
    on(scroll,'pointermove',event=>{if(!pan||pan.id!==event.pointerId||!(event.buttons&1))return;const delta=event.clientX-pan.x;if(Math.abs(delta)>4)pan.moved=true;if(pan.moved){if(Number.isInteger(pan.id)&&!scroll.hasPointerCapture?.(pan.id))scroll.setPointerCapture?.(pan.id);scroll.scrollLeft=pan.left-delta;hideTooltip();event.preventDefault();}});
    const endPan=event=>{if(!pan||event&&event.pointerId!==pan.id)return;suppressClick=pan.moved;if(scroll.hasPointerCapture?.(pan.id))scroll.releasePointerCapture?.(pan.id);pan=null;};
    on(scroll,'pointerup',endPan);on(scroll,'pointercancel',endPan);on(scroll,'lostpointercapture',()=>{pan=null;});
    on(root,'pointerleave',()=>{if(!grid.contains(document.activeElement)&&document.activeElement!==notice)hideTooltip();});
    on(view,'blur',()=>{endPan();hideTooltip();});
    if(typeof view.ResizeObserver==='function'){observer=new view.ResizeObserver(scheduleLayout);observer.observe(scroll);}else on(view,'resize',scheduleLayout);
    update();
    return {update,setMode,getState:()=>({mode,columns:data?.columnCount||data?.columns?.length||0,cells:data?.cells?.length||0,activeDate,tooltipDate,builds,disposed}),dispose(){if(disposed)return;disposed=true;if(layoutTimer!==null)view.clearTimeout(layoutTimer);layoutTimer=null;observer?.disconnect();listeners.splice(0).forEach(remove=>remove());hideTooltip();buttons.clear();pan=null;root.replaceChildren();root.classList.remove('token-activity');for(const property of ['--activity-columns','--activity-min-width','--activity-cell-size','--activity-render-width'])root.style.removeProperty(property);delete root.dataset.activityMode;if(previousNoDrag===null)root.removeAttribute('data-no-window-drag');else root.setAttribute('data-no-window-drag',previousNoDrag);}};
  }
  return {create,MODES};
});
