'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create,MOVIE_CATEGORIES}=require('../ui/anime/index.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve)),settle=async()=>{for(let n=0;n<8;n++)await tick();};
const movie={id:'movie:sample:2024',title:'电影 <img src=x onerror=bad()>',summary:'真实条目简介',cover:'https://images.test/movie.jpg',score:8.7,tags:['电影','科幻']};
function fixture(overrides={}){
  const dom=new JSDOM('<div class="content-scroll"><section id="anime"></section><section id="movies"></section></div>',{url:'https://local.test/'}),root=dom.window.document.getElementById('movies'),calls=[];
  let rules=[{id:'slow',name:'慢速来源',baseURL:'https://slow.test/api.php/provide/vod',enabled:true},{id:'fast',name:'快速来源',baseURL:'https://fast.test/api.php/provide/vod',enabled:true}],historyListener=null,unsubscribed=false;
  const api=async(action,payload={})=>{
    calls.push({action,payload});if(overrides[action])return overrides[action](payload);
    if(action==='bootstrap')return {rules,history:[],revision:0,categories:MOVIE_CATEGORIES,settings:{adFilter:true}};
    if(action==='home')return {hot:[movie],featured:Array.from({length:5},(_,index)=>({...movie,id:'movie:'+index})),history:[],revision:0};
    if(action==='recommendations')return {items:Array.from({length:8},(_,index)=>({...movie,id:'recommended:'+index})),nextOffset:8,hasMore:false};
    if(action==='rules')return {rules};
    if(action==='detail')return {item:{...movie,id:payload.id}};
    if(action==='history')return {history:[],revision:0};
    if(action==='sourceSave'){rules=[...rules,{...payload.source,id:payload.source.id||'custom',baseURL:payload.source.url}];return {rules};}
    if(action==='sourceToggle'){rules=rules.map(source=>source.id===payload.id?{...source,enabled:payload.enabled}:source);return {rules};}
    if(action==='sourceDelete'){rules=rules.filter(source=>source.id!==payload.id);return {rules};}
    if(action==='settingsSave')return {settings:payload};
    if(action==='probeSources'){rules=rules.map(source=>({...source,latencyMs:123}));return {rules};}
    return {};
  };
  const ui=create({root,api,kind:'movies',imageURL:url=>'pulse-movie-image://image?url='+encodeURIComponent(url),subscribeHistory:listener=>{historyListener=listener;return()=>{unsubscribed=true;historyListener=null;};}});
  return {dom,root,ui,calls,api,history:value=>historyListener?.(value),unsubscribed:()=>unsubscribed,close(){ui.dispose();dom.window.close();}};
}
test('movies replace the wide hero with a high-score film strip while preserving four lower features and theme',async()=>{
  const f=fixture();let anime;
  try{
    f.dom.window.document.documentElement.dataset.interfaceTheme='neon-pop';
    anime=create({root:f.dom.window.document.getElementById('anime'),api:async action=>action==='bootstrap'?{rules:[],history:[]}:action==='home'?{hot:[],featured:[],history:[]}:{} });
    assert.equal(f.calls.length,0,'constructing a hidden module performs no network requests');await f.ui.activate();
    await settle();assert.equal(f.root.querySelectorAll('.anime-feature-card').length,4);assert.equal(f.root.querySelector('.anime-hero'),null);assert.equal(f.root.querySelectorAll('.movie-metal-card').length,8);assert.equal(f.root.querySelector('.anime-history-list').children.length,0);
    assert.match(f.root.querySelector('.anime-hot-panel h2').textContent,/影视/);assert.equal(f.root.querySelector('#movies-query').placeholder,'搜索影视名称…');
    assert.equal(f.dom.window.document.querySelectorAll('#anime-query').length,1);assert.equal(f.dom.window.document.querySelectorAll('#movies-query').length,1);
    assert.equal(f.root.querySelector('[onerror]'),null);assert.match(f.root.querySelector('img').src,/^pulse-movie-image:/);
    assert.equal(f.dom.window.document.documentElement.dataset.interfaceTheme,'neon-pop');assert.equal(f.root.querySelectorAll('[data-category]').length>=MOVIE_CATEGORIES.length,true);
  }finally{anime?.dispose();f.close();}
});
test('movie search uses the full backend catalog and server cursors while appending existing cards',async()=>{
  const f=fixture({catalog:async({offset})=>({items:[{...movie,id:offset?'movie:page2':'movie:page1'}],nextOffset:offset?25:24,rawCount:offset?1:24,total:null,hasMore:!offset})});
  try{
    await f.ui.activate();const field=f.root.querySelector('#movies-query');field.value='星际穿越';f.root.querySelector('.anime-search').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await settle();
    assert.deepEqual(f.calls.find(call=>call.action==='catalog').payload,{category:'热门',query:'星际穿越',offset:0});const first=f.root.querySelector('.anime-grid-card');
    f.root.querySelector('[data-action="more"]').click();await settle();assert.equal(f.root.querySelector('.anime-grid-card'),first);assert.equal(f.root.querySelectorAll('.anime-grid-card').length,2);assert.match(f.root.querySelector('.anime-catalog-end').textContent,/全部影视/);
  }finally{f.close();}
});
test('verified movie sources display measured latency and use the shared episode playback boundary',async()=>{
  const f=fixture({searchSource:async({ruleId})=>({ruleId,name:ruleId==='fast'?'快速来源':'慢速来源',latencyMs:ruleId==='fast'?25:450,items:[{title:'电影',url:'cms:'+ruleId}]}),episodes:async()=>({lines:[{name:'在线播放',episodes:[{title:'正片',url:'https://media.test/movie.m3u8'}]}]})});
  try{
    await f.ui.activate();f.root.querySelector('[data-item]').click();await settle();f.root.querySelector('[data-action="find-sources"]').click();await settle();
    const groups=f.root.querySelectorAll('.anime-source-group');assert.match(groups[0].textContent,/快速来源/);assert.match(groups[0].textContent,/25 ms/);assert.doesNotMatch(f.root.textContent,/Kazumi|番剧规则/);
    groups[0].querySelector('[data-source]').click();await settle();f.root.querySelector('[data-episode]').click();await settle();
    const play=f.calls.find(call=>call.action==='play');assert.equal(play.payload.id,movie.id);assert.equal(play.payload.ruleId,'fast');assert.equal(play.payload.episode.url,'https://media.test/movie.m3u8');assert.equal(f.calls.some(call=>call.action==='historySave'),false);
  }finally{f.close();}
});
test('opening movie details starts source discovery once, refresh remains available and old results cannot replace another film',async()=>{
  const pending=[];const f=fixture({searchSource:payload=>new Promise(resolve=>pending.push({payload,resolve}))});
  try{
    await f.ui.activate();const card=f.root.querySelector('[data-item]');card.click();await settle();
    assert.equal(pending.length,2);assert.equal(f.root.querySelector('[data-action="find-sources"]').disabled,true);assert(f.root.querySelector('.anime-cancel-search'));
    // A synthetic double activation must join the existing search, not start it twice.
    f.root.querySelector('[data-action="find-sources"]').dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true}));await settle();assert.equal(pending.length,2);
    f.root.querySelector('[data-action="back"]').click();await settle();f.root.querySelector('[data-movie-card]').click();await settle();assert.equal(pending.length,4);
    pending.slice(0,2).forEach(({payload,resolve})=>resolve({ruleId:payload.ruleId,items:[{title:'旧影片结果',url:'old'}]}));await settle();assert.doesNotMatch(f.root.textContent,/旧影片结果/);
    pending.slice(2).forEach(({payload,resolve})=>resolve({ruleId:payload.ruleId,items:[{title:'新影片结果',url:'new'}]}));await settle();assert.match(f.root.textContent,/新影片结果/);assert.equal(f.root.querySelector('[data-action="find-sources"]').disabled,false);
    assert.equal(f.calls.some(call=>call.action==='play'),false,'automatic discovery never starts playback');
  }finally{f.close();}
});

