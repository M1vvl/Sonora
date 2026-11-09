'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create}=require('../ui/dashboard-workspace.js');
function fixture(){
  const dom=new JSDOM('<main class="content-scroll"><input id="session-search"><button data-agent="all"></button><button data-agent="Codex"></button><button data-agent="Claude"></button><section id="sessions-list"><details data-project="p1"><summary>Project</summary><details data-subagents="p1"><summary>Agents</summary></details></details></section><section class="detail-meta"><details class="token-composition"><summary>Usage</summary></details></section><section class="event-list"><p>Event</p></section><section class="token-activity-scroll"></section></main>',{pretendToBeVisual:true}),view=dom.window,document=view.document,timers=new Map(),frames=new Map(),saved=[],sync=[];let id=0;
  view.setTimeout=(callback,delay)=>{const value=++id;timers.set(value,{callback,delay});return value;};view.clearTimeout=value=>timers.delete(value);view.requestAnimationFrame=callback=>{const value=++id;frames.set(value,callback);return value;};view.cancelAnimationFrame=value=>frames.delete(value);
  const selectors={sessions:'#sessions-list',events:'.event-list',meta:'.detail-meta',content:'.content-scroll',activity:'.token-activity-scroll'},nodes={},geometry={};
  for(const [key,selector]of Object.entries(selectors)){
    const node=document.querySelector(selector);nodes[key]=node;geometry[key]={max:500,hidden:false,value:0};const size=geometry[key];
    node.getClientRects=()=>size.hidden?[]:[{width:100,height:100}];
    Object.defineProperties(node,{clientHeight:{get:()=>100},scrollHeight:{get:()=>size.max+100},clientWidth:{get:()=>100},scrollWidth:{get:()=>size.max+100},scrollTop:{get:()=>size.value,set:value=>{size.value=Math.max(0,Math.min(size.max,Number(value)||0));}},scrollLeft:{get:()=>size.value,set:value=>{size.value=Math.max(0,Math.min(size.max,Number(value)||0));}}});
  }
  const state={snapshot:null,view:'overview',selected:null,filter:'all',query:'',range:'today',date:'2026-10-29',closedProjects:new Set(),openSubagents:new Set(),compositionOpen:false};let mode='daily';
  const activity={getState:()=>({mode}),setMode:value=>{mode=value;}},api={saveDashboardState:value=>{saved.push(value);return value;},flushDashboardState:value=>{sync.push(value);return value;}},controller=create({state,activity,api,document,today:()=> '2026-10-29'});
  const baseline={version:1,view:'overview',selected:'late',filter:'Codex',query:'',range:'history',date:null,closedProjects:['p1'],openSubagents:[],compositionOpen:false,activityMode:'weekly',scroll:{sessions:80,events:130,meta:20,content:0,activity:120}};
  return {view,document,state,nodes,geometry,activity,controller,baseline,timers,frames,saved,sync,
    tickFrames(){for(const [key,callback]of [...frames]){frames.delete(key);callback();}},
    tickTimers(){for(const [key,item]of [...timers]){timers.delete(key);item.callback();}},
    close(){controller.dispose();dom.window.close();}};
}
const loading={loading:true,progress:.2},complete={loading:false,progress:1};

test('workspace restores controls and protects the saved selection through partial initial snapshots',()=>{
  const f=fixture();try{
    f.controller.restore(f.baseline);assert.equal(f.state.selected,'late');assert.equal(f.state.date,'2026-10-29');assert.equal(f.document.querySelector('[data-agent="Codex"]').classList.contains('active'),true);assert.equal(f.activity.getState().mode,'weekly');
    f.controller.resolveSelection({sessions:[{id:'temporary'}],diagnostics:loading},'temporary');assert.equal(f.state.selected,'late');assert.equal(f.controller.capture().selected,'late');
    f.controller.resolveSelection({sessions:[{id:'late'}],diagnostics:loading},'temporary');assert.equal(f.state.selected,'late');
    f.controller.resolveSelection({sessions:[{id:'temporary'}],diagnostics:complete},'temporary');assert.equal(f.state.selected,'temporary');
  }finally{f.close();}
});

test('pending scroll targets survive short partial lists and restore when the real content arrives',()=>{
  const f=fixture();try{
    f.geometry.sessions.max=25;f.geometry.events.max=30;f.controller.restore(f.baseline);f.state.snapshot={diagnostics:loading};f.controller.afterRender();
    assert.equal(f.nodes.sessions.scrollTop,0);assert.equal(f.nodes.events.scrollTop,0);assert.equal(f.controller.capture().scroll.sessions,80);assert.equal(f.controller.capture().scroll.events,130);
    f.geometry.sessions.max=400;f.geometry.events.max=400;f.controller.resolveSelection({sessions:[{id:'late'}],diagnostics:complete},'temporary');f.state.snapshot={diagnostics:complete};f.controller.afterRender();
    assert.equal(f.nodes.sessions.scrollTop,80);assert.equal(f.nodes.events.scrollTop,130);assert.equal(f.nodes.meta.scrollTop,20);
    f.controller.afterRender();assert.equal(f.frames.size,0);assert.equal(f.timers.size,1,'one bounded layout fallback');f.tickTimers();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
  }finally{f.close();}
});

