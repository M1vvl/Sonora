'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createPlatformLogin,trustedURL,loginScript,activateLogin,QQ_METHODS}=require('../src/music/platform-login.cjs');
const {JSDOM}=require('jsdom');

test('QQ method selection reaches only bounded trusted official frames',async()=>{
  const executed=[];
  const frame=(url,result)=>({url,isDestroyed:()=>false,executeJavaScript:async code=>{executed.push({url,code});return result;}});
  const root=frame('https://y.qq.com/',{methodApplied:false});
  const child=frame('https://xui.ptlogin2.qq.com/cgi-bin/xlogin',{methodApplied:true});
  const untrusted=frame('https://qq.com.evil.test/',{methodApplied:true});root.framesInSubtree=[root,child,untrusted];
  const value=await activateLogin({mainFrame:root},'qq','wechat');assert.equal(value.methodApplied,true);assert.equal(executed.length,2);assert(executed.every(row=>!row.code.includes('document.cookie')));
});

function fixture(options={}){
  const fetchProfile=options.fetchProfile;
  const partitions=new Map(),views=[],updates=[];
  const owner=new EventEmitter();owner.isDestroyed=()=>false;owner.getContentSize=()=>[1200,800];owner.children=[];
  owner.contentView={addChildView:view=>owner.children.push(view),removeChildView:view=>{owner.children=owner.children.filter(value=>value!==view);}};
  const session={fromPartition(partition,options){
    if(!partitions.has(partition)){
      const cookies=new EventEmitter(),value={partition,options,cookies,values:[],cleared:0,flushed:0,closed:0};
      if(fetchProfile)value.fetch=fetchProfile;
      cookies.get=async()=>value.values;
      value.setPermissionRequestHandler=handler=>value.permission=handler;
      value.setPermissionCheckHandler=handler=>value.checkPermission=handler;
      value.flushStorageData=()=>{value.flushed++;};value.clearStorageData=async()=>{value.cleared++;value.values=[];};value.clearCache=async()=>{};value.closeAllConnections=async()=>{value.closed++;};
      partitions.set(partition,value);
    }
    return partitions.get(partition);
  }};
  class View{
    constructor(preferences){this.options=preferences;this.webContents=new EventEmitter();this.destroyed=false;this.scripts=[];views.push(this);const web=this.webContents;web.setWindowOpenHandler=handler=>this.popup=handler;web.getURL=()=>this.url;web.executeJavaScript=async script=>{this.scripts.push(script);return options.executeJavaScript?options.executeJavaScript(this,script):{methodApplied:true};};web.isDestroyed=()=>this.destroyed;web.focus=()=>{this.focused=true;};web.loadURL=async url=>{this.url=url;await options.loadURL?.(this,url);web.emit('did-finish-load');};web.close=()=>{if(this.destroyed)return;this.destroyed=true;web.emit('destroyed');};}
    setBounds(bounds){this.bounds=bounds;}
    setBackgroundColor(){}
  }
  const api=createPlatformLogin({electron:{WebContentsView:View,session,BrowserWindow:class{constructor(){throw new Error('External window forbidden');}}},getHostWindow:()=>owner,onStatus:value=>updates.push(value)});
  const open=payload=>api.open({bounds:{x:80,y:100,width:900,height:600},...payload});
  return {api,open,partitions,views,owner,updates};
}

