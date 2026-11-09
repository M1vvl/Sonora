'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create,PLATFORMS,safeImage}=require('../ui/music/index.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve)),settle=async()=>{for(let index=0;index<5;index++)await tick();};
const png='data:image/png;base64,iVBORw0KGgo=';
function fixture(overrides={}){
  const dom=new JSDOM('<main><section id="music"></section><button id="outside">Outside</button></main>',{url:'https://local.test/',pretendToBeVisual:true}),view=dom.window,root=view.document.getElementById('music'),calls=[],timers=new Map(),frames=new Map(),observers=[];let id=0,time=100000,subscriber=null,unsubscribed=false;
  Object.defineProperty(view.HTMLMediaElement.prototype,'paused',{configurable:true,get(){return this.__paused!==false;}});view.HTMLMediaElement.prototype.pause=function(){this.__paused=true;this.dispatchEvent(new view.Event('pause'));};view.HTMLMediaElement.prototype.load=function(){};view.HTMLMediaElement.prototype.play=function(){this.__paused=false;this.dispatchEvent(new view.Event('playing'));return Promise.resolve();};
  view.HTMLDialogElement.prototype.showModal=function(){this.open=true;};view.HTMLDialogElement.prototype.close=function(){this.open=false;};
  view.setTimeout=(callback,delay)=>{const value=++id;timers.set(value,{callback,at:time+delay,delay});return value;};view.clearTimeout=value=>timers.delete(value);
  view.requestAnimationFrame=callback=>{const value=++id;frames.set(value,callback);return value;};view.cancelAnimationFrame=value=>frames.delete(value);
  view.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  if(overrides.hostPulse)view.pulse=overrides.hostPulse;
  const api=async(action,payload={})=>{calls.push({action,payload});if(overrides[action])return overrides[action](payload);if(action==='bootstrap')return {profile:null,state:'signedOut'};if(action==='beginQR')return {requestId:'qr-request',qrImage:png,expiresAt:time+180000,status:'waiting'};if(action==='checkQR')return {status:'waiting'};return {};};
  const ui=create({root,api,now:()=>time,subscribe:listener=>{subscriber=listener;return()=>{unsubscribed=true;subscriber=null;};}});
  root.querySelector('.music-embedded-frame').getBoundingClientRect=()=>({left:100,top:100,width:700,height:500});
  const graph=root.querySelector('.music-connection-graph');graph.getBoundingClientRect=()=>({left:10,top:20,width:700,height:360});
  PLATFORMS.forEach((item,index)=>{root.querySelector(`[data-music-row="${item.id}"] .music-platform-port`).getBoundingClientRect=()=>({left:260,top:40+index*60,width:15,height:15});});
  root.querySelector('.music-account-port').getBoundingClientRect=()=>({left:480,top:170,width:15,height:15});
  async function advance(amount){time+=amount;const due=[...timers].filter(([,value])=>value.at<=time);for(const [key,value]of due){if(!timers.has(key))continue;timers.delete(key);value.callback();}await settle();}
  function paint(){for(const[key,callback]of [...frames]){frames.delete(key);callback();}}
  return {dom,view,root,ui,calls,timers,frames,observers,advance,paint,emit:value=>subscriber?.(value),unsubscribed:()=>unsubscribed,time:()=>time,close(){ui.dispose();dom.window.close();}};
}
test('music construction is inert and direct QR entry preserves the selected theme',async()=>{
  const f=fixture();try{
    f.view.document.documentElement.dataset.interfaceTheme='electric-purple';assert.equal(f.calls.length,0);assert(f.root.querySelector('.music-login-sheet').hidden);await f.ui.activate();
    assert(f.calls.some(call=>call.action==='bootstrap'));assert.equal(f.root.querySelector('.music-pill-name').textContent,'登录音乐');f.root.querySelector('.music-account-pill').click();f.paint();
    assert.equal(f.root.querySelectorAll('[data-music-platform]').length,PLATFORMS.length);assert(!f.root.querySelector('.music-login-sheet').hidden);assert.equal(f.root.querySelectorAll('[role="tab"][aria-selected="true"]').length,1);
    f.root.querySelector('[data-music-platform="qq"]').click();assert(!f.root.querySelector('.music-login-methods').hidden);assert(!f.root.querySelector('.music-unavailable').hidden);assert.equal(f.calls.filter(value=>value.action==='beginQR').length,0);
    assert.equal(f.view.document.documentElement.dataset.interfaceTheme,'electric-purple');assert(f.root.querySelector('.music-method[disabled]').textContent.includes('Cookie'));
  }finally{f.close();}
});

test('island control acknowledgement waits for the requested track and reports a failed stream as failure',async()=>{
  let control,finish;const acknowledgements=[],songs=[{id:'one',title:'One'},{id:'two',title:'Two'}];
  const f=fixture({hostPulse:{onMusicControl(fn){control=fn;return()=>{};},completeMusicControl(id,result){acknowledgements.push({id,...result});}},home:async()=>({songs}),play:async({id})=>id==='one'?{audioURL:'pulse-music-audio://stream/one'}:new Promise(resolve=>finish=resolve)});
  try{
    await f.ui.activate();f.root.querySelector('[data-music-song="one"]').click();await settle();
    const pending=control({id:'next-1',songId:'one',action:'next'});await settle();assert.equal(acknowledgements.length,0);
    finish({error:'目标歌曲暂无权限'});await pending;assert.equal(acknowledgements[0].ok,false);assert.match(acknowledgements[0].error,/暂无权限/);
  }finally{f.close();}
});

