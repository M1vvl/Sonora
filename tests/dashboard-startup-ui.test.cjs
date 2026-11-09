'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ui/dashboard.html'),'utf8');
const source=fs.readFileSync(path.join(root,'ui/dashboard.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const never=()=>new Promise(()=>{});

async function fixture(t,{saved={view:'overview'},settingsError,settingsPending=false,stateError,snapshotError,snapshotPending=false,createError,activateError,synchronousActivationError,activationPending=false}={}) {
  const dom=new JSDOM(html,{url:'https://agent-pulse.local/dashboard.html',runScripts:'outside-only'}),window=dom.window;
  t.after(()=>window.close());
  const calls={ready:0,restore:0,start:0,changed:0,activated:0,created:0,background:0,disposed:0,snapshot:0},listeners={};
  let finishSettings;
  const controller={activate(){calls.activated++;if(synchronousActivationError)throw new Error(synchronousActivationError);if(activateError)return Promise.reject(new Error(activateError));return activationPending?never():Promise.resolve();},deactivate(){},background(){calls.background++;},dispose(){calls.disposed++;}};
  window.pulse={
    getSettings:async()=>{if(settingsError)throw new Error(settingsError);const value={interfaceTheme:'klein-blue',dashboardGlass:true};return settingsPending?new Promise(resolve=>{finishSettings=()=>resolve(value);}):value;},
    getDashboardState:async()=>{if(stateError)throw new Error(stateError);return saved;},
    getSnapshot:()=>{calls.snapshot++;if(snapshotError)return Promise.reject(new Error(snapshotError));return snapshotPending?never():Promise.resolve({sessions:[],totals:{},today:{},dailyUsage:[]});},
    dashboardReady:async()=>{calls.ready++;},animeRequest:async()=>{},moviesRequest:async()=>{},musicRequest:async()=>{},
    onSnapshot:listener=>{listeners.snapshot=listener;},onSettings:listener=>{listeners.settings=listener;},onDashboardVisibility:listener=>{listeners.visibility=listener;},
    onDashboardShape(){},onDashboardMaterial(){},onAnimeHistory(){},onMoviesHistory(){},onMusicStatus(){}
  };
  window.PulseTokenActivity={create:()=>({update(){},dispose(){},getState:()=>({mode:'daily'})})};
  window.PulseDashboardWorkspace={create:({state})=>({restore(value){calls.restore++;Object.assign(state,value);},start(){calls.start++;},changed(){calls.changed++;},afterRender(){},resolveSelection(){},dispose(){},flush:async()=>{}})};
  window.PulseDashboardMaterial={create:()=>({update(){},setShape(){},setDiagnostics(){},dispose(){}})};
  window.PulseThemes={normalize:value=>value||'original',apply:(element,value)=>{element.dataset.interfaceTheme=value;},mount:()=>({setValue(){}})};
  const create=()=>{calls.created++;if(createError)throw new Error(createError);return controller;};
  window.PulseMusicUI=window.PulseAnimeUI={create};
  window.eval(source+'\nwindow.dashboardTest={getState:()=>state,setView};');
  await settle();await settle();
  return {window,document:window.document,calls,listeners,finishSettings:()=>finishSettings?.()};
}

function visibleView(document) {
  return ['monitor-view','settings-view','anime-view','movies-view','music-view'].filter(id=>!document.getElementById(id).hidden);
}

test('saved-view construction failure returns a visible overview before the ready handshake',async t=>{
  const f=await fixture(t,{saved:{view:'music'},createError:'music failed to mount'});
  assert.deepEqual(visibleView(f.document),['monitor-view']);assert.equal(f.document.getElementById('nav-overview').classList.contains('active'),true);
  assert.equal(f.calls.ready,1);assert.equal(f.calls.start,1);assert.match(f.document.getElementById('toast').textContent,/music failed/);
});

test('settings failure preserves restored monitor state while startup still opens music',async t=>{
  const f=await fixture(t,{saved:{view:'settings',selected:'saved-conversation',filter:'Claude',query:'saved query',range:'history'},settingsError:'settings unavailable',snapshotPending:true});
  assert.equal(f.calls.restore,1);assert.equal(f.calls.start,1);assert.equal(f.calls.ready,1);assert.deepEqual(visibleView(f.document),['music-view']);
  const state=f.window.dashboardTest.getState();assert.equal(state.selected,'saved-conversation');assert.equal(state.filter,'Claude');assert.equal(state.query,'saved query');assert.equal(state.range,'history');
});

test('new windows open music regardless of the last saved navigation tab',async t=>{
  for(const view of ['overview','settings','anime','movies','music']){
    const f=await fixture(t,{saved:{view},snapshotPending:true});
    assert.deepEqual(visibleView(f.document),['music-view'],view);assert.equal(f.calls.created,1);assert.equal(f.calls.activated,1);assert.equal(f.calls.ready,1);
    assert.equal(f.document.getElementById('nav-music').classList.contains('active'),true);
  }
});

test('hiding and showing the live music page retains its controller and does not rerun startup',async t=>{
  const f=await fixture(t,{snapshotPending:true});
  f.listeners.visibility({visible:false});assert.equal(f.calls.background,1);assert.equal(f.calls.disposed,0);
  f.listeners.visibility({visible:true});assert.equal(f.calls.activated,2);assert.equal(f.calls.created,1);assert.equal(f.calls.restore,1);assert.equal(f.calls.ready,1);
  f.document.getElementById('nav-settings').click();f.listeners.visibility({visible:false});f.listeners.visibility({visible:true});
  assert.deepEqual(visibleView(f.document),['settings-view']);assert.equal(f.calls.created,1);assert.equal(f.calls.disposed,0);
});

test('failed workspace read preserves loaded theme and never starts default-state persistence',async t=>{
  const f=await fixture(t,{stateError:'state unavailable',snapshotPending:true});
  assert.equal(f.document.documentElement.dataset.interfaceTheme,'klein-blue');assert.equal(f.calls.restore,0);assert.equal(f.calls.start,0);assert.equal(f.calls.ready,1);
  f.document.getElementById('nav-settings').click();assert.equal(f.calls.start,0);assert.deepEqual(visibleView(f.document),['settings-view']);
});

test('a pending catalog activation and snapshot cannot hold the native reveal gate',async t=>{
  const f=await fixture(t,{saved:{view:'music'},activationPending:true,snapshotPending:true});
  assert.equal(f.calls.activated,1);assert.equal(f.calls.ready,1);assert.deepEqual(visibleView(f.document),['music-view']);
});

test('activation and snapshot rejections are handled without stopping subsequent navigation',async t=>{
  const f=await fixture(t,{saved:{view:'music'},activateError:'catalog offline',snapshotError:'snapshot unavailable'});
  assert.equal(f.calls.ready,1);assert.equal(f.calls.start,1);assert.match(f.document.getElementById('toast').textContent,/snapshot unavailable/);
  f.document.getElementById('nav-overview').click();assert.deepEqual(visibleView(f.document),['monitor-view']);
});

test('a later view construction failure retains visible controls and returns to overview',async t=>{
  const f=await fixture(t,{createError:'panel constructor failed'});
  f.document.getElementById('nav-music').click();assert.deepEqual(visibleView(f.document),['monitor-view']);assert.equal(f.window.dashboardTest.getState().view,'overview');
  assert.equal(f.calls.ready,1);assert.match(f.document.getElementById('toast').textContent,/panel constructor failed/);
});

test('a synchronous activation failure cannot leave only the newly selected empty container',async t=>{
  const f=await fixture(t,{saved:{view:'music'},synchronousActivationError:'activation failed'});
  assert.deepEqual(visibleView(f.document),['monitor-view']);assert.equal(f.calls.ready,1);assert.match(f.document.getElementById('toast').textContent,/activation failed/);
});

test('closing during pending initialization suppresses stale restoration and ready IPC',async t=>{
  const f=await fixture(t,{settingsPending:true,snapshotPending:true});
  assert.equal(f.calls.ready,0);const restored=f.calls.restore,theme=f.document.documentElement.dataset.interfaceTheme;
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  f.finishSettings();
  f.listeners.snapshot({sessions:[],settings:{interfaceTheme:'other'}});
  await settle();assert.equal(f.calls.ready,0);assert.equal(f.calls.restore,restored);assert.equal(f.calls.start,0);assert.equal(f.document.documentElement.dataset.interfaceTheme,theme);
});

test('settings save and failure feedback work after removing the page status and source panels',async t=>{
 const f=await fixture(t),patches=[];
 f.window.pulse.saveSettings=async patch=>{patches.push(patch);return {settings:patch};};
 f.document.getElementById('nav-settings').click();
 const toggle=f.document.getElementById('setting-music');toggle.checked=false;toggle.dispatchEvent(new f.window.Event('change'));
 await settle();assert.deepEqual(JSON.parse(JSON.stringify(patches)),[{musicReactive:false}]);
 assert.equal(f.window.dashboardTest.getState().settings.musicReactive,false);assert.equal(toggle.checked,false);
 f.window.pulse.saveSettings=async()=>{throw new Error('write unavailable');};
 toggle.checked=true;toggle.dispatchEvent(new f.window.Event('change'));await settle();
 assert.match(f.document.getElementById('toast').textContent,/write unavailable/);
 assert.equal(toggle.checked,false,'A failed write restores the last saved value without depending on a removed label.');
});
