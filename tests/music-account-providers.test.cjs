'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create}=require('../ui/music/account.js');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(handlers={}){
 const dom=new JSDOM('<section id="root"></section>',{url:'https://local.test',pretendToBeVisual:true}),root=dom.window.document.getElementById('root'),calls=[],played=[],notices=[];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const api=async(action,payload)=>{calls.push({action,payload});if(handlers[action])return handlers[action](payload);if(action==='bootstrap')return {profile:null};if(action==='platformStatus')return {provider:payload.provider,windowOpen:false,sessionSaved:false,apiConnected:false};return {};};
 const providers=[];let update;
 const account=create({root,api,onPlay:songs=>played.push(songs),onNotice:message=>notices.push(message),onProviderChange:provider=>providers.push(provider),subscribe:listener=>{update=listener;return()=>{update=null;};}});
 root.querySelector('.music-embedded-frame').getBoundingClientRect=()=>({left:50,top:90,width:800,height:500});
 return {account,root,calls,played,providers,notices,dom,emit:value=>update?.(value),close(){account.dispose();dom.window.close();}};
}

test('official Spotify identity wins over an opaque optional API name and absent photo uses account initial',async()=>{
 const current={provider:'spotify',apiConnected:false,webAuthenticated:true,profile:{nickname:'316tfcu46djjuihydv755gg',userId:'owned'},webProfile:{nickname:'kietl',userId:'owned',avatarURL:''}};
 const f=fixture({providerState:async()=>current,platformStatus:async()=>current});
 try{
  await f.account.activate();assert.equal(f.root.querySelector('.music-pill-name').textContent,'kietl');
  assert.equal(f.root.querySelector('.music-pill-avatar .music-avatar-initial').textContent,'K');
  assert.equal(f.root.querySelector('.music-pill-avatar img').hidden,true);
  f.account.open();await settle();f.root.querySelector('[data-music-platform="spotify"]').click();await settle();
  assert.equal(f.root.querySelector('.music-card-name').textContent,'kietl');assert.equal(f.root.querySelector('.music-card-avatar .music-avatar-initial').textContent,'K');
  assert.equal(f.root.querySelector('.music-spotify-connect').hidden,true);
  assert.equal(f.root.querySelector('.music-account-card').classList.contains('is-connected'),true);
  for(const selector of ['.music-official-methods','.music-login-methods','.music-qr-region','.music-unavailable'])assert.equal(f.root.querySelector(selector).hidden,true);
 }finally{f.close();}
});

test('a same-platform identity change refreshes once and repeated workspace broadcasts do not reload it',async()=>{
 const first={userId:'owner-one',nickname:'Owner'},second={userId:'owner-two',nickname:'Owner'};
 const f=fixture({providerState:async()=>({provider:'qq',profile:first,apiConnected:true})});
 try{
  await f.account.activate();assert.deepEqual(f.providers,[]);
  f.emit({platformSession:{provider:'qq',profile:second,apiConnected:true}});
  f.emit({workspaceProvider:{provider:'qq',profile:second,apiConnected:true}});
  f.emit({workspaceProvider:{provider:'qq',profile:{...second},apiConnected:true}});
  assert.deepEqual(f.providers,['qq']);assert.equal(f.account.getState().activeProvider,'qq');
  f.emit({platformSession:{provider:'kugou',profile:{nickname:'Different platform'},apiConnected:true}});
  assert.equal(f.root.querySelector('.music-pill-name').textContent,'Owner');assert.deepEqual(f.providers,['qq']);
 }finally{f.close();}
});
test('Spotify web login switches to its official workspace without an app ID or API connection',async()=>{
  const session={provider:'spotify',windowOpen:false,sessionSaved:true,apiConnected:false,profile:null,webAuthenticated:true,webProfile:{userId:'owned-web-user',nickname:'Spotify Listener',avatarURL:'https://i.scdn.co/image/avatar'}};
  const f=fixture({platformLogin:async()=>({provider:'spotify',windowOpen:true,sessionSaved:true,apiConnected:false}),selectProvider:async()=>({...session,webPlayer:true})});
  try{
    await f.account.activate();f.account.open();
    f.root.querySelector('[data-music-platform="spotify"]').click();await settle();
    f.root.querySelector('[data-music-action="spotify-web-player"]').click();await settle();
    assert.equal(f.account.getState().officialPanel,true);
    f.emit({platformSession:session});await settle();
    assert.equal(f.account.getState().officialPanel,false);
    assert.equal(f.root.querySelector('.music-card-name').textContent,'Spotify Listener');
    assert.match(f.root.querySelector('.music-card-description').textContent,/已连接/);
    assert.equal(f.root.querySelector('.music-official-methods').hidden,true);
    assert.equal(f.root.querySelector('[data-music-platform="spotify"] .music-platform-availability').textContent,'正在使用');
    assert.equal(f.root.querySelector('.music-pill-name').textContent,'Spotify Listener');
    assert.equal(f.root.querySelector('.music-pill-avatar img').getAttribute('src'),session.webProfile.avatarURL);
    assert.equal(f.account.getState().activeProvider,'spotify');assert.equal(f.account.getState().panelOpen,false);
    assert.deepEqual(f.providers,['spotify']);
    assert.equal(f.calls.filter(value=>value.action==='selectProvider').length,1);
    assert.equal(f.root.querySelector('[data-music-action="spotify-authorize"]'),null);
    assert.equal(f.root.querySelector('[data-music-action="spotify-client"]'),null);
    assert.equal(f.calls.some(value=>value.action==='platformRequest'&&value.payload.provider==='spotify'),false);
  }finally{f.close();}
});

