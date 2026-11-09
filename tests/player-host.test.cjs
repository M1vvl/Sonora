'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createPlayerHost}=require('../src/player-host.cjs');
function fixture(){
  const owner=new EventEmitter(),children=[];let fullscreen=false,closed=false,count=0;
  Object.assign(owner,{isDestroyed:()=>closed,getContentSize:()=>[1280,850],getBounds:()=>({x:100,y:100,width:1280,height:850}),isFullScreen:()=>fullscreen,getNativeWindowHandle:()=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(123456n);return b;},contentView:{addChildView:v=>children.push(v),removeChildView:v=>children.splice(children.indexOf(v),1)}});
  class WebContentsView{constructor(){count++;this.webContents={isDestroyed:()=>false,close:()=>{this.closed=true;}};}setBounds(bounds){this.bounds=bounds;}setBackgroundColor(){}}
  const host=createPlayerHost({electron:{WebContentsView,screen:{getDisplayMatching:()=>({scaleFactor:1.5})}},getWindow:()=>owner,preload:'fixed-local-preload.cjs'});
  return {host,owner,children,getCount:()=>count,setFullscreen:v=>{fullscreen=v;owner.emit(v?'enter-full-screen':'leave-full-screen');},setClosed:()=>closed=true};
}
test('player covers the entire original main window including the right rail',()=>{
  const f=fixture();const first=f.host.attach({});assert.equal(f.host.attach({}),first);assert.equal(f.getCount(),1);assert.equal(f.children.length,1);assert.deepEqual(f.host.getBounds(),{x:0,y:0,width:1280,height:850});assert.equal(f.host.hwnd(),'123456');
  const rect=f.host.viewport({x:20,y:56,width:1000,height:640,visible:false});assert.deepEqual(rect,{x:30,y:84,width:1500,height:960,visible:false});assert.throws(()=>f.host.viewport({x:NaN,y:0,width:1,height:1}));
  f.host.detach();assert.equal(f.children.length,0);assert.equal(f.owner.listenerCount('resize'),0);assert.equal(f.host.getContents(),null);
});
test('fullscreen fills the same dashboard and viewport clamps to its owned area',()=>{
  const f=fixture();f.host.attach({});f.setFullscreen(true);assert.deepEqual(f.host.getBounds(),{x:0,y:0,width:1280,height:850});const rect=f.host.viewport({x:1200,y:820,width:1000,height:1000});assert.equal(rect.width,120);assert.equal(rect.height,45);f.setFullscreen(false);assert.deepEqual(f.host.getBounds(),{x:0,y:0,width:1280,height:850});f.host.detach();
});