test('all official platform views are embedded in the original host with independent secure persistent sessions',async()=>{
  const f=fixture();try{
    for(const provider of ['qq','kugou','qishui','spotify']){
      const result=await f.open({provider,method:'wechat'});
      assert.equal(result.apiConnected,false);assert.equal(result.embedded,true);assert.equal(f.owner.children.length,1);
      const view=f.views.at(-1);assert.equal(view.options.webPreferences.nodeIntegration,false);assert.equal(view.options.webPreferences.contextIsolation,true);assert.equal(view.options.webPreferences.sandbox,true);assert.equal(view.options.webPreferences.preload,undefined);
      assert.equal(view.options.webPreferences.session.partition,'persist:agent-pulse-'+provider+'-official');
    }
    const before=f.views.length;await f.open({provider:'spotify'});assert.equal(f.views.length,before);assert(f.views.at(-1).focused);
    assert.equal(f.partitions.size,4);assert.deepEqual(QQ_METHODS,['qq','wechat','qqmusic']);
  }finally{await f.api.dispose();assert(f.views.every(view=>view.destroyed));assert.equal(f.owner.children.length,0);assert.equal(f.owner.listenerCount('resize'),0);}
});
test('owned cookies are not exposed and logout affects only the selected Agent Pulse partition',async()=>{
  const f=fixture();try{
    await f.open({provider:'qq'});await f.open({provider:'spotify'});
    const qq=f.partitions.get('persist:agent-pulse-qq-official'),spotify=f.partitions.get('persist:agent-pulse-spotify-official');
    qq.values=[{name:'uin',value:'o12345678',domain:'.qq.com'},{name:'qqmusic_key',value:'synthetic-private-ticket',domain:'.qq.com'}];spotify.values=[{name:'session',value:'synthetic-spotify-cookie',domain:'.spotify.com'}];
    const value=await f.api.status({provider:'qq'});assert.equal(value.sessionSaved,true);assert.equal(value.playbackTicketAvailable,true);assert.equal(value.apiConnected,false);assert(!JSON.stringify(value).includes('synthetic'));assert(!JSON.stringify(value).includes('12345678'));
    await f.api.logout({provider:'qq'});assert.equal(qq.cleared,1);assert.equal(spotify.cleared,0);assert.equal((await f.api.status({provider:'qq'})).sessionSaved,false);
  }finally{await f.api.dispose();assert([...f.partitions.values()].every(value=>value.cookies.listenerCount('changed')===0));}
});
test('trusted OAuth children remain embedded and closing restores the parent with bounded coordinates',async()=>{
  const f=fixture();try{
    await assert.rejects(f.open({provider:'untrusted'}));assert.equal(f.partitions.size,0);
    await assert.rejects(f.api.open({provider:'qq',bounds:{x:0,y:0,width:Infinity,height:400}}));
    await f.open({provider:'qq'});const view=f.views[0];
    const handler=view.popup({url:'https://graph.qq.com/oauth2.0/authorize'});assert.equal(handler.action,'allow');
    const child=handler.createWindow({webPreferences:{nodeIntegration:true,preload:'bad.js'}});assert.equal(f.owner.children.length,2);assert.equal(f.views[1].options.webPreferences.nodeIntegration,false);assert.equal(f.views[1].options.webPreferences.preload,undefined);
    child.close();assert.equal(f.owner.children.length,1);
    f.api.setBounds({provider:'qq',bounds:{x:-10,y:20,width:5000,height:5000}});assert.deepEqual(view.bounds,{x:0,y:20,width:1200,height:780});
    assert.equal(view.popup({url:'https://attacker.invalid/'}).action,'deny');
    let prevented=false;view.webContents.emit('will-navigate',{preventDefault(){prevented=true;}},'file:///private');assert(prevented);
    view.webContents.emit('before-input-event',{preventDefault(){}},{type:'keyDown',key:'Escape'});assert(view.destroyed);assert.equal(f.owner.children.length,0);
    assert(trustedURL('spotify','https://accounts.spotify.com/login'));
    await assert.rejects(f.open({provider:'removed-platform'}),/不支持/);
    for(const value of ['http://y.qq.com/','https://qq.com.evil.invalid/','https://user:pass@y.qq.com/','https://y.qq.com:3333/'])assert(!trustedURL('qq',value),value);
  }finally{await f.api.dispose();}
});
test('QQ official leaf tab controls receive clicks and missing cross-origin controls do not report a successful switch',()=>{
  const dom=new JSDOM('<button>登录</button><div><span>微信登录</span></div>',{runScripts:'outside-only'}),window=dom.window;
  try{
    for(const node of window.document.querySelectorAll('*'))node.getBoundingClientRect=()=>({width:100,height:30});
    let selected=0;window.document.querySelector('span').addEventListener('click',()=>selected++);
    const present=window.eval(loginScript('qq','wechat'));assert.equal(present.methodApplied,true);assert.equal(selected,1);
    const missing=window.eval(loginScript('qq','qqmusic'));assert.equal(missing.methodApplied,false);assert.equal(selected,1);
    assert.doesNotMatch(loginScript('spotify','qq'),/cookie|localStorage|sessionStorage|token/i);
  }finally{window.close();}
});