test('movie source quality is measured on demand and shows precise sample dimensions rather than names',async()=>{
  const f=fixture({searchSource:async({ruleId})=>({ruleId,name:'4K来源名称',items:[{title:'电影',url:'cms:'+ruleId}]}),quality:async()=>({width:1920,height:756,method:'segment',label:'1920×756 · 宽幅片源'}),episodes:async()=>({lines:[{episodes:[{title:'正片',url:'https://media.test/a.m3u8'}]}]})});
  try{
    await f.ui.activate();f.root.querySelector('[data-item]').click();await settle();f.root.querySelector('[data-action="find-sources"]').click();await settle();
    assert.equal(f.calls.filter(call=>call.action==='quality').length,0);f.root.querySelector('[data-action="probe-quality"]').click();await settle();
    assert.equal(f.calls.filter(call=>call.action==='quality').length,2);assert([...f.root.querySelectorAll('.movie-quality-badge')].every(node=>node.textContent==='1920×756 · 宽幅片源'));assert([...f.root.querySelectorAll('.movie-quality-badge')].every(node=>node.title==='样本分片编码尺寸'));
  }finally{f.close();}
});
test('movie source settings validate manual entries and delegate writes without Kazumi editors',async()=>{
  const f=fixture();try{
    await f.ui.activate();f.root.querySelector('[data-action="settings"]').click();await settle();assert.match(f.root.querySelector('h1').textContent,/影视设置/);assert.equal(f.root.querySelector('[data-action="repository"]'),null);assert.equal(f.root.querySelector('[data-rule-toggle]'),null);
    f.root.querySelector('[data-action="source-add"]').click();f.root.querySelector('[data-action="source-save"]').click();await settle();assert.match(f.root.querySelector('.anime-dialog-error').textContent,/有效/);assert.equal(f.calls.some(call=>call.action==='sourceSave'),false);
    f.root.querySelector('[data-source-name]').value='备用来源';f.root.querySelector('[data-source-url]').value='https://custom.test/api.php/provide/vod';f.root.querySelector('[data-action="source-save"]').click();await settle();assert.equal(f.root.querySelector('.anime-dialog'),null);assert.equal(f.calls.find(call=>call.action==='sourceSave').payload.source.name,'备用来源');
    const toggle=f.root.querySelector('[data-source-toggle="custom"]');toggle.checked=false;toggle.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));await settle();assert.equal(f.calls.find(call=>call.action==='sourceToggle').payload.enabled,false);assert.equal(f.root.querySelector('[data-source-toggle="custom"]').disabled,false);
    f.root.querySelector('[data-source-edit="custom"]').click();f.root.querySelector('[data-source-delete="custom"]').click();await settle();assert.equal(f.calls.find(call=>call.action==='sourceDelete').payload.id,'custom');assert.equal(f.root.querySelector('[data-source-toggle="custom"]'),null);
    const ad=f.root.querySelector('[data-movie-ad-filter]');ad.checked=false;ad.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));await settle();assert.deepEqual(f.calls.find(call=>call.action==='settingsSave').payload,{adFilter:false});
    f.root.querySelector('[data-action="sources-probe"]').click();await settle();assert.match(f.root.querySelector('.anime-rule-copy').textContent,/123 ms/);
  }finally{f.close();}
});
test('movie history accepts string identities and disposes its shared lifecycle resources',async()=>{
  const f=fixture();try{
    await f.ui.activate();const featured=f.root.querySelector('.anime-feature-card');f.history({history:[{subject:movie,position:42,duration:200,episodeName:'正片'}],revision:2});assert.equal(f.root.querySelector('.anime-feature-card'),featured);assert.equal(f.root.querySelector('[data-history]').dataset.history,movie.id);
    f.history({history:[],revision:1});assert.equal(f.root.querySelectorAll('.anime-history-card').length,1);f.root.querySelector('[data-history]').click();await settle();assert.equal(f.calls.find(call=>call.action==='continue').payload.id,movie.id);
    f.ui.deactivate();await settle();assert(f.calls.some(call=>call.action==='cancel'));f.ui.dispose();assert(f.unsubscribed());assert.equal(f.root.children.length,0);
  }finally{f.close();}
});