test('a missing saved conversation falls back after indexing and out-of-range scroll clamps once',()=>{
  const f=fixture();try{
    f.controller.restore({...f.baseline,scroll:{events:1800}});f.state.snapshot={diagnostics:complete};f.controller.resolveSelection({sessions:[{id:'existing'}],diagnostics:complete},'existing');f.controller.afterRender();
    assert.equal(f.state.selected,'existing');assert.equal(f.nodes.events.scrollTop,500);assert.equal(f.controller.capture().scroll.events,500);
  }finally{f.close();}
});

test('explicit wheel or keyboard navigation supersedes pending restoration',()=>{
  const f=fixture();try{
    f.controller.restore(f.baseline);f.geometry.events.max=50;f.state.snapshot={diagnostics:loading};f.controller.afterRender();
    f.nodes.events.querySelector('p').dispatchEvent(new f.view.WheelEvent('wheel',{bubbles:true}));f.nodes.events.scrollTop=33;f.nodes.events.dispatchEvent(new f.view.Event('scroll'));f.controller.afterRender();
    assert.equal(f.controller.capture().scroll.events,33);assert.equal(f.nodes.events.scrollTop,33);
    f.nodes.sessions.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'PageDown',bubbles:true}));f.nodes.sessions.scrollTop=15;f.controller.afterRender();assert.equal(f.controller.capture().scroll.sessions,15);
  }finally{f.close();}
});

test('hidden panels retain remembered scroll and explicit selection clears only detail offsets',()=>{
  const f=fixture();try{
    f.controller.restore(f.baseline);f.geometry.sessions.hidden=true;f.geometry.events.hidden=true;f.controller.afterRender();assert.equal(f.controller.capture().scroll.sessions,80);assert.equal(f.controller.capture().scroll.events,130);
    f.state.selected='clicked';f.controller.changed({selection:true,resetDetail:true});assert.equal(f.controller.capture().selected,'clicked');assert.equal(f.controller.capture().scroll.events,0);assert.equal(f.controller.capture().scroll.meta,0);assert.equal(f.controller.capture().scroll.sessions,80);
  }finally{f.close();}
});

test('beforeunload saves fresh workspace state and disposal releases owned work',()=>{
  const f=fixture();try{
    f.controller.restore(f.baseline);f.controller.start();f.state.query='last input';f.controller.changed();f.view.dispatchEvent(new f.view.Event('beforeunload'));
    assert.equal(f.sync.length,1);assert.equal(f.sync[0].query,'last input');assert.equal(f.sync[0].selected,'late');f.controller.dispose();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
  }finally{f.close();}
});

test('exit capture reads current details DOM even before asynchronous toggle dispatch',()=>{
  const f=fixture();try{
    f.controller.restore(f.baseline);f.controller.start();const project=f.document.querySelector('[data-project]'),subagents=f.document.querySelector('[data-subagents]'),composition=f.document.querySelector('.token-composition');
    project.open=true;subagents.open=true;composition.open=true;f.view.dispatchEvent(new f.view.Event('beforeunload'));const saved=f.sync[0];
    assert.deepEqual(saved.closedProjects,[]);assert.deepEqual(saved.openSubagents,['p1']);assert.equal(saved.compositionOpen,true);
  }finally{f.close();}
});

test('deferred first heatmap layout cannot overwrite its restored horizontal position',()=>{
  const f=fixture();try{
    f.controller.restore(f.baseline);f.state.snapshot={diagnostics:complete};f.controller.afterRender();
    f.nodes.activity.scrollLeft=500; // TokenActivity initial layout chooses its default latest month.
    f.tickTimers();assert.equal(f.nodes.activity.scrollLeft,120);
  }finally{f.close();}
});

test('heatmap input cancels both its pending restoration and its outer scroll ancestor',()=>{
  const f=fixture();try{
    f.controller.restore(f.baseline);f.state.snapshot={diagnostics:complete};
    f.nodes.activity.dispatchEvent(new f.view.WheelEvent('wheel',{bubbles:true}));
    f.nodes.activity.scrollLeft=35;f.controller.afterRender();f.tickTimers();
    assert.equal(f.nodes.activity.scrollLeft,35);assert.equal(f.controller.capture().scroll.activity,35);
  }finally{f.close();}
});