test('Spotify identity redirects stay in bounded sandboxed views and closing OAuth restores its parent',async()=>{
  const f=fixture();try{
    await f.open({provider:'spotify'});
    const root=f.views[0];
    const blank=root.popup({url:'about:blank'});
    assert.equal(blank.action,'allow');assert.equal(blank.outlivesOpener,true);
    const child=blank.createWindow({webPreferences:{nodeIntegration:true,nodeIntegrationInWorker:true,nodeIntegrationInSubFrames:true,webviewTag:true,preload:'unsafe.js'}});
    const view=f.views[1];
    for(const key of ['nodeIntegration','nodeIntegrationInWorker','nodeIntegrationInSubFrames','webviewTag'])assert.equal(view.options.webPreferences[key],false);
    for(const url of ['https://accounts.google.com/o/oauth2/v2/auth','https://www.facebook.com/v21.0/dialog/oauth','https://appleid.apple.com/auth/authorize']){
      let prevented=false;child.emit('will-navigate',{preventDefault(){prevented=true;}},url);assert.equal(prevented,false,url);
    }
    assert.equal(root.popup({url:'https://www.facebook.com/v21.0/dialog/oauth'}).action,'allow');
    assert.equal(root.popup({url:'https://appleid.apple.com/auth/authorize'}).action,'allow');
    assert.equal(root.popup({url:'https://accounts.google.com.attacker.test/'}).action,'deny');
    child.close();assert.equal(f.owner.children.length,1);assert(root.focused);
    assert.equal((await f.api.status({provider:'spotify'})).windowOpen,true);
    assert.match((await f.api.status({provider:'spotify'})).message,/Google/);
    const session=f.partitions.get('persist:agent-pulse-spotify-official');
    session.values=[{name:'SID',value:'identity-private',domain:'.google.com'}];
    const status=await f.api.status({provider:'spotify'});assert.equal(status.sessionSaved,false);assert(!JSON.stringify(status).includes('identity-private'));
    assert(!trustedURL('qq','https://accounts.google.com/'));
  }finally{await f.api.dispose();}
});

test('an unexpected Spotify page close restores its entry once without closing the account host',async()=>{
  const f=fixture();try{
    await f.open({provider:'spotify'});
    f.views[0].webContents.close();
    assert.equal(f.views.length,2);assert.equal(f.owner.children.length,1);
    assert.equal(f.views[1].url,'https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F');
    assert.equal((await f.api.status({provider:'spotify'})).windowOpen,true);
    f.api.close({provider:'spotify'});assert.equal(f.owner.children.length,0);assert.equal(f.views.length,2);
  }finally{await f.api.dispose();}
});

test('no login-control script runs on third-party identity pages',async()=>{
  let calls=0;
  const frame={url:'https://accounts.google.com/signin',isDestroyed:()=>false,executeJavaScript:async()=>{calls++;return{};}};frame.framesInSubtree=[frame];
  const value=await activateLogin({mainFrame:frame},'spotify','qq');
  assert.equal(calls,0);assert.equal(value.loginOpened,false);
});

test('Spotify OAuth replacing the initial navigation does not close its embedded login host',async()=>{
  const f=fixture({loadURL:async view=>{
    view.url='https://accounts.google.com/signin/oauth';
    throw Object.assign(new Error('ERR_ABORTED'),{errno:-3});
  }});
  try{
    const result=await f.open({provider:'spotify'});
    assert.equal(result.windowOpen,true);
    assert.equal(f.owner.children.length,1);
    assert.equal(f.views[0].destroyed,false);
    assert.doesNotMatch(result.message,/网络/);
  }finally{await f.api.dispose();}
});