test('a saved Spotify web profile restores the capsule and opens the same official player',async()=>{
 const session={provider:'spotify',windowOpen:false,sessionSaved:true,apiConnected:false,webAuthenticated:true,webPlayer:true,webProfile:{userId:'spotify-owner',nickname:'Listener',avatarURL:'https://i.scdn.co/image/saved-avatar'}};
 const f=fixture({providerState:async()=>session,platformStatus:async()=>session,selectProvider:async()=>session});
 try{
  await f.account.activate();assert.equal(f.account.getState().activeProvider,'spotify');
  assert.equal(f.root.querySelector('.music-pill-name').textContent,'Listener');
  assert.equal(f.root.querySelector('.music-card-name').textContent,'Listener');
  f.account.open();await settle();f.root.querySelector('[data-music-action="spotify-web-player"]').click();await settle();
  assert.equal(f.account.getState().panelOpen,false);
  assert(f.calls.some(value=>value.action==='selectProvider'&&value.payload.provider==='spotify'));
  assert.equal(f.calls.some(value=>value.action==='platformLogin'||value.action==='platformRequest'),false);
 }finally{f.close();}
});

test('Spotify web profile broadcasts enrich the identity without repeatedly refreshing its workspace',async()=>{
 const profile={userId:'spotify-owner',nickname:'Spotify 用户',avatarURL:''};
 const session={provider:'spotify',windowOpen:false,sessionSaved:true,apiConnected:false,profile:null,webAuthenticated:true,webPlayer:true,webProfile:profile};
 const f=fixture({providerState:async()=>session});
 try{
  await f.account.activate();assert.deepEqual(f.providers,[]);
  f.emit({platformSession:session});f.emit({workspaceProvider:{...session,webProfile:{...profile}}});
  const enriched={...profile,nickname:'Real Listener',avatarURL:'https://i.scdn.co/image/real-avatar'};
  f.emit({platformSession:{...session,webProfile:enriched}});
  f.emit({workspaceProvider:{...session,profile:{...enriched}}});
  f.emit({platformSession:{...session,webProfile:{...enriched}}});
  assert.deepEqual(f.providers,[]);assert.equal(f.calls.some(value=>value.action==='selectProvider'),false);
  assert.equal(f.root.querySelector('.music-pill-name').textContent,'Real Listener');
  assert.equal(f.root.querySelector('.music-card-name').textContent,'Real Listener');
  for(const selector of ['.music-pill-avatar img','.music-card-avatar img'])assert.equal(f.root.querySelector(selector).getAttribute('src'),enriched.avatarURL);
  f.emit({platformSession:{...session,webProfile:{...enriched,userId:'another-owner',nickname:'Other Listener'}}});
  assert.deepEqual(f.providers,['spotify']);
 }finally{f.close();}
});

