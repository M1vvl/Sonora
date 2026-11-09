'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {create}=require('../ui/music/music-workspace.js');
const {create:createOptions}=require('../ui/music/track-options.js');
const {QUALITY_OPTIONS,validQuality,describe}=require('../src/music/quality.cjs');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const song=id=>({id,title:'Track '+id,artist:'Artist'});
function fixture(overrides={}){
  const dom=new JSDOM('<form></form><section></section>',{url:'https://test.invalid',pretendToBeVisual:true});
  const root=dom.window.document.querySelector('section'),plays=[],calls=[];
  const api=async(action,payload)=>{
    calls.push({action,payload});
    if(overrides[action])return overrides[action](payload);
    if(action==='home')return {songs:[song('home')],playlists:[{id:'list',title:'List'}]};
    if(action==='discovery')return {songs:[song(payload.mode+'1'),song(payload.mode+'2')],label:payload.mode};
    if(action==='playlist')return {songs:[song('list1'),song('list2')],playlist:{title:'List'}};
    return {};
  };
  const ui=create({root,searchRoot:dom.window.document.querySelector('form'),api,onPlay:(value,options)=>plays.push({value,options})});
  return {dom,root,plays,calls,ui,close(){ui.dispose();dom.window.close();}};
}
test('each discovery card and recommended playlist starts its first song with the exact requested queue',async()=>{
  const f=fixture();try{
    await f.ui.activate();await settle();assert.equal(f.plays.length,0);
    for(const mode of ['daily','radar','fm','heart','similar']){
      f.root.querySelector(`[data-music-discovery="${mode}"]`).click();await settle();
      const play=f.plays.at(-1);assert.equal(play.value.id,mode+'1');assert.equal(play.value.position,0);
      assert.deepEqual(play.options.queue.map(item=>item.id),[mode+'1',mode+'2']);
    }
    f.root.querySelector('[data-music-playlist="list"]').click();await settle();
    assert.equal(f.plays.at(-1).value.id,'list1');assert.deepEqual(f.plays.at(-1).options.queue.map(item=>item.id),['list1','list2']);
    f.root.querySelector('[data-music-song="list2"]').click();assert.equal(f.plays.at(-1).value.id,'list2');
  }finally{f.close();}
});
test('a newer discovery selection, direct song click or page exit prevents a slow playlist from stealing playback',async()=>{
  let finish;
  const f=fixture({playlist:()=>new Promise(resolve=>{finish=resolve;})});try{
    await f.ui.activate();await settle();
    f.root.querySelector('[data-music-playlist="list"]').click();
    f.root.querySelector('[data-music-song="home"]').click();
    finish({songs:[song('stale')]});await settle();assert.equal(f.plays.length,1);assert.equal(f.plays[0].value.id,'home');
    f.root.querySelector('[data-music-playlist="list"]').click();f.root.querySelector('[data-music-discovery="daily"]').click();await settle();
    finish({songs:[song('stale2')]});await settle();assert.equal(f.plays.length,2);assert.equal(f.plays.at(-1).value.id,'daily1');
    f.root.querySelector('[data-music-playlist="list"]').click();f.ui.deactivate();finish({songs:[song('after-exit')]});await settle();assert.equal(f.plays.length,2);
  }finally{f.close();}
});
test('provider quality controls use actual capabilities and selected returned level, including all seven NetEase tiers',()=>{
  const dom=new JSDOM('<div></div>'),root=dom.window.document.querySelector('div'),selected=[];
  const options=createOptions({root,onQuality:id=>selected.push(id)});
  try{
    assert.equal(QUALITY_OPTIONS.length,7);
    assert(QUALITY_OPTIONS.every(item=>validQuality(item.id)));
    options.update({song:song('1'),source:'netease',quality:'exhigh',qualityOptions:QUALITY_OPTIONS});
    assert.equal(root.querySelectorAll('[data-quality-choice]').length,7);assert.equal(root.querySelector('.music-quality-badge').textContent,'HQ');
    root.querySelector('[data-quality-choice="sky"]').click();assert.deepEqual(selected,['sky']);
    options.update({song:{...song('2'),source:'spotify'},source:'spotify',quality:'aac'});
    assert.equal(root.querySelector('.music-source-badge').textContent,'SP');assert.equal(root.querySelectorAll('[data-quality-choice]').length,0);assert(root.querySelector('.music-quality-badge').disabled);
    options.update({song:song('3'),source:'qq',quality:'sq',qualityOptions:[{id:'sq',label:'QQ SQ',shortLabel:'SQ'}]});
    assert.equal(root.querySelectorAll('[data-quality-choice]').length,1);assert.equal(root.querySelector('.music-source-badge').textContent,'QQ');assert.equal(root.querySelector('.music-quality-badge').textContent,'SQ');
    options.update({song:song('3'),source:'qq',quality:null,qualityOptions:[]});
    assert.equal(root.querySelectorAll('[data-quality-choice]').length,0);assert(root.querySelector('.music-quality-badge').disabled);
    const result=describe({level:'exhigh',br:320000},'sky');assert.equal(result.quality,'exhigh');assert.equal(result.requestedQuality,'sky');assert(result.degraded);
  }finally{options.dispose();dom.window.close();}
});