test('Spotify load failure preserves the account host and identifies the actual connection error',async()=>{
  const f=fixture({loadURL:async()=>{
    throw Object.assign(new Error('ERR_PROXY_CONNECTION_FAILED https://accounts.spotify.com/?private=query'),{code:'ERR_PROXY_CONNECTION_FAILED'});
  }});
  try{
    const result=await f.open({provider:'spotify'});
    assert.equal(result.windowOpen,true);
    assert.equal(f.views[0].destroyed,false);
    assert.match(result.message,/代理连接失败.*ERR_PROXY_CONNECTION_FAILED/);
    assert.doesNotMatch(result.message,/private|accounts\.spotify/);
    const root=f.views[0];
    root.webContents.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://accounts.spotify.com/',true);
    assert.match((await f.api.status({provider:'spotify'})).message,/域名解析失败/);
    root.webContents.emit('did-fail-load',{},-3,'ERR_ABORTED','https://accounts.spotify.com/',true);
    assert.match((await f.api.status({provider:'spotify'})).message,/域名解析失败/);
  }finally{await f.api.dispose();}
});
test('verified Spotify website account closes the login view without claiming application API access',async()=>{
  let fetched=0;
  const f=fixture({fetchProfile:async()=>{fetched++;return Response.json({username:'owned-web-user',displayName:'Spotify Listener',imageUrl:'https://i.scdn.co/image/avatar'});}});
  try{
    await f.api.status({provider:'spotify'});
    const partition=f.partitions.get('persist:agent-pulse-spotify-official');
    partition.values=[{name:'sp_dc',value:'owned-private-cookie',domain:'.spotify.com'}];
    const result=await f.open({provider:'spotify'});
    assert.equal(result.webAuthenticated,true);assert.equal(result.webProfile.nickname,'Spotify Listener');
    assert.equal(result.apiConnected,false);assert.equal(result.profile,null);
    assert.equal(result.windowOpen,false);assert.equal(f.owner.children.length,0);
    assert.doesNotMatch(JSON.stringify(result),/owned-private-cookie/);
    await f.api.status({provider:'spotify'});assert.equal(fetched,1);
    await f.api.logout({provider:'spotify'});
    assert.equal((await f.api.status({provider:'spotify'})).webAuthenticated,false);
  }finally{await f.api.dispose();}
});

const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const publicSpotifyProfile={userId:'owned-web-user',nickname:'Hydrated listener',avatarURL:'https://i.scdn.co/image/avatar'};
async function savedSpotifySession(f){
  await f.api.status({provider:'spotify'});
  const partition=f.partitions.get('persist:agent-pulse-spotify-official');
  partition.values=[{name:'sp_t',value:'synthetic-browser-session',domain:'.spotify.com'}];
  return partition;
}

test('Spotify retries the hydrated public account widget and closes the official view without requiring sp_dc',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  let ready=false,fetched=0;
  const f=fixture({loadURL:view=>{view.url='https://open.spotify.com/';},fetchProfile:async()=>{fetched++;return Response.json({error:'unavailable'},{status:400});},executeJavaScript:(_view,script)=>script.includes('const widget=')?(ready?publicSpotifyProfile:null):{methodApplied:false}});
  try{
    await savedSpotifySession(f);
    assert.equal((await f.open({provider:'spotify'})).webAuthenticated,false);
    assert.equal(fetched,1);
    t.mock.timers.tick(749);await settle();assert.equal(fetched,1);
    ready=true;t.mock.timers.tick(1);await settle();
    assert.equal(f.owner.children.length,0);assert.equal(fetched,1);
    t.mock.timers.tick(180);await settle();
    const result=f.updates.at(-1);
    assert.equal(result.webAuthenticated,true);assert.equal(result.webProfile.nickname,'Hydrated listener');
    assert.equal(result.apiConnected,false);assert.equal(result.profile,null);assert.equal(result.windowOpen,false);
    t.mock.timers.tick(10000);await settle();assert.equal(fetched,1);
    assert.doesNotMatch(JSON.stringify(result),/synthetic-browser-session/);
  }finally{await f.api.dispose();t.mock.timers.reset();}
});