test('an expired active provider clears its displayed identity and restores the QR entry',async()=>{
 const f=fixture({providerState:async()=>({provider:'qishui',profile:{userId:'owner',nickname:'Owner'},apiConnected:true})});
 try{
  await f.account.activate();f.account.open();
  f.emit({platformSession:{provider:'qishui',profile:null,apiConnected:false,sessionSaved:true}});
  assert.equal(f.root.querySelector('.music-pill-name').textContent,'登录音乐');
  assert.equal(f.root.querySelector('.music-login-methods').hidden,false);
  assert.equal(f.account.getState().authenticated,false);
 }finally{f.close();}
});

for(const provider of ['qq','kugou'])test(provider+' renders its official QR directly and switches only after server verification',async()=>{
 const profile={nickname:provider+' owner'},qr='data:image/png;base64,iVBORw0KGgo=';
 const f=fixture({
  platformRequest:async payload=>payload.action==='qrCreate'?{provider,requestId:'owned-qr',qrImage:qr,expiresAt:Date.now()+180000}:payload.action==='qrCheck'?{provider,status:'confirmed',apiConnected:true,profile}:{canceled:true},
  selectProvider:async payload=>({provider:payload.provider,profile,apiConnected:true})
 }),timers=new Map();let next=0;
 f.dom.window.setTimeout=(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id;};f.dom.window.clearTimeout=id=>timers.delete(id);
 try{
  await f.account.activate();f.account.open();f.root.querySelector('[data-music-platform="'+provider+'"]').click();await settle();
  f.root.querySelector('[data-music-action="qr"]').click();await settle();
  assert.equal(f.root.querySelector('.music-qr-image img').getAttribute('src'),qr);
  assert.equal(f.account.getState().activeProvider,'netease');
  assert(f.calls.some(value=>value.action==='platformRequest'&&value.payload.provider===provider&&value.payload.action==='qrCreate'));
  assert(!f.calls.some(value=>value.action==='beginQR'||value.action==='platformLogin'));
  if(provider==='qq')assert.match(f.root.querySelector('.music-qr-status').textContent,/QQ App 扫码/);
  const poll=[...timers.values()].find(value=>value.delay===2000);assert(poll);poll.callback();await settle();
  assert.equal(f.account.getState().activeProvider,provider);assert.equal(f.account.getState().authenticated,true);
  assert.equal(f.root.querySelector('.music-pill-name').textContent,profile.nickname);assert.deepEqual(f.providers,[provider]);
  f.account.close({immediate:true});await settle();assert(f.calls.some(value=>value.action==='platformRequest'&&value.payload.provider===provider&&value.payload.action==='closeQr'));
 }finally{f.close();}
});

test('restored provider identity owns the account capsule and failed verification keeps the current account',async()=>{
 const f=fixture({bootstrap:async()=>({profile:{nickname:'NetEase owner'}}),providerState:async()=>({provider:'qq',profile:{nickname:'QQ owner'},apiConnected:true}),platformStatus:async({provider})=>({provider,sessionSaved:true,apiConnected:true,profile:{nickname:provider+' owner'}}),platformRequest:async()=>({error:'账号已过期'}),selectProvider:async()=>{throw new Error('must not select before verification');}});
 try{
  await f.account.activate();assert.equal(f.account.getState().selected,'qq');assert.equal(f.root.querySelector('.music-pill-name').textContent,'QQ owner');
  f.account.open();f.root.querySelector('[data-music-platform="kugou"]').click();await settle();
  assert.equal(f.account.getState().activeProvider,'qq');assert.equal(f.root.querySelector('.music-pill-name').textContent,'QQ owner');assert.equal(f.calls.filter(value=>value.action==='selectProvider').length,0);
 }finally{f.close();}
});

