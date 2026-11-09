'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../ui/anime-player/chrome-visibility.js');
function fixture(){
  let now=0,id=0;const timers=new Map(),changes=[];
  const chrome=create({onChange:value=>changes.push(value.hidden),schedule:(callback,delay)=>{const key=++id;timers.set(key,{callback,due:now+delay});return key;},cancel:key=>timers.delete(key)});
  function advance(ms){const target=now+ms;while(true){const next=[...timers].filter(([,item])=>item.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].callback();}now=target;}
  return {chrome,advance,timers,changes};
}
test('native video inactivity hides both bars with one timer; identical observations and frame state do not wake them',()=>{
  const f=fixture();f.chrome.setReady(true);assert.equal(f.timers.size,1);
  f.chrome.pointer({insideApp:true,insideVideo:true,x:200,y:100,changed:true});
  f.advance(2499);assert.equal(f.chrome.getState().hidden,false);f.advance(1);assert.equal(f.chrome.getState().hidden,true);
  for(let i=0;i<20;i++){f.chrome.setReady(true);f.chrome.pointer({insideApp:true,insideVideo:true,x:200,y:100,changed:false});}
  assert.deepEqual(f.changes,[true]);assert.equal(f.timers.size,0);
  f.chrome.pointer({insideApp:true,insideVideo:false,x:200,y:100,changed:false});
  f.chrome.pointer({insideApp:true,insideVideo:true,x:200,y:100,changed:false});
  assert.deepEqual(f.changes,[true]);assert.equal(f.timers.size,0);
  f.chrome.pointer({insideApp:true,insideVideo:true,x:201,y:100});assert.deepEqual(f.changes,[true,false]);assert.equal(f.timers.size,1);
  f.chrome.dispose();assert.equal(f.timers.size,0);
});
test('native unchanged flag prevents mixed physical/CSS coordinates from waking controls at 100% and 150% DPI',()=>{
  for(const scale of [1,1.5]){
    const f=fixture();f.chrome.setReady(true);
    f.chrome.pointer({insideApp:true,insideVideo:true,x:200,y:100,changed:true});f.advance(2500);
    assert.equal(f.chrome.getState().hidden,true);
    f.chrome.pointer({insideApp:true,insideVideo:false,x:200*scale,y:100*scale,changed:false});
    f.chrome.pointer({insideApp:true,insideVideo:true,x:200*scale,y:100*scale,changed:false});
    assert.equal(f.chrome.getState().hidden,true);assert.equal(f.timers.size,0);
    f.chrome.pointer({insideApp:true,insideVideo:true,x:201*scale,y:100*scale,changed:true});assert.equal(f.chrome.getState().hidden,false);
    f.chrome.dispose();
  }
});
test('leaving the application hides promptly; hovering controls, opening menus and seeking preserve controls',()=>{
  const f=fixture();f.chrome.setReady(true);
  f.chrome.pointer({insideApp:true,insideVideo:false,changed:true});f.advance(5000);assert.equal(f.chrome.getState().hidden,false);
  f.chrome.pointer({insideApp:false,insideVideo:false,changed:true});f.advance(149);assert.equal(f.chrome.getState().hidden,false);f.advance(1);assert.equal(f.chrome.getState().hidden,true);
  f.chrome.hold('panel',true);assert.equal(f.chrome.getState().hidden,false);f.advance(5000);assert.equal(f.chrome.getState().hidden,false);
  f.chrome.hold('seek',true);f.chrome.hold('panel',false);assert.equal(f.timers.size,0);
  f.chrome.hold('seek',false);f.advance(150);assert.equal(f.chrome.getState().hidden,true);
  f.chrome.setReady(false);assert.equal(f.chrome.getState().hidden,false);assert.equal(f.timers.size,0);
  f.chrome.pointer(null);f.chrome.dispose();
});
test('disposing cancels an already armed hide and rejects stale callbacks',()=>{
  const f=fixture();f.chrome.setReady(true);const late=[...f.timers.values()][0].callback;
  f.chrome.dispose();assert.equal(f.timers.size,0);late();f.chrome.activity();f.chrome.hold('panel',true);f.chrome.pointer({insideApp:false});assert.deepEqual(f.changes,[]);
});
