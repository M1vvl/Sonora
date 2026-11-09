'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {attachDashboardFullscreen}=require('../src/dashboard-fullscreen.cjs');
test('native Escape exits fullscreen regardless of renderer focus and releases listeners',()=>{
  const window=new EventEmitter(),web=new EventEmitter(),messages=[];let fullscreen=true,prevented=false;
  Object.assign(window,{webContents:web,isDestroyed:()=>false,isFullScreen:()=>fullscreen,setFullScreen:value=>{fullscreen=value;window.emit(value?'enter-full-screen':'leave-full-screen');}});Object.assign(web,{isDestroyed:()=>false,send:(channel,value)=>messages.push({channel,value})});
  attachDashboardFullscreen(window);web.emit('before-input-event',{preventDefault(){prevented=true;}},{type:'keyDown',key:'Escape'});assert.equal(prevented,true);assert.equal(fullscreen,false);assert.equal(messages.at(-1).value.fullscreen,false);
  prevented=false;web.emit('before-input-event',{preventDefault(){prevented=true;}},{type:'keyDown',key:'Escape'});assert.equal(prevented,false);window.emit('closed');assert.equal(web.listenerCount('before-input-event'),0);assert.equal(window.listenerCount('leave-full-screen'),0);
});