test('closing a failed QR creation releases the provider host even without a request ID',async()=>{
 const f=fixture({platformRequest:async payload=>payload.action==='qrCreate'?{error:'二维码暂不可用'}:{canceled:true}});
 try{
  await f.account.activate();f.account.open();f.root.querySelector('[data-music-platform="qq"]').click();await settle();
  f.root.querySelector('[data-music-action="qr"]').click();await settle();assert.equal(f.account.getState().qrStatus,'error');
  f.account.close({immediate:true});await settle();
  assert(f.calls.some(value=>value.action==='platformRequest'&&value.payload.provider==='qq'&&value.payload.action==='closeQr'));
  assert.equal(f.account.getState().pendingTimer,false);
 }finally{f.close();}
});
test('the QQ account library plays its exact provider queue through the shared player callback',async()=>{
 const songs=[{id:'qq:001AbCdEfGhI23',title:'One',source:'qq'},{id:'qq:002AbCdEfGhI23',title:'Two',source:'qq'}];
 const f=fixture({platformRequest:async payload=>payload.action==='playlists'?{playlists:[{id:'qq:17',title:'My playlist',trackCount:2}]}:{songs}});
 try{
  await f.account.activate();f.account.open();f.root.querySelector('[data-music-platform="qq"]').click();await settle();
  f.root.querySelector('[data-music-action="official-library"]').click();await settle();assert.equal(f.root.querySelector('[data-platform-playlist]').textContent,'My playlist2 首');
  f.root.querySelector('[data-platform-playlist]').click();await settle();assert.deepEqual(f.played,[songs]);assert.equal(f.account.getState().panelOpen,false);assert(f.calls.some(value=>value.action==='platformRequest'&&value.payload.action==='playlist'&&value.payload.limit===50));
 }finally{f.close();}
});
test('an embedded official login closes with the account dialog and its late result cannot reopen the panel',async()=>{
 let finish;const f=fixture({platformLogin:payload=>new Promise(resolve=>finish=()=>resolve({provider:payload.provider,windowOpen:true,sessionSaved:true}))});
 try{
  await f.account.activate();f.account.open();f.root.querySelector('[data-music-platform="kugou"]').click();await settle();f.root.querySelector('[data-music-action="official-login"]').click();await settle();
  const opened=f.calls.find(value=>value.action==='platformLogin');assert.deepEqual(opened.payload.bounds,{x:50,y:90,width:800,height:500});assert(f.account.getState().officialPanel);
  f.account.close({immediate:true});finish();await settle();assert.equal(f.account.getState().panelOpen,false);assert.equal(f.account.getState().officialPanel,false);assert(f.calls.some(value=>value.action==='platformClose'&&value.payload.provider==='kugou'));
 }finally{f.close();}
});

test('Qishui uses its own real Passport QR actions and never sends NetEase login requests',async()=>{
 const f=fixture({selectProvider:async()=>({provider:'qishui',profile:{nickname:'Soda user'},apiConnected:true}),platformRequest:async payload=>payload.action==='qrCreate'?{provider:'qishui',requestId:'soda-owned-qr',qrImage:'data:image/png;base64,iVBORw0KGgo=',expiresAt:Date.now()+180000,status:'waiting'}:payload.action==='qrCheck'?{provider:'qishui',status:'confirmed',apiConnected:true,profile:{nickname:'Soda user'}}:{canceled:true}}),timers=new Map();let id=0;
 f.dom.window.setTimeout=(callback,delay)=>{const key=++id;timers.set(key,{callback,delay});return key;};f.dom.window.clearTimeout=key=>timers.delete(key);
 try{
  await f.account.activate();f.account.open();f.root.querySelector('[data-music-platform="qishui"]').click();await settle();
  assert(!f.root.querySelector('.music-login-methods').hidden);f.root.querySelector('[data-music-action="qr"]').click();await settle();
  assert(f.calls.some(value=>value.action==='platformRequest'&&value.payload.action==='qrCreate'));assert(!f.calls.some(value=>value.action==='beginQR'));
  assert.match(f.root.querySelector('.music-qr-status').textContent,/抖音 App 扫码/);
  const poll=[...timers.values()].find(value=>value.delay===2000);assert(poll);poll.callback();await settle();
  assert.equal(f.root.querySelector('.music-card-name').textContent,'Soda user');assert.equal(f.account.getState().officialSession.apiConnected,true);assert.equal(f.account.getState().activeProvider,'qishui');assert.equal(f.account.getState().authenticated,true);
  f.account.close({immediate:true});await settle();assert(f.calls.some(value=>value.action==='platformRequest'&&value.payload.action==='closeQr'));
 }finally{f.close();}
});

