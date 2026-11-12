(function(host,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else host.PulseDashboardMaterial=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function create({document,saveSettings}){
    const root=document.documentElement;
    const $=id=>document.getElementById(id),listeners=[];
    const dialog=$('material-transparency-dialog'),range=$('material-transparency');
    let settings={},target=null,dirty=false,disposed=false,diagnostics=null;
    const on=(node,name,handler)=>{node.addEventListener(name,handler);listeners.push(()=>node.removeEventListener(name,handler));};
    function apply(value){
      root.dataset.dashboardGlass=String(value.dashboardGlass===true);
      const opacity=Number.isFinite(value.dashboardOpacity)?value.dashboardOpacity:.6;
      root.style.setProperty('--dashboard-tint',Math.round(opacity*100)+'%');
      root.style.setProperty('--veyra-glass-opacity',String(opacity));
      root.style.setProperty('--dashboard-shell-tint',Math.round(opacity*100)+'%');
      root.style.setProperty('--dashboard-panel-tint',Math.round((.2+opacity*.25)*100)+'%');
      root.style.setProperty('--dashboard-nested-tint',Math.round((.08+opacity*.15)*100)+'%');
      root.style.setProperty('--dashboard-rail-tint',Math.min(96,Math.round(opacity*100)+18)+'%');
    }
    function update(value){settings={...settings,...value};$('setting-dashboard-glass').checked=settings.dashboardGlass===true;apply(settings);renderStatus();}
    function commit(){
      if(!dirty||!target)return;
      dirty=false;
      const patch={[target]:(100-Number(range.value))/100};
      settings={...settings,...patch};
      Promise.resolve(saveSettings(patch)).catch(()=>{apply(settings);});
    }
    function close(){commit();if(dialog.open)dialog.close();target=null;}
    function open(key){
      commit();target=key;dirty=false;
      const island=key==='islandOpacity';
      $('material-transparency-title').textContent=island?'灵动岛透明度':'界面透明度';
      range.max=island?'75':'82';
      const opacity=Number.isFinite(settings[key])?settings[key]:(island ? .55 : .6);
      range.value=String(Math.round((1-opacity)*100));
      $('material-transparency-value').textContent=range.value+'%';
      dialog.showModal();range.focus();
    }
    on($('setting-dashboard-glass'),'change',event=>saveSettings({dashboardGlass:event.target.checked}));
    on($('dashboard-transparency-button'),'click',()=>open('dashboardOpacity'));
    on($('island-transparency-button'),'click',()=>open('islandOpacity'));
    on($('material-transparency-close'),'click',close);
    on(dialog,'cancel',event=>{event.preventDefault();close();});
    on(dialog,'click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();}});
    on(range,'input',()=>{
      dirty=true;$('material-transparency-value').textContent=range.value+'%';
      if(target==='dashboardOpacity')apply({...settings,dashboardOpacity:(100-Number(range.value))/100});
    });
    on(range,'change',commit);
    function renderStatus(){
      const node=$('dashboard-glass-status'),value=diagnostics;
      node.textContent=!settings.dashboardGlass?'开启后使用 Veyra Liquid Glass':'Veyra Liquid Glass · 实时下层窗口折射';
    }
    return {update,setShape(value){
      const square=value?.radiusDIP===0;
      root.style.setProperty('--dashboard-radius',square?'0px':'24px');
      root.dataset.dashboardSquare=String(square);
    },setDiagnostics(value){diagnostics=value;renderStatus();},
      dispose(){if(disposed)return;close();disposed=true;listeners.splice(0).forEach(remove=>remove());}};
  }
  return {create};
});
