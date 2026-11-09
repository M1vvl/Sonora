(function(host,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./dashboard-state.js'));
  else host.PulseDashboardWorkspace=factory(host.PulseDashboardState);
})(typeof window==='object'?window:globalThis,function(persistence){
  'use strict';
  // DOM policy for workspace restoration. The persistence controller owns the
  // single save timer; neither module observes usage or scans conversation logs.
  function create({state,activity,api,document,view=document.defaultView,today,onError}){
    const selectors={sessions:'#sessions-list',events:'.event-list',meta:'.detail-meta',content:'.content-scroll',activity:'.token-activity-scroll'};
    let started=false,disposed=false,fallback=null,pendingScroll={},rememberedScroll={},selectedPending=null;
    const listeners=[],on=(node,type,callback,options)=>{node.addEventListener(type,callback,options);listeners.push(()=>node.removeEventListener(type,callback,options));};
    const nodeFor=key=>document.querySelector(selectors[key]);
    const visible=node=>node&&node.getClientRects().length>0;
    function capture(){
      // Native <details> changes its `open` property before its queued toggle
      // event. Capture the live DOM when closing immediately after a click.
      const closedProjects=new Set(state.closedProjects),openSubagents=new Set(state.openSubagents);
      if(!state.query.trim()){
        document.querySelectorAll('details[data-project]').forEach(node=>{if(node.open)closedProjects.delete(node.dataset.project);else closedProjects.add(node.dataset.project);});
        document.querySelectorAll('details[data-subagents]').forEach(node=>{if(node.open)openSubagents.add(node.dataset.subagents);else openSubagents.delete(node.dataset.subagents);});
      }
      const composition=document.querySelector('.token-composition');
      const scroll={...rememberedScroll,...pendingScroll};
      for(const key of Object.keys(selectors)){
        const node=nodeFor(key);
        if(!(key in pendingScroll)&&visible(node))scroll[key]=key==='activity'?node.scrollLeft:node.scrollTop;
      }
      return {version:1,view:state.view,selected:selectedPending||state.selected,filter:state.filter,query:state.query,range:state.range,date:state.date===today()?null:state.date,
        closedProjects:[...closedProjects],openSubagents:[...openSubagents],compositionOpen:composition?composition.open:Boolean(state.compositionOpen),activityMode:activity.getState().mode,scroll};
    }
    const controller=persistence.create({view,capture,save:value=>api.saveDashboardState(value),flushSync:value=>api.flushDashboardState(value),onError});
    function restore(saved){
      if(!saved)return;
      state.view=saved.view;state.selected=saved.selected;selectedPending=saved.selected;state.filter=saved.filter;state.query=saved.query;state.range=saved.range;state.date=saved.date||today();
      state.closedProjects=new Set(saved.closedProjects);state.openSubagents=new Set(saved.openSubagents);state.compositionOpen=saved.compositionOpen;
      pendingScroll={...saved.scroll};rememberedScroll={...saved.scroll};activity.setMode(saved.activityMode,{notify:false});
      document.getElementById('session-search').value=state.query;
      document.querySelectorAll('[data-agent]').forEach(button=>button.classList.toggle('active',button.dataset.agent===state.filter));
    }
    function resolveSelection(snapshot,fallbackSelection){
      const found=snapshot.sessions.some(session=>session.id===state.selected);
      if(found){selectedPending=null;return;}
      // The first cached snapshot may not yet contain the saved conversation.
      // Wait for indexing instead of saving a temporary default over its ID.
      if(selectedPending&&!(snapshot.diagnostics?.loading===false&&snapshot.diagnostics?.progress===1))return;
      selectedPending=null;state.selected=fallbackSelection;
    }
    function applyScroll(includeActivity=true){
      if(disposed)return;
      const complete=state.snapshot?.diagnostics?.loading===false&&state.snapshot?.diagnostics?.progress===1;
      for(const [key,target]of Object.entries(pendingScroll)){
        if(key==='activity'&&!includeActivity)continue;
        const node=nodeFor(key);if(!visible(node))continue;
        if((key==='events'||key==='meta')&&selectedPending)continue;
        const max=key==='activity'?node.scrollWidth-node.clientWidth:node.scrollHeight-node.clientHeight;
        if(max+.5<target&&!complete)continue;
        if(key==='activity')node.scrollLeft=target;else node.scrollTop=target;
        rememberedScroll[key]=key==='activity'?node.scrollLeft:node.scrollTop;delete pendingScroll[key];
      }
    }
    function afterRender(){
      if(disposed)return;
      applyScroll(false);if(fallback!==null)return;
      // Activity's zero-delay initial layout owns its default scroll. Apply the
      // remembered position afterwards, also in hidden views without RAF.
      fallback=view.setTimeout(()=>{fallback=null;applyScroll();},60);
    }
    function changed({selection=false,resetDetail=false}={}){
      if(selection)selectedPending=null;
      if(resetDetail){for(const key of ['events','meta']){delete pendingScroll[key];rememberedScroll[key]=0;const node=nodeFor(key);if(node)node.scrollTop=0;}}
      controller.schedule();
    }
    on(document,'scroll',event=>{
      for(const key of Object.keys(selectors)){if(event.target!==nodeFor(key))continue;if(key in pendingScroll)break;const node=event.target;rememberedScroll[key]=key==='activity'?node.scrollLeft:node.scrollTop;if(started)controller.schedule();break;}
    },true);
    // Explicit navigation supersedes delayed restoration; programmatic scroll
    // events do not. Preserve keyboard, wheel and touch interaction.
    const userScroll=event=>{for(const key of Object.keys(selectors)){const node=nodeFor(key);if(node?.contains(event.target))delete pendingScroll[key];}};
    on(document,'wheel',userScroll,{capture:true,passive:true});on(document,'touchstart',userScroll,{capture:true,passive:true});
    on(document,'keydown',event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(event.key))userScroll(event);},true);
    return {restore,resolveSelection,afterRender,changed,capture,start(){started=true;controller.start();afterRender();},flush:()=>controller.flush(),dispose(){if(disposed)return;disposed=true;controller.dispose();if(fallback!==null)view.clearTimeout(fallback);listeners.splice(0).forEach(remove=>remove());}};
  }
  return {create};
});
