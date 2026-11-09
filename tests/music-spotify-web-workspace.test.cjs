'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {create}=require('../ui/music/music-workspace.js');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};

function fixture(){
  const dom=new JSDOM('<div class="music-view"><form></form><div class="music-body"><section></section></div></div>',{url:'https://sonara.test',pretendToBeVisual:true});
  const view=dom.window,root=view.document.querySelector('section'),searchRoot=view.document.querySelector('form'),calls=[],frames=new Map(),observers=[];
  let id=0,provider='spotify';
  view.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};view.cancelAnimationFrame=key=>frames.delete(key);
  view.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  const api=async(action,payload)=>{calls.push({action,payload});if(action==='home')return provider==='spotify'?{provider,webPlayer:true,webAuthenticated:true}:{provider,songs:[{id:'netease:one',title:'One',source:'netease'}],playlists:[]};return {};};
  const workspace=create({root,searchRoot,api});
  let rect={left:24,top:128,width:1100,height:620};root.querySelector('.music-spotify-web-surface').getBoundingClientRect=()=>rect;
  const paint=()=>{for(const [key,callback]of [...frames]){frames.delete(key);callback();}};
  return {dom,view,root,searchRoot,workspace,calls,frames,observers,paint,setProvider:value=>{provider=value;},setRect:value=>{rect=value;},close(){workspace.dispose();dom.window.close();}};
}

test('Spotify displays its official page with no fake local recommendations and routes library/search to Spotify',async()=>{
  const f=fixture();try{
    assert.equal(f.calls.length,0);await f.workspace.activate();f.paint();await settle();
    assert.equal(f.workspace.getState().webPlayer,true);assert.equal(f.root.querySelector('.music-content-grid').hidden,true);
    assert.equal(f.root.querySelector('.music-spotify-web-workspace').hidden,false);
    assert(f.root.closest('.music-view').classList.contains('has-spotify-web-player'));
    assert.equal(f.calls.some(value=>['deck','discovery','playlists','search'].includes(value.action)),false);
    assert.deepEqual(f.calls.find(value=>value.action==='platformWebPlayer').payload,{provider:'spotify',visible:true,bounds:{x:24,y:128,width:1100,height:620},path:'/'});
    const before=f.calls.length;f.root.querySelector('[data-spotify-path="/"]').click();await settle();
    assert.equal(f.calls.length,before+1);assert.equal(f.calls.at(-1).payload.navigate,true);assert.equal(f.calls.at(-1).payload.path,'/');
    f.root.querySelector('[data-spotify-path="/collection/tracks"]').click();await settle();
    assert.equal(f.calls.at(-1).payload.path,'/collection/tracks');
    f.searchRoot.querySelector('input').value='Night City';f.searchRoot.dispatchEvent(new f.view.Event('submit',{bubbles:true,cancelable:true}));await settle();
    assert.equal(f.calls.at(-1).payload.path,'/search/Night%20City');assert.equal(f.calls.some(value=>value.action==='search'),false);
    f.root.querySelector('[data-spotify-browser]').click();await settle();
    assert.deepEqual(f.calls.at(-1).payload,{provider:'spotify',action:'browser'});
  }finally{f.close();}
});

test('Spotify native content yields to account dialogs, page exit, provider switch and disposal',async()=>{
  const f=fixture();try{
    await f.workspace.activate();f.paint();await settle();
    f.workspace.setObscured(true);assert.deepEqual(f.calls.at(-1).payload,{provider:'spotify',visible:false});
    const paused=f.calls.length;f.observers.at(-1).callback();f.paint();assert.equal(f.calls.length,paused);
    f.workspace.setObscured(false);await settle();assert.equal(f.calls.at(-1).payload.visible,true);assert.equal(Object.hasOwn(f.calls.at(-1).payload,'path'),false);
    f.setRect({left:36,top:144,width:900,height:500});f.observers.at(-1).callback();f.paint();await settle();
    assert.deepEqual(f.calls.at(-1).payload.bounds,{x:36,y:144,width:900,height:500});assert.equal(Object.hasOwn(f.calls.at(-1).payload,'path'),false);
    f.workspace.deactivate();assert.equal(f.calls.at(-1).payload.visible,false);assert.equal(f.frames.size,0);
    await f.workspace.activate();f.paint();await settle();f.setProvider('netease');await f.workspace.providerChanged();f.paint();await settle();
    assert.equal(f.workspace.getState().webPlayer,false);assert.equal(f.root.querySelector('.music-content-grid').hidden,false);
    assert.equal(f.root.closest('.music-view').classList.contains('has-spotify-web-player'),false);
    const lastWeb=f.calls.filter(value=>value.action==='platformWebPlayer').at(-1);assert.equal(lastWeb.payload.visible,false);
    f.workspace.dispose();assert(f.observers.every(value=>value.disconnected));assert.equal(f.frames.size,0);
  }finally{f.close();}
});
