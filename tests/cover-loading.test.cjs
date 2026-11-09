'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{create}=require('../ui/cover-loading.js');
function fixture(){
  const dom=new JSDOM('<div id="root"><span><img data-cover data-cover-src="pulse-music-image://one" width="80" height="80"></span><span><img data-cover data-cover-src="pulse-music-image://two" width="80" height="80"></span></div>',{url:'file:///fixture'}),view=dom.window,root=view.document.getElementById('root'),images=[...root.querySelectorAll('img')];
  const timers=new Map();let sequence=0,observer;
  view.setTimeout=callback=>{timers.set(++sequence,callback);return sequence;};view.clearTimeout=id=>timers.delete(id);
  view.IntersectionObserver=class{constructor(callback){this.callback=callback;this.targets=new Set();observer=this;}observe(target){this.targets.add(target);}unobserve(target){this.targets.delete(target);}disconnect(){this.targets.clear();}};
  images[0].getBoundingClientRect=()=>({left:20,right:100,top:20,bottom:100,width:80,height:80});images[1].getBoundingClientRect=()=>({left:20,right:100,top:2500,bottom:2580,width:80,height:80});
  const api=create({root});return {view,root,images,api,timers,get observer(){return observer;},flush(){for(const [id,callback]of [...timers]){timers.delete(id);callback();}},close(){api.dispose();dom.window.close();}};
}
test('first-screen covers begin immediately and distant covers wait for bounded look-ahead',()=>{
  const f=fixture();try{assert.equal(f.images[0].getAttribute('src'),null);f.api.activate();assert.equal(f.images[0].getAttribute('src'),'pulse-music-image://one');assert.equal(f.images[0].loading,'eager');assert.equal(f.images[1].getAttribute('src'),null);f.observer.callback([{target:f.images[1],isIntersecting:true}]);assert.equal(f.images[1].getAttribute('src'),'pulse-music-image://two');}finally{f.close();}
});
test('a hidden failed first-screen cover retries once using its layout parent and deactivation cancels retry',()=>{
  const f=fixture();try{f.api.activate();const img=f.images[0];img.hidden=true;img.getBoundingClientRect=()=>({width:0,height:0});img.parentElement.getBoundingClientRect=()=>({left:20,right:100,top:20,bottom:100,width:80,height:80});img.dispatchEvent(new f.view.Event('error'));assert.equal(f.api.getStatus().retries,1);assert.equal(f.timers.size,1);f.flush();assert.equal(img.hidden,false);img.dispatchEvent(new f.view.Event('error'));assert.equal(f.timers.size,0);f.api.deactivate();assert.equal(f.observer.targets.size,0);f.api.activate();assert.equal(f.observer.targets.size,2);}finally{f.close();}
});
test('new content prunes removed image references and dispose clears pending jobs',()=>{
  const f=fixture();try{f.api.activate();f.images[0].dispatchEvent(new f.view.Event('error'));assert.equal(f.timers.size,1);f.images[0].remove();f.api.refresh();assert.equal(f.api.getStatus().tracked,1);assert.equal(f.timers.size,0);f.api.dispose();assert.equal(f.api.getStatus().tracked,0);assert.equal(f.observer.targets.size,0);}finally{f.close();}
});