test('a remote track request superseded by a later local selection cannot acknowledge success',async()=>{
  let control,finish;const acknowledgements=[],songs=[{id:'one',title:'One'},{id:'two',title:'Two'}];
  const f=fixture({hostPulse:{onMusicControl(fn){control=fn;return()=>{};},completeMusicControl(id,result){acknowledgements.push({id,...result});}},home:async()=>({songs}),play:async({id})=>id==='one'?{audioURL:'pulse-music-audio://stream/one'}:new Promise(resolve=>finish=resolve)});
  try{
    await f.ui.activate();f.root.querySelector('[data-music-song="one"]').click();await settle();
    const pending=control({id:'next-2',songId:'one',action:'next'});await settle();
    f.root.querySelector('[data-music-song="one"]').click();await settle();finish({audioURL:'pulse-music-audio://stream/two'});await pending;
    assert.equal(acknowledgements[0].ok,false);assert.match(acknowledgements[0].error,/更新|切换/);assert.equal(f.ui.getState().player.songId,'one');
    const audio=f.root.querySelector('audio');audio.pause();audio.play=()=>Promise.reject(new Error('播放被设备拒绝'));
    await control({id:'toggle-fail',songId:'one',action:'toggle'});assert.equal(acknowledgements.at(-1).ok,false);assert.match(acknowledgements.at(-1).error,/设备拒绝/);
  }finally{f.close();}
});
test('SVG connection measures the selected ports and responds to keyboard selection and resize',async()=>{
  const f=fixture();try{
    await f.ui.activate();f.ui.open();f.paint();const path=f.root.querySelector('.music-connection-line'),first=path.getAttribute('d');assert.match(first,/^M 257\.50 27\.50 C/);
    const initial=f.root.querySelector('[data-music-platform="netease"]');initial.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));f.paint();assert.equal(f.ui.getState().selected,'qq');assert.notEqual(path.getAttribute('d'),first);assert.equal(f.view.document.activeElement.dataset.musicPlatform,'qq');
    f.root.querySelector('.music-account-port').getBoundingClientRect=()=>({left:570,top:200,width:15,height:15});f.observers[0].callback();f.paint();assert.match(path.getAttribute('d'),/567\.50 187\.50$/);assert.equal(f.frames.size,0);
    f.ui.deactivate();f.observers[0].callback();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
  }finally{f.close();}
});
test('QR login polls one request at a time and updates the account only after confirmation',async()=>{
  let answer='waiting';const profile={nickname:'<img src=x>',avatarURL:'https://images.example/avatar.png',vip:true};
  const f=fixture({checkQR:async()=>answer==='confirmed'?{status:answer,profile}:{status:answer}});try{
    await f.ui.activate();f.ui.open();f.root.querySelector('[data-music-action="qr"]').click();await settle();assert.equal(f.root.querySelector('.music-qr-image img').src,png);assert(f.ui.getState().pendingTimer);assert(!f.ui.getState().authenticated);
    await f.advance(2000);assert.equal(f.calls.filter(value=>value.action==='checkQR').length,1);answer='scanned';await f.advance(2000);assert.match(f.root.querySelector('.music-qr-status').textContent,/手机上确认/);
    answer='confirmed';await f.advance(2000);assert(f.ui.getState().authenticated);assert.equal(f.root.querySelector('.music-pill-name').textContent,profile.nickname);assert.equal(f.root.querySelector('[src=x]'),null);assert(!f.root.querySelector('.music-account-pill>.music-vip').hidden);assert(!f.ui.getState().pendingTimer);
    assert(f.root.querySelector('.music-pill-avatar svg').hasAttribute('hidden'));const avatar=f.root.querySelector('.music-pill-avatar img');avatar.dispatchEvent(new f.view.Event('error'));assert(avatar.hidden);assert(!f.root.querySelector('.music-pill-avatar svg').hasAttribute('hidden'));
    const count=f.calls.length;await f.advance(60000);assert.equal(f.calls.length,count);
  }finally{f.close();}
});
test('slow QR checks cannot overlap and closing prevents late results from restoring the account',async()=>{
  let finish;const f=fixture({checkQR:()=>new Promise(resolve=>{finish=resolve;})});try{
    await f.ui.activate();f.ui.open();f.root.querySelector('[data-music-action="qr"]').click();await settle();await f.advance(2000);assert(f.ui.getState().polling);
    await f.advance(10000);assert.equal(f.calls.filter(value=>value.action==='checkQR').length,1);f.ui.close();finish({status:'confirmed',profile:{nickname:'late'}});await settle();
    assert(!f.ui.getState().authenticated);assert(!f.ui.getState().panelOpen);assert.equal(f.root.querySelector('.music-qr-image img').getAttribute('src'),null);assert(f.calls.some(value=>value.action==='cancelQR'));assert.equal(f.ui.getState().pendingTimer,false);
  }finally{f.close();}
});
test('expiry stops polling, clears the QR and allows a bounded refresh',async()=>{
  const f=fixture({beginQR:async()=>({requestId:'short-lived',qrImage:png,expiresAt:f.time()+2500})});try{
    await f.ui.activate();f.ui.open();f.root.querySelector('[data-music-action="qr"]').click();await settle();await f.advance(2000);await f.advance(500);
    assert.equal(f.ui.getState().qrStatus,'expired');assert(!f.ui.getState().pendingTimer);assert(!f.root.querySelector('.music-refresh-qr').hidden);assert(f.root.querySelector('.music-qr-image img').hidden);
    const before=f.calls.filter(value=>value.action==='checkQR').length;await f.advance(60000);assert.equal(f.calls.filter(value=>value.action==='checkQR').length,before);
    f.root.querySelector('.music-refresh-qr').click();await settle();assert.equal(f.ui.getState().qrStatus,'waiting');
  }finally{f.close();}
});
test('deactivate cancels a pending QR generation and disposal releases timers, observers and subscription',async()=>{
  let finish;const f=fixture({beginQR:()=>new Promise(resolve=>{finish=resolve;})});
  await f.ui.activate();f.ui.open();f.root.querySelector('[data-music-action="qr"]').click();f.ui.deactivate();finish({requestId:'late',qrImage:png,expiresAt:f.time()+180000});await settle();
  assert.equal(f.ui.getState().qrStatus,'idle');assert(!f.ui.getState().pendingTimer);assert(f.calls.some(value=>value.action==='cancelQR'));
  f.ui.dispose();assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);assert(f.observers[0].disconnected);assert(f.unsubscribed());assert.equal(f.root.children.length,0);f.dom.window.close();
});
test('authenticated bootstrap, signed-out notifications and logout use sanitized display state',async()=>{
  const f=fixture({bootstrap:async()=>({profile:{nickname:'测试账号',avatarURL:'javascript:alert(1)',vip:false},state:'signedIn'})});try{
    await f.ui.activate();assert(f.ui.getState().authenticated);assert(f.root.querySelector('.music-pill-avatar img').hidden);assert(f.root.querySelector('.music-vip').hidden);f.ui.open();assert(f.root.querySelector('.music-login-methods').hidden);
    f.root.querySelector('[data-music-action="logout"]').click();await settle();assert(f.calls.some(value=>value.action==='logout'));assert(!f.ui.getState().authenticated);
    f.emit({profile:{nickname:'新账号',vip:true}});assert.equal(f.root.querySelector('.music-pill-name').textContent,'新账号');f.emit({state:'signedOut',profile:null});assert.equal(f.root.querySelector('.music-pill-name').textContent,'登录音乐');
    assert.equal(safeImage('https://user:pass@example.com/a.png'),'');assert.equal(safeImage('file:///private.png'),'');
  }finally{f.close();}
});