test('Spotify SPA navigation receives only three delayed checks for an open login attempt',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  let fetched=0;
  const f=fixture({fetchProfile:async()=>{fetched++;return Response.json({error:'unavailable'},{status:400});},executeJavaScript:()=>null});
  try{
    await savedSpotifySession(f);await f.open({provider:'spotify'});
    const web=f.views[0].webContents;f.views[0].url='https://open.spotify.com/';
    web.emit('did-navigate-in-page',{},f.views[0].url,true);
    for(const delay of [750,1250,3000]){t.mock.timers.tick(delay);await settle();}
    assert.equal(fetched,4);assert.equal((await f.api.status({provider:'spotify'})).webAuthenticated,false);
    t.mock.timers.tick(180);await settle();
    for(let i=0;i<3;i++){web.emit('did-navigate-in-page',{},f.views[0].url,true);t.mock.timers.tick(180);await settle();}
    t.mock.timers.tick(60000);await settle();assert.equal(fetched,4);
    assert.equal(f.owner.children.length,1);
  }finally{await f.api.dispose();t.mock.timers.reset();}
});

for(const action of ['close','logout','dispose'])test('Spotify delayed verification stops on '+action,async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  let fetched=0;
  const f=fixture({loadURL:view=>{view.url='https://open.spotify.com/';},fetchProfile:async()=>{fetched++;return Response.json({error:'unavailable'},{status:400});},executeJavaScript:()=>null});
  try{
    await savedSpotifySession(f);await f.open({provider:'spotify'});assert.equal(fetched,1);
    await f.api[action]({provider:'spotify'});
    t.mock.timers.tick(10000);await settle();assert.equal(fetched,1);assert.equal(f.owner.children.length,0);
  }finally{await f.api.dispose();t.mock.timers.reset();}
});

test('a Spotify credential change invalidates a pending profile result and its status event',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  let resolveProfile;const pending=new Promise(resolve=>{resolveProfile=resolve;});
  const f=fixture({fetchProfile:()=>pending});
  try{
    const partition=await savedSpotifySession(f);
    partition.values=[{name:'sp_dc',value:'synthetic-old-session',domain:'.spotify.com'}];
    const opening=f.open({provider:'spotify'});await settle();
    t.mock.timers.tick(180);await settle();
    partition.values=[];partition.cookies.emit('changed',{}, {name:'sp_dc',domain:'.spotify.com'},'explicit',true);
    resolveProfile(Response.json({username:'stale-user',displayName:'Stale account'}));
    await opening;await settle();t.mock.timers.tick(180);await settle();
    const result=await f.api.status({provider:'spotify'});
    assert.equal(result.webAuthenticated,false);assert.equal(result.webProfile,null);assert.equal(f.owner.children.length,1);
    assert(!f.updates.some(value=>value.webAuthenticated||value.webProfile));
  }finally{await f.api.dispose();t.mock.timers.reset();}
});

test('a closed Spotify attempt cannot emit a stale closed state over the newly opened view',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
  let resolveOld,fetched=0;const oldProfile=new Promise(resolve=>{resolveOld=resolve;});
  const f=fixture({fetchProfile:()=>++fetched===1?oldProfile:Promise.resolve(Response.json({error:'unavailable'},{status:400}))});
  try{
    const partition=await savedSpotifySession(f);
    partition.values=[{name:'sp_dc',value:'synthetic-session',domain:'.spotify.com'}];
    const oldOpening=f.open({provider:'spotify'});await settle();
    t.mock.timers.tick(180);await settle();
    f.api.close({provider:'spotify'});await f.open({provider:'spotify'});
    t.mock.timers.tick(180);await settle();
    assert.equal(f.updates.at(-1).windowOpen,true);
    const updates=f.updates.length;
    resolveOld(Response.json({username:'stale-user'}));await oldOpening;await settle();
    assert.equal(f.updates.length,updates);assert.equal(f.views.at(-1).destroyed,false);
    const result=await f.api.status({provider:'spotify'});
    assert.equal(result.windowOpen,true);assert.equal(result.webAuthenticated,false);
  }finally{await f.api.dispose();t.mock.timers.reset();}
});