for (const provider of ['qq', 'kugou', 'qishui']) {
 test(provider+' verified account renders the same compact identity card as NetEase',async()=>{
  const profile={userId:provider+'-owner',nickname:provider+' owner',avatarURL:'https://local.test/'+provider+'-avatar.jpg',vip:true};
  const connected={provider,sessionSaved:true,apiConnected:true,windowOpen:false,profile};
  const f=fixture({providerState:async()=>connected,platformStatus:async()=>connected});
  try{
   await f.account.activate();f.account.open();await settle();
   assert.equal(f.root.querySelector('.music-card-name').textContent,profile.nickname);
   assert.match(f.root.querySelector('.music-card-description').textContent,/已连接/);
   assert(f.root.querySelector('.music-account-card').classList.contains('is-connected'));
   for(const selector of ['.music-official-methods','.music-login-methods','.music-qr-region','.music-unavailable']){
    assert.equal(f.root.querySelector(selector).hidden,true,selector+' must hide after verification');
   }
   assert.equal(f.root.querySelector('.music-logout').hidden,false);
   assert.equal(f.root.querySelector('.music-card-vip').hidden,false);
   assert.equal(f.root.querySelector('.music-account-pill>.music-vip').hidden,false);
   for(const selector of ['.music-card-avatar img','.music-pill-avatar img']){
    const image=f.root.querySelector(selector);
    assert.equal(image.hidden,false);
    assert.equal(image.getAttribute('src'),profile.avatarURL);
   }
  }finally{f.close();}
 });

 test(provider+' unconnected account retains its in-panel QR entry',async()=>{
  const f=fixture({platformRequest:async payload=>payload.action==='qrCreate'?{provider,requestId:'unconnected-qr',qrImage:'data:image/png;base64,iVBORw0KGgo=',expiresAt:Date.now()+180000}:{canceled:true}});
  try{
   await f.account.activate();f.account.open();f.root.querySelector('[data-music-platform="'+provider+'"]').click();await settle();
   assert.equal(f.root.querySelector('.music-login-methods').hidden,false);
   assert.equal(f.root.querySelector('.music-logout').hidden,true);
   f.root.querySelector('[data-music-action="qr"]').click();await settle();
   assert(f.calls.some(value=>value.action==='platformRequest'&&value.payload.provider===provider&&value.payload.action==='qrCreate'));
   assert.equal(f.root.querySelector('.music-qr-region').hidden,false);
   assert.equal(f.root.querySelector('.music-qr-image img').hidden,false);
  }finally{f.close();}
 });
}

test('platform subscriptions keep the selected card and active capsule avatars in their own account scope',async()=>{
 const profiles={qq:{userId:'qq-owner',nickname:'QQ owner',avatarURL:'https://local.test/qq.jpg',vip:true},kugou:{userId:'kg-owner',nickname:'KG owner',avatarURL:'https://local.test/kg.jpg',vip:false}};
 const connected=provider=>({provider,sessionSaved:true,apiConnected:true,windowOpen:false,profile:profiles[provider]});
 const f=fixture({providerState:async()=>connected('qq'),platformStatus:async({provider})=>connected(provider),platformRequest:async({provider})=>connected(provider),selectProvider:async({provider})=>connected(provider)});
 const avatar=selector=>f.root.querySelector(selector+' img').getAttribute('src');
 try{
  await f.account.activate();f.account.open();await settle();
  f.emit({platformSession:connected('kugou')});
  assert.equal(avatar('.music-pill-avatar'),profiles.qq.avatarURL);
  assert.equal(avatar('.music-card-avatar'),profiles.qq.avatarURL);
  profiles.qq={...profiles.qq,avatarURL:'https://local.test/qq-updated.jpg'};
  f.emit({platformSession:connected('qq')});
  assert.equal(avatar('.music-pill-avatar'),profiles.qq.avatarURL);
  assert.equal(avatar('.music-card-avatar'),profiles.qq.avatarURL);
  f.root.querySelector('[data-music-platform="kugou"]').click();await settle();
  assert.equal(f.account.getState().activeProvider,'kugou');
  assert.equal(avatar('.music-pill-avatar'),profiles.kugou.avatarURL);
  assert.equal(avatar('.music-card-avatar'),profiles.kugou.avatarURL);
  assert.equal(f.root.querySelector('.music-account-pill>.music-vip').hidden,true);
  assert.equal(f.root.querySelector('.music-card-vip').hidden,true);
  f.emit({platformSession:connected('qq')});
  assert.equal(avatar('.music-pill-avatar'),profiles.kugou.avatarURL);
  assert.equal(avatar('.music-card-avatar'),profiles.kugou.avatarURL);
 }finally{f.close();}
});