test('music home uses real API data, searches beyond recommendations and retains an honest empty history',async()=>{
  const song={id:'song-1',title:'真实推荐',artist:'歌手',duration:187,coverURL:'https://image.example/a.jpg'};
  const f=fixture({home:async()=>({songs:[song],cards:[song],playlists:[{id:'list-1',title:'真实歌单'}],recent:[],recommendationMode:'public'}),search:async({query})=>({songs:[{id:'outside-home',title:query,artist:'搜索歌手'}],playlists:[]})});try{
    await f.ui.activate();assert.equal(f.root.querySelectorAll('.music-section').length,2);assert.equal(f.root.querySelectorAll('audio').length,1);assert.equal(f.root.querySelectorAll('.music-song-list [data-music-song]').length,1);assert.equal(f.root.querySelector('.music-recent-list'),null);assert.equal(f.root.querySelector('.music-recommendation-mode').textContent,'公开每日推荐');
    f.root.querySelector('.music-search input').value='不在首页的歌曲';f.root.querySelector('.music-search').dispatchEvent(new f.view.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(f.root.querySelector('.music-song-list [data-music-song]').dataset.musicSong,'outside-home');assert(f.calls.some(value=>value.action==='search'&&value.payload.query==='不在首页的歌曲'));
  }finally{f.close();}
});

test('foreign recommendations render their own labels, preview covers and direct-play queues',async()=>{
  const daily={id:'qq:daily',source:'qq',title:'热歌',coverURL:'https://qpic.y.qq.com/music_cover/daily'},fresh={id:'qq:fresh',source:'qq',title:'新歌',coverURL:'https://y.gtimg.cn/fresh.jpg'};
  const f=fixture({
    home:async()=>({songs:[daily],cards:[daily],playlists:[{id:'qq:list',title:'QQ歌单'}],recommendationMode:'public',discoveryModes:['daily','radar'],discoveryLabels:{daily:'热歌精选',radar:'新歌首发'}}),
    discovery:async({mode})=>({songs:[mode==='radar'?fresh:daily],label:mode==='radar'?'新歌首发':'热歌精选'}),
    play:async({id})=>({audioURL:'pulse-music-audio://stream/'+id}),
  });
  try{
    await f.ui.activate();await settle();
    const radar=f.root.querySelector('[data-music-discovery="radar"]');
    assert.match(radar.querySelector('strong').textContent,/新歌首发/);
    assert.equal(radar.querySelector('small').textContent,'新歌');
    assert(!radar.hidden);assert(f.root.querySelector('[data-music-discovery="fm"]').hidden);
    radar.click();await settle();
    assert(f.calls.some(value=>value.action==='play'&&value.payload.id==='qq:fresh'));
    assert.equal(f.root.querySelector('.music-songs-heading').textContent,'新歌首发');
  }finally{f.close();}
});
test('overlapping QQ discovery charts use distinct real album covers without changing their playback order',async()=>{
  const qqSong=(id,cover)=>({id:'qq:'+id,source:'qq',title:id,coverURL:'https://y.gtimg.cn/'+cover+'.jpg'});
  const hot=qqSong('Hot','hot'),shared=qqSong('Shared','shared'),sameAlbum=qqSong('Same album','shared'),alternate=qqSong('Trend only','trend');
  const f=fixture({
    home:async()=>({songs:[hot],cards:[hot],recommendationMode:'public',discoveryModes:['daily','radar','fm'],discoveryLabels:{daily:'热歌精选',radar:'新歌首发',fm:'流行指数'}}),
    discovery:async({mode})=>({songs:mode==='radar'?[shared]:mode==='fm'?[shared,sameAlbum,alternate]:[hot]}),
    play:async({id})=>({audioURL:'pulse-music-audio://stream/'+id}),
  });
  try{
    await f.ui.activate();await settle();
    const radar=f.root.querySelector('[data-music-discovery="radar"]'),trend=f.root.querySelector('[data-music-discovery="fm"]');
    assert.match(radar.querySelector('.music-mode-art').dataset.coverUrl,/shared\.jpg$/);
    assert.match(trend.querySelector('.music-mode-art').dataset.coverUrl,/trend\.jpg$/);
    assert.equal(trend.querySelector('small').textContent,'Trend only');
    trend.click();await settle();
    assert(f.calls.some(value=>value.action==='play'&&value.payload.id===shared.id));
    assert.equal(f.root.querySelector('.music-song-row').dataset.musicSong,shared.id);
  }finally{f.close();}
});

test('a failed foreign stream keeps its own duration and offers quality retry',async()=>{
  const song={id:'qq:retry',source:'qq',title:'Retry',duration:262};
  const qualities=[{id:'hi_res',label:'Hi-Res',short:'Hi-Res'},{id:'standard',label:'标准',short:'标准'}];
  const f=fixture({home:async()=>({songs:[song]}),play:async({quality})=>quality==='standard'?{song,audioURL:'pulse-music-audio://stream/retry',quality:'standard',qualityOptions:qualities}:{error:'授权音源暂时不可用'},playbackOptions:async()=>({qualityOptions:qualities})});
  try{
    await f.ui.activate();
    const audio=f.root.querySelector('audio');
    Object.defineProperty(audio,'duration',{configurable:true,get:()=>166});
    f.root.querySelector('[data-music-song="qq:retry"]').click();await settle();
    assert.equal(f.root.querySelector('.music-duration').textContent,'4:22');
    assert.equal(f.root.querySelector('.music-quality-badge').disabled,false);
    f.root.querySelector('.music-quality-badge').click();
    assert(f.root.querySelector('[data-quality-choice="hi_res"]'));
    f.root.querySelector('[data-quality-choice="standard"]').click();await settle();
    assert.equal(f.ui.getState().player.phase,'playing');
    assert.equal(f.ui.getState().player.quality,'standard');
  }finally{f.close();}
});

test('account overlay is compact, restores focus and the account pill stays visible',async()=>{
  const f=fixture({preferences:async value=>value});try{
    await f.ui.activate();const pill=f.root.querySelector('.music-account-pill');pill.focus();pill.click();assert(f.root.querySelector('dialog.music-login-sheet').open);assert(!f.root.textContent.includes('MUSIC CONNECTIONS'));assert(!f.root.textContent.includes('连接你的音乐'));assert(f.root.querySelector('.music-body').inert);f.ui.close();assert.equal(f.view.document.activeElement,pill);assert(!f.root.querySelector('.music-body').inert);
    assert.equal(f.root.querySelector('.music-account-autohide'),null);assert.equal(f.root.querySelector('.music-account-peek'),null);f.view.document.getElementById('outside').focus();await f.advance(3000);assert.equal(pill.tabIndex,0);assert.equal(pill.getAttribute('aria-hidden'),null);assert(!f.calls.some(value=>value.action==='preferences'));
  }finally{f.close();}
});

test('single audio player uses only controlled URLs and writes recent history only after real playing',async()=>{
  const songs=[{id:'one',title:'第一首',artist:'甲',duration:200},{id:'two',title:'第二首',artist:'乙',duration:180}];
  const f=fixture({home:async()=>({songs,playlists:[],recent:[]}),play:async({id})=>({song:songs.find(song=>song.id===id),audioURL:'pulse-music-audio://stream/'+id}),like:async({liked})=>({liked}),comments:async()=>({comments:[{nickname:'听众',content:'真实评论'}]})});try{
    await f.ui.activate();assert(!f.calls.some(value=>value.action==='historyProgress'));const songRow=f.root.querySelector('[data-music-song="one"]');songRow.click();await settle();const audio=f.root.querySelector('audio');assert.equal(audio.getAttribute('src'),'pulse-music-audio://stream/one');assert.equal(f.ui.getState().player.phase,'playing');assert.equal(f.root.querySelectorAll('audio').length,1);assert(f.calls.some(value=>value.action==='historyProgress'&&value.payload.id==='one'));assert.equal(f.root.querySelector('.music-recent-list'),null);assert.equal(f.root.querySelector('.music-song-list [data-music-song="one"]'),songRow,'progress must not rebuild recommendation DOM');
    const count=f.calls.filter(value=>value.action==='historyProgress').length;audio.currentTime=5;audio.dispatchEvent(new f.view.Event('timeupdate'));await settle();assert.equal(f.calls.filter(value=>value.action==='historyProgress').length,count);await f.advance(10000);audio.currentTime=15;audio.dispatchEvent(new f.view.Event('timeupdate'));await settle();assert.equal(f.calls.filter(value=>value.action==='historyProgress').length,count+1);
    f.root.querySelector('[data-player-action="like"]').click();await settle();assert.equal(f.root.querySelector('.music-like').getAttribute('aria-pressed'),'true');f.root.querySelector('[data-player-action="comments"]').click();await settle();assert.match(f.root.querySelector('.music-comments-list').textContent,/真实评论/);
    f.ui.deactivate();assert(audio.getAttribute('src'));assert(!f.root.querySelector('.music-player-root').classList.contains('is-active'));assert(f.calls.some(value=>value.action==='deactivate'));
  }finally{f.close();}assert(f.calls.some(value=>value.action==='stopAudio'));
});

test('failed playback and late search cannot create fake playback or overwrite a deactivated workspace',async()=>{
  let finishSearch;const f=fixture({home:async()=>({songs:[{id:'locked',title:'不可播放',artist:'歌手'}]}),play:async()=>({audioURL:'https://not-controlled.example/a.mp3'}),search:()=>new Promise(resolve=>{finishSearch=resolve;})});try{
    await f.ui.activate();f.root.querySelector('[data-music-song="locked"]').click();await settle();assert.equal(f.ui.getState().player.phase,'paused');assert(!f.calls.some(value=>value.action==='historyProgress'));assert(!f.root.querySelector('audio').getAttribute('src'));
    f.root.querySelector('.music-search input').value='迟到结果';f.root.querySelector('.music-search').dispatchEvent(new f.view.Event('submit',{bubbles:true,cancelable:true}));f.ui.deactivate();finishSearch({songs:[{id:'late',title:'不该出现'}]});await settle();assert(!f.root.querySelector('[data-music-song="late"]'));
  }finally{f.close();}
});

test('a queued song resumes the saved position after metadata and a new song closes old comments',async()=>{
  const recent={id:'one',title:'继续听',artist:'甲',duration:200,position:63.5},second={id:'two',title:'新歌曲',artist:'乙',duration:180};
  const f=fixture({home:async()=>({songs:[recent,second],recent:[recent]}),play:async({id})=>({audioURL:'pulse-music-audio://stream/'+id}),comments:async()=>({comments:[]})});try{
    await f.ui.activate();const audio=f.root.querySelector('audio');Object.defineProperty(audio,'duration',{configurable:true,get:()=>200});
    f.root.querySelector('.music-song-list [data-music-song="one"]').click();await settle();audio.dispatchEvent(new f.view.Event('loadedmetadata'));assert.equal(audio.currentTime,63.5);
    f.root.querySelector('[data-player-action="comments"]').click();await settle();assert(f.root.querySelector('.music-comments-dialog').open);
    f.root.querySelector('.music-song-list [data-music-song="two"]').click();await settle();audio.dispatchEvent(new f.view.Event('loadedmetadata'));assert.equal(audio.currentTime,0);assert(!f.root.querySelector('.music-comments-dialog').open);assert.equal(f.ui.getState().player.songId,'two');
  }finally{f.close();}
});

test('fallback recommendations are labelled accurately and unconfirmed likes do not become selected',async()=>{
  const song={id:'one',title:'公开新歌',artist:'甲'};
  const f=fixture({home:async()=>({songs:[song],recommendationMode:'public',recommendationLabel:'公开新歌推荐'}),play:async()=>({audioURL:'pulse-music-audio://stream/one'}),like:async()=>({ok:true})});try{
    await f.ui.activate();assert.equal(f.root.querySelector('.music-recommendation-mode').textContent,'公开新歌推荐');f.root.querySelector('[data-music-song="one"]').click();await settle();f.root.querySelector('[data-player-action="like"]').click();await settle();assert.equal(f.root.querySelector('.music-like').getAttribute('aria-pressed'),'false');assert.match(f.root.querySelector('.music-feedback').textContent,/未能确认收藏状态/);
  }finally{f.close();}
});

test('late comment failures cannot replace comments after the panel is reopened',async()=>{
  let failOld,count=0;const song={id:'one',title:'歌曲',artist:'甲'};
  const f=fixture({home:async()=>({songs:[song]}),play:async()=>({audioURL:'pulse-music-audio://stream/one'}),comments:()=>++count===1?new Promise((_resolve,reject)=>{failOld=reject;}):Promise.resolve({comments:[{nickname:'新听众',content:'新的评论'}]})});try{
    await f.ui.activate();f.root.querySelector('[data-music-song="one"]').click();await settle();f.root.querySelector('[data-player-action="comments"]').click();await settle();f.root.querySelector('[data-player-action="close-comments"]').click();f.root.querySelector('[data-player-action="comments"]').click();await settle();failOld(new Error('过时的错误'));await settle();assert.match(f.root.querySelector('.music-comments-list').textContent,/新的评论/);assert(!f.root.querySelector('.music-comments-list').textContent.includes('过时的错误'));
  }finally{f.close();}
});


test('music mute is local, reversible and preserves the selected volume',async()=>{
  const f=fixture();try{
    await f.ui.activate();const audio=f.root.querySelector('audio'),slider=f.root.querySelector('.music-volume'),button=f.root.querySelector('[data-player-action="mute"]');
    slider.value='.43';slider.dispatchEvent(new f.view.Event('input'));assert.equal(audio.volume,.43);
    button.click();assert.equal(audio.muted,true);assert.equal(audio.volume,.43);assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(button.getAttribute('aria-label'),'取消静音');
    button.click();assert.equal(audio.muted,false);assert.equal(audio.volume,.43);assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(f.root.querySelector('.music-playback-status'),null);
  }finally{f.close();}
});

test('generic playback errors float briefly without inserting a banner and navigation clears feedback',async()=>{
  const song={id:'locked',title:'权限歌曲',artist:'甲'},f=fixture({home:async()=>({songs:[song]}),play:async()=>({error:'此歌曲暂时没有完整播放权限'})});try{
    await f.ui.activate();f.root.querySelector('[data-music-song="locked"]').click();await settle();
    const feedback=f.root.querySelector('.music-feedback');assert(feedback);assert.equal(feedback.hidden,false);assert.match(feedback.textContent,/完整播放权限/);assert.equal(feedback.getAttribute('role'),'status');assert.equal(f.root.querySelector('.music-workspace-notice'),null);assert.equal(f.root.querySelector('.music-playback-status'),null);
    await f.advance(4200);assert(feedback.hidden);assert.equal(feedback.textContent,'');f.root.querySelector('[data-music-song="locked"]').click();await settle();assert(!feedback.hidden);f.ui.deactivate();assert(feedback.hidden);assert.equal(f.timers.size,0);
  }finally{f.close();}
});

test('the five-platform account list stays contiguous and neither music entry keeps a right arrow',async()=>{
  const f=fixture();try{
    await f.ui.activate();assert.deepEqual(PLATFORMS.map(value=>value.id),['netease','qq','kugou','qishui','spotify']);
    assert.deepEqual([...f.root.querySelectorAll('[data-music-platform]')].map(node=>node.dataset.musicPlatform),PLATFORMS.map(value=>value.id));
    assert(!f.root.querySelector('.music-search').textContent.includes('↗'));assert(!f.root.querySelector('[data-music-action="qr"]').textContent.includes('↗'));
    f.ui.open();f.root.querySelector('[data-music-platform="qq"]').click();assert(!f.root.querySelector('.music-login-methods').hidden);assert.match(f.root.querySelector('.music-card-name').textContent,/QQ 音乐/);assert.equal(f.calls.filter(value=>value.action==='beginQR').length,0);
  }finally{f.close();}
});

test('QQ and Spotify entry buttons embed their official pages and keep web-session status separate from NetEase account state',async()=>{
  const f=fixture({platformStatus:async({provider})=>({provider,windowOpen:false,sessionSaved:false,apiConnected:false}),platformLogin:async({provider})=>({provider,windowOpen:true,sessionSaved:true,apiConnected:false}),platformLogout:async({provider})=>({provider,windowOpen:false,sessionSaved:false,apiConnected:false})});
  try{
    await f.ui.activate();f.ui.open();f.root.querySelector('[data-music-platform="qq"]').click();await settle();
    assert(!f.root.querySelector('.music-official-tabs').hidden);assert.equal(f.root.querySelectorAll('.music-official-tabs [data-official-method]').length,2);
    for(const method of ['qq','wechat']){f.root.querySelector(`[data-official-method="${method}"]`).click();await settle();assert(f.calls.some(call=>call.action==='platformLogin'&&call.payload.provider==='qq'&&call.payload.method===method));}
    assert.equal(f.ui.getState().authenticated,false);assert.equal(f.ui.getState().officialSession.apiConnected,false);assert.match(f.root.querySelector('.music-card-description').textContent,/官方页面|官方登录/);
    f.root.querySelector('[data-music-platform="spotify"]').click();await settle();assert(f.root.querySelector('.music-official-tabs').hidden);f.root.querySelector('[data-music-action="official-login"]').click();await settle();assert(f.calls.some(call=>call.action==='platformLogin'&&call.payload.provider==='spotify'));
    f.emit({platformSession:{provider:'spotify',windowOpen:false,sessionSaved:true,apiConnected:false}});assert.match(f.root.querySelector('.music-card-description').textContent,/网页会话已保存/);assert.equal(f.root.querySelector('.music-pill-name').textContent,'登录音乐');
    f.root.querySelector('[data-music-action="logout"]').click();await settle();assert(f.calls.some(call=>call.action==='platformLogout'&&call.payload.provider==='spotify'));assert.equal(f.ui.getState().authenticated,false);
  }finally{f.close();}
});


test('quality selection preserves seconds and failed entitlement leaves the current audio intact',async()=>{
  const song={id:'one',title:'真实音质',artist:'甲',duration:200};
  const f=fixture({home:async()=>({songs:[song]}),play:async({quality})=>quality==='jymaster'?{error:'此账号暂无母带权限'}:{song,audioURL:'pulse-music-audio://stream/'+(quality||'exhigh'),quality:quality||'exhigh',bitrate:320000}});try{
    await f.ui.activate();const audio=f.root.querySelector('audio');Object.defineProperty(audio,'duration',{configurable:true,get:()=>200});f.root.querySelector('[data-music-song="one"]').click();await settle();audio.dispatchEvent(new f.view.Event('loadedmetadata'));audio.currentTime=42.5;
    f.root.querySelector('[data-track-menu="quality"]').click();f.root.querySelector('[data-quality-choice="lossless"]').click();await settle();audio.dispatchEvent(new f.view.Event('loadedmetadata'));assert.equal(audio.currentTime,42.5);assert.equal(f.ui.getState().player.quality,'lossless');assert.equal(f.root.querySelector('.music-quality-badge').textContent,'SQ');assert.equal(audio.paused,false);
    const src=audio.getAttribute('src');f.root.querySelector('[data-track-menu="quality"]').click();f.root.querySelector('[data-quality-choice="jymaster"]').click();await settle();assert.equal(audio.getAttribute('src'),src);assert.equal(audio.paused,false);assert.equal(audio.currentTime,42.5);assert.equal(f.ui.getState().player.quality,'lossless');assert.match(f.root.querySelector('.music-feedback').textContent,/母带权限/);
  }finally{f.close();}
});

test('Qishui preview remains visibly marked after its temporary notice and quality changes',async()=>{
  const song={id:'qishui:456',source:'qishui',title:'Preview',artist:'A',duration:172},qualities=[{id:'standard',label:'标准',short:'标准'},{id:'higher',label:'高品质',short:'HQ'}];
  const f=fixture({home:async()=>({songs:[song]}),play:async({quality})=>({song:{...song,duration:30},source:'qishui',audioURL:'pulse-music-audio://stream/'+(quality||'higher'),trial:true,quality:quality||'higher',qualityOptions:qualities,qualityLabel:'高品质 · 试听'})});
  try{
    await f.ui.activate();f.root.querySelector('[data-music-song="qishui:456"]').click();await settle();
    assert.equal(f.root.querySelector('.music-duration').textContent,'0:30');assert.equal(f.root.querySelector('.music-quality-badge').textContent,'试听');assert.match(f.root.querySelector('.music-feedback').textContent,/30秒试听/);
    await f.advance(6000);assert.equal(f.root.querySelector('.music-quality-badge').textContent,'试听');assert.match(f.root.querySelector('.music-quality-badge').title,/试听/);
    f.root.querySelector('[data-track-menu="quality"]').click();f.root.querySelector('[data-quality-choice="standard"]').click();await settle();
    assert.match(f.root.querySelector('audio').src,/standard$/);assert.match(f.root.querySelector('.music-feedback').textContent,/30秒试听/);assert.equal(f.root.querySelector('.music-quality-badge').textContent,'试听');
  }finally{f.close();}
});

test('switching to Qishui preview announces its real duration and returning to full audio clears the marker',async()=>{
  const original={id:'1',title:'Track',artist:'A',duration:172},preview={id:'qishui:456',source:'qishui',title:'Track',artist:'A',duration:30};
  const f=fixture({home:async()=>({songs:[original]}),play:async()=>({song:original,audioURL:'pulse-music-audio://stream/full'}),sourceOptions:async()=>({sources:[{id:'qishui',available:true}]}),switchSource:async({provider})=>provider==='qishui'?{song:preview,source:'qishui',audioURL:'pulse-music-audio://stream/preview',trial:true,quality:'higher',qualityOptions:[{id:'higher',label:'高品质',short:'HQ'}]}:{song:original,source:'netease',audioURL:'pulse-music-audio://stream/full',quality:'exhigh'}});
  try{
    await f.ui.activate();f.root.querySelector('[data-music-song="1"]').click();await settle();
    f.root.querySelector('[data-track-menu="source"]').click();await settle();f.root.querySelector('[data-source-choice="qishui"]').click();await settle();
    assert.match(f.root.querySelector('.music-feedback').textContent,/30秒试听/);assert.equal(f.root.querySelector('.music-duration').textContent,'0:30');assert.equal(f.root.querySelector('.music-quality-badge').textContent,'试听');
    f.root.querySelector('[data-track-menu="source"]').click();await settle();f.root.querySelector('[data-source-choice="netease"]').click();await settle();
    assert.equal(f.root.querySelector('.music-quality-badge').textContent,'HQ');assert(!f.root.querySelector('.music-quality-badge').title.includes('试听'));assert.equal(f.root.querySelector('.music-duration').textContent,'2:52');
  }finally{f.close();}
});

test('verified source selection really replaces the stream and queue while preserving paused progress',async()=>{
  const original={id:'1',title:'Track',artist:'A',duration:200,liked:true},alternate={id:'qq:mid',title:'Track',artist:'A',duration:201,source:'qq'};
  const f=fixture({home:async()=>({songs:[original]}),play:async()=>({song:original,audioURL:'pulse-music-audio://track/original'}),sourceOptions:async()=>({sources:[{id:'qq',available:true}]}),switchSource:async()=>({song:alternate,source:'qq',audioURL:'pulse-music-audio://track/alternate',quality:'lossless',qualityOptions:[{id:'lossless',label:'无损 FLAC',short:'SQ'}]})});
  try{
    await f.ui.activate();const audio=f.root.querySelector('audio');Object.defineProperty(audio,'duration',{configurable:true,get:()=>201});
    f.root.querySelector('[data-music-song="1"]').click();await settle();audio.dispatchEvent(new f.view.Event('loadedmetadata'));audio.currentTime=63.2;audio.dispatchEvent(new f.view.Event('timeupdate'));audio.pause();
    f.root.querySelector('[data-track-menu="source"]').click();await settle();const button=f.root.querySelector('[data-source-choice="qq"]');assert.equal(button.disabled,false);button.click();await settle();audio.dispatchEvent(new f.view.Event('loadedmetadata'));
    assert.equal(audio.getAttribute('src'),'pulse-music-audio://track/alternate');assert.equal(audio.currentTime,63.2);assert.equal(audio.paused,true);assert.equal(f.ui.getState().player.songId,alternate.id);assert.equal(f.ui.getState().player.queueCount,1);assert.equal(f.root.querySelector('.music-source-badge').textContent,'QQ');assert.equal(f.root.querySelector('.music-like').getAttribute('aria-pressed'),'false');assert.equal(f.root.querySelector('.music-quality-badge').textContent,'SQ');
    assert.equal(f.calls.find(value=>value.action==='switchSource').payload.provider,'qq');
  }finally{f.close();}
});

test('a failed source match leaves the playing stream and position intact',async()=>{
  const song={id:'1',title:'Track',artist:'A',duration:200};
  const f=fixture({home:async()=>({songs:[song]}),play:async()=>({song,audioURL:'pulse-music-audio://track/original'}),sourceOptions:async()=>({sources:[{id:'qq',available:true}]}),switchSource:async()=>({error:'此来源没有匹配歌曲'})});
  try{
    await f.ui.activate();const audio=f.root.querySelector('audio');Object.defineProperty(audio,'duration',{configurable:true,get:()=>200});f.root.querySelector('[data-music-song="1"]').click();await settle();audio.dispatchEvent(new f.view.Event('loadedmetadata'));audio.currentTime=42;
    f.root.querySelector('[data-track-menu="source"]').click();await settle();f.root.querySelector('[data-source-choice="qq"]').click();await settle();
    assert.equal(audio.getAttribute('src'),'pulse-music-audio://track/original');assert.equal(audio.currentTime,42);assert.equal(audio.paused,false);assert.equal(f.ui.getState().player.songId,'1');
  }finally{f.close();}
});

test('lyrics follow audio seconds and listening uses elapsed playback time rather than a seek offset',async()=>{
  const song={id:'one',title:'真实歌词',artist:'甲',duration:200};
  const f=fixture({home:async()=>({songs:[song],listening:{todaySeconds:1980,todaySongs:11,streakDays:3}}),play:async()=>({song,audioURL:'pulse-music-audio://stream/one',quality:'exhigh'}),lyrics:async()=>({lines:[{time:0,text:'第一行'},{time:5,text:'第二行'},{time:150,text:'第三行'}]}),historyProgress:async()=>({listening:{todaySeconds:1992,todaySongs:12,streakDays:3}})});try{
    await f.ui.activate();assert.equal(f.root.querySelector('[data-listening="minutes"]').textContent,'33');assert.equal(f.root.querySelector('[data-listening="songs"]').textContent,'11');f.root.querySelector('[data-music-song="one"]').click();await settle();const audio=f.root.querySelector('audio');Object.defineProperty(audio,'duration',{configurable:true,get:()=>200});audio.currentTime=7;audio.dispatchEvent(new f.view.Event('timeupdate'));assert.equal(f.root.querySelector('.music-lyrics-lines .is-current').textContent,'第二行');
    await f.advance(12000);audio.currentTime=180;audio.dispatchEvent(new f.view.Event('timeupdate'));await settle();const progress=f.calls.filter(value=>value.action==='historyProgress').at(-1).payload;assert.equal(progress.listenedSeconds,12);assert.equal(progress.position,180);assert.equal(f.root.querySelector('[data-listening="songs"]').textContent,'12');assert.equal(f.root.querySelector('.music-lyrics-lines .is-current').textContent,'第三行');assert.equal(f.ui.getState().lyrics.lines,3);
  }finally{f.close();}
});


test('buffering and seeking time do not increase the listening seconds submitted to storage',async()=>{
  const song={id:'one',title:'有效聆听',artist:'甲',duration:200},f=fixture({home:async()=>({songs:[song]}),play:async()=>({song,audioURL:'pulse-music-audio://stream/one'})});try{
    await f.ui.activate();f.root.querySelector('[data-music-song="one"]').click();await settle();const audio=f.root.querySelector('audio');
    await f.advance(5000);audio.dispatchEvent(new f.view.Event('waiting'));await f.advance(20000);audio.currentTime=5;audio.dispatchEvent(new f.view.Event('timeupdate'));await settle();assert.equal(f.calls.filter(value=>value.action==='historyProgress').at(-1).payload.listenedSeconds,5);
    audio.dispatchEvent(new f.view.Event('playing'));await settle();await f.advance(3000);audio.dispatchEvent(new f.view.Event('seeking'));await f.advance(10000);audio.currentTime=150;audio.dispatchEvent(new f.view.Event('seeked'));audio.dispatchEvent(new f.view.Event('timeupdate'));await settle();assert.equal(f.calls.filter(value=>value.action==='historyProgress').at(-1).payload.listenedSeconds,3);
  }finally{f.close();}
});

test('quality requests wait for an in-flight progress save before reissuing the song',async()=>{
  let release,progressCount=0;const song={id:'one',title:'切换前保存',artist:'甲'},f=fixture({home:async()=>({songs:[song]}),play:async({quality})=>({song,audioURL:'pulse-music-audio://stream/'+(quality||'exhigh'),quality:quality||'exhigh'}),historyProgress:()=>++progressCount===1?new Promise(resolve=>{release=resolve;}):Promise.resolve({})});try{
    await f.ui.activate();f.root.querySelector('[data-music-song="one"]').click();await settle();f.root.querySelector('[data-track-menu="quality"]').click();f.root.querySelector('[data-quality-choice="lossless"]').click();await settle();assert.equal(f.calls.filter(value=>value.action==='play').length,1);release({});await settle();assert.equal(f.calls.filter(value=>value.action==='play').length,2);assert.equal(f.ui.getState().player.quality,'lossless');
  }finally{f.close();}
});


test('volume adjustment feedback is an integer only while the range is being adjusted',async()=>{const f=fixture();try{await f.ui.activate();const slider=f.root.querySelector('.music-volume'),number=f.root.querySelector('.music-volume-number');assert(number.hidden);slider.value='.56';slider.dispatchEvent(new f.view.Event('input'));assert.equal(number.textContent,'56');assert(!number.hidden);slider.dispatchEvent(new f.view.Event('change'));assert(number.hidden);}finally{f.close();}});

test('offline drops the current media buffer and prevents another network playback until online',async()=>{const song={id:'one',title:'网络歌曲'},f=fixture({home:async()=>({songs:[song]}),play:async()=>({song,audioURL:'pulse-music-audio://track/one'})});try{await f.ui.activate();f.root.querySelector('[data-music-song="one"]').click();await settle();const audio=f.root.querySelector('audio');audio.currentTime=12;Object.defineProperty(f.view.navigator,'onLine',{configurable:true,value:false});f.view.dispatchEvent(new f.view.Event('offline'));await settle();assert(!audio.hasAttribute('src'));assert(f.calls.some(x=>x.action==='stopAudio'));const count=f.calls.filter(x=>x.action==='play').length;f.root.querySelector('[data-player-action="toggle"]').click();await settle();assert.equal(f.calls.filter(x=>x.action==='play').length,count);assert.match(f.root.querySelector('.music-feedback').textContent,/离线/);}finally{f.close();}});

test('discovery entries use the shared provider API and the ordered deck retains more than five songs',async()=>{const songs=Array.from({length:12},(_,i)=>({id:String(i+1),title:'歌曲'+i})),f=fixture({home:async()=>({songs:songs.slice(0,6),cards:songs.slice(0,6)}),deck:async()=>({cards:songs}),discovery:async({mode})=>({songs:[songs[10]],label:mode})});try{await f.ui.activate();await settle();assert.equal(f.root.querySelectorAll('[data-music-discovery]').length,5);for(const mode of ['daily','radar','fm','heart','similar']){f.root.querySelector('[data-music-discovery="'+mode+'"]').click();await settle();assert.equal(f.root.querySelector('.music-songs-heading').textContent,mode);assert(f.calls.some(x=>x.action==='discovery'&&x.payload.mode===mode));}}finally{f.close();}});


test('a playback response arriving after offline cannot attach another media source',async()=>{let finish;const song={id:'one',title:'网络歌曲'},f=fixture({home:async()=>({songs:[song]}),play:()=>new Promise(resolve=>{finish=resolve;})});try{await f.ui.activate();f.root.querySelector('[data-music-song="one"]').click();await settle();Object.defineProperty(f.view.navigator,'onLine',{configurable:true,value:false});f.view.dispatchEvent(new f.view.Event('offline'));finish({song,audioURL:'pulse-music-audio://track/late'});await settle();assert(!f.root.querySelector('audio').hasAttribute('src'));assert.equal(f.ui.getState().player.phase,'paused');assert.match(f.root.querySelector('.music-feedback').textContent,/离线/);}finally{f.close();}});


test('mode cards show their own first-song art and selecting one reveals actual songs without replacing independent playlists',async()=>{const artwork=id=>'https://p1.music.126.net/'+id+'.jpg',daily={id:'1',title:'每日首曲',coverURL:artwork('daily')},lists=Array.from({length:18},(_,i)=>({id:String(i+100),title:'独立歌单'+i,coverURL:artwork('playlist'+i)})),f=fixture({home:async()=>({songs:[daily],cards:[daily],playlists:lists,recommendationMode:'personal'}),discovery:async({mode})=>({songs:[{id:'9',title:mode+'首曲',coverURL:artwork(mode)}],label:mode,playlists:[{id:'private-radar',title:'私人雷达'}]})});try{let revealed=0;await f.ui.activate();await settle();f.root.querySelector('.music-songs-section').scrollIntoView=()=>revealed++;for(const mode of ['daily','radar','fm','heart','similar']){const art=f.root.querySelector('[data-music-discovery="'+mode+'"] .music-mode-art img');assert.equal(art.getAttribute('src')||art.getAttribute('data-cover-src'),artwork(mode));}const button=f.root.querySelector('[data-music-discovery="fm"]'),image=button.querySelector('img');assert.equal(image.getAttribute('src')||image.getAttribute('data-cover-src'),artwork('fm'));assert.notEqual(image.getAttribute('src')||image.getAttribute('data-cover-src'),lists[2].coverURL);button.click();await settle();assert.equal(f.root.querySelector('.music-song-copy strong').textContent,'fm首曲');assert.equal(f.root.querySelectorAll('.music-playlist').length,18);assert(!f.root.querySelector('.music-playlist-list').textContent.includes('私人雷达'));assert.equal(revealed,1);}finally{f.close();}});


test('backgrounding releases music presentation without pausing or disposing the shared audio',async()=>{
 const songs=[{id:'one',title:'First'},{id:'two',title:'Next'}];
 const f=fixture({home:async()=>({songs}),play:async({id})=>({song:songs.find(item=>item.id===id),audioURL:'pulse-music-audio://track/'+id})});
 try{
  await f.ui.activate();f.root.querySelector('[data-music-song="one"]').click();await settle();
  const audio=f.root.querySelector('audio');assert.equal(audio.paused,false);const src=audio.getAttribute('src');
  f.ui.background();await settle();assert.equal(audio.paused,false);assert.equal(audio.getAttribute('src'),src);assert.equal(f.ui.getState().disposed,false);
  assert(!f.calls.some(value=>value.action==='stopAudio'||value.action==='deactivate'));
  audio.dispatchEvent(new f.view.Event('ended'));await settle();assert.match(audio.getAttribute('src'),/two$/);
  await f.ui.activate();assert.equal(f.root.querySelector('audio'),audio);assert.equal(f.ui.getState().player.songId,'two');
 }finally{f.close();}
});

test('selecting a verified account reloads its workspace and immediately removes the previous providers catalog',async()=>{
 let provider='netease',finishHome;
 const ne={id:'1',title:'NE recommendation'},qq={id:'qq:owned_track',source:'qq',title:'QQ library track'};
 const f=fixture({
  bootstrap:async()=>({profile:{nickname:'NE owner'}}),
  providerState:async()=>({provider,profile:{nickname:'NE owner'},apiConnected:true}),
  platformStatus:async({provider})=>({provider,sessionSaved:true,apiConnected:true,profile:{nickname:'QQ owner'}}),
  platformRequest:async()=>({apiConnected:true,profile:{nickname:'QQ owner'}}),
  selectProvider:async value=>{provider=value.provider;return {provider,profile:{nickname:'QQ owner'},apiConnected:true};},
  home:async()=>provider==='netease'?{songs:[ne],cards:[ne],playlists:[{id:'ne-list',title:'NE playlist'}]}:new Promise(resolve=>finishHome=resolve),
  deck:async()=>({cards:provider==='netease'?[ne]:[qq]})
 });
 try{
  await f.ui.activate();await settle();assert(f.root.querySelector('[data-music-song="1"]'));
  f.ui.open();f.root.querySelector('[data-music-platform="qq"]').click();await settle();
  assert.equal(f.ui.getState().activeProvider,'qq');assert.equal(f.root.querySelector('.music-pill-name').textContent,'QQ owner');
  assert.equal(f.root.querySelector('[data-music-song="1"]'),null);assert(!f.root.querySelector('.music-playlist-list').textContent.includes('NE playlist'));
  finishHome({songs:[qq],cards:[qq],playlists:[{id:'qq:5',source:'qq',title:'QQ playlist'}],discoveryModes:[],recommendationLabel:'QQ 音乐 · 我的歌单'});await settle();
  assert(f.root.querySelector('[data-music-song="qq:owned_track"]'));assert(f.root.querySelector('.music-discovery-modes').hidden);
  assert.equal(f.root.querySelector('.music-recommendation-mode').textContent,'QQ 音乐 · 我的歌单');
  f.emit({profile:{nickname:'NE background refresh'}});assert.equal(f.root.querySelector('.music-pill-name').textContent,'QQ owner');
 }finally{f.close();}
});
