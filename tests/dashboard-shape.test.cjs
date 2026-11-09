'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {DASHBOARD_RADIUS,shapeGeometry,attachDashboardShape}=require('../src/dashboard-shape.cjs');

function fixture({bits=64,native:overrides={}}={}) {
  const window=new EventEmitter(),screen=new EventEmitter(),calls=[],timers=new Map();
  window.webContents=new EventEmitter();
  let timerId=0,regionId=0;
  const value={destroyed:false,maximized:false,fullscreen:false,dpi:96,rect:{left:-1260,top:0,right:0,bottom:850}};
  const handle=Buffer.alloc(bits===32?4:8);if (bits===32) handle.writeUInt32LE(123);else handle.writeBigUInt64LE(123n);
  Object.assign(window,{getNativeWindowHandle:()=>handle,isDestroyed:()=>value.destroyed,isMaximized:()=>value.maximized,isFullScreen:()=>value.fullscreen});
  const native={
    getRect:()=>({...value.rect}),getDpi:()=>value.dpi,
    setCornerPreference:(hwnd,preference)=>{calls.push(['corner',hwnd,preference]);return true;},
    setBorderColor:(hwnd,color)=>{calls.push(['border',hwnd,color]);return true;},
    createRegion:(width,height,diameter)=>{const id=++regionId;calls.push(['create',id,width,height,diameter]);return id;},
    setRegion:(hwnd,region)=>{calls.push(['set',hwnd,region]);return true;},
    deleteRegion:region=>calls.push(['delete',region]),...overrides
  };
  const updates=[];
  const shape=attachDashboardShape({window,screen,native,platform:'win32',onGeometry:geometry=>updates.push(geometry),setTimer:callback=>{const id=++timerId;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
  return {window,screen,value,calls,timers,updates,shape,flush(){for(const [id,callback] of [...timers]){timers.delete(id);callback();}}};
}

test('shape geometry uses physical window dimensions and a DPI-scaled 24 DIP radius',()=>{
  assert.equal(DASHBOARD_RADIUS,24);
  for (const dpi of [96,120,144,192]) {
    const shape=shapeGeometry({left:-100,top:80,right:2420,bottom:1780},dpi);
    assert.equal(shape.width,2520);assert.equal(shape.height,1700);assert.equal(shape.radius,Math.round(24*dpi/96));assert.equal(shape.radiusDIP,24);
  }
  assert.equal(shapeGeometry({left:0,top:0,right:20,bottom:10},192).radius,5);
  assert.equal(shapeGeometry({left:0,top:0,right:100,bottom:80},192,true).radius,0);
  assert.equal(shapeGeometry({left:0,top:0,right:100,bottom:80},NaN).dpi,96);
  for (const right of [0,-1,NaN,Infinity,100000]) assert.throws(()=>shapeGeometry({left:0,top:0,right,bottom:80},96),/invalid/);
});

test('both Windows handle sizes transfer their real rounded region to the OS without deleting it',()=>{
  for (const bits of [32,64]) {
    const f=fixture({bits});
    assert.deepEqual(f.calls,[['corner',123n,1],['border',123n,0xfffffffe],['create',1,1260,850,48],['set',123n,1]]);
    assert.equal(f.shape.getStatus().nativeRegion,true);assert.equal(f.shape.getStatus().rounded,true);
    assert.equal(f.shape.getStatus().borderSuppressed,true);
    assert.equal(f.updates[0].radiusDIP,24);f.value.destroyed=true;f.window.emit('closed');assert(!f.calls.some(row=>row[0]==='delete'));
  }
});

test('a rejected or throwing SetWindowRgn frees only the still-owned candidate',()=>{
  for (const setRegion of [()=>false,()=>{throw new Error('synthetic native failure');}]) {
    const f=fixture({native:{setRegion}});
    assert.deepEqual(f.calls.at(-1),['delete',1]);assert.equal(f.shape.getStatus().nativeRegion,false);assert(f.shape.getStatus().error);
    f.value.destroyed=true;f.shape.dispose();
  }
});

test('a rejected DWM hint does not replace the required native clip with an optimistic CSS-only claim',()=>{
  const f=fixture({native:{setCornerPreference:()=>false}});
  assert.equal(f.shape.getStatus().cornerPreferenceAccepted,false);assert.equal(f.shape.getStatus().nativeRegion,true);
  f.value.destroyed=true;f.shape.dispose();
});

test('an unsupported border color attribute preserves native clipping and reports the limitation',()=>{
  const f=fixture({native:{setBorderColor:()=>false}});
  assert.equal(f.shape.getStatus().borderSuppressed,false);assert.equal(f.shape.getStatus().nativeRegion,true);
  f.value.destroyed=true;f.shape.dispose();
});

test('resize storms coalesce and moving within the same DPI does not allocate new GDI regions',()=>{
  const f=fixture();f.calls.length=0;
  for (let index=0;index<20;index++) f.window.emit('resize');
  assert.equal(f.timers.size,1);f.flush();assert.equal(f.calls.length,0);
  f.value.rect.right=100;f.window.emit('resize');f.window.emit('resized');f.flush();
  assert(f.calls.some(row=>row[0]==='create'&&row[2]===1360));
  f.calls.length=0;f.value.rect.left+=50;f.value.rect.right+=50;f.window.emit('move');f.flush();assert.equal(f.calls.length,0);
  f.value.destroyed=true;f.shape.dispose();
});

test('moving across DPI and display metric changes update the physical radius once',()=>{
  const f=fixture();f.calls.length=0;f.value.dpi=144;
  f.window.emit('move');f.screen.emit('display-metrics-changed');f.flush();
  assert.deepEqual(f.calls.find(row=>row[0]==='create'),['create',2,1260,850,72]);
  assert.equal(f.shape.getStatus().radiusDIP,24);f.value.destroyed=true;f.shape.dispose();
});

test('maximized and full-screen windows clear the rounded region and restoration reinstates it',()=>{
  const f=fixture();f.calls.length=0;f.value.maximized=true;f.window.emit('maximize');f.flush();
  assert.deepEqual(f.calls,[['corner',123n,1],['border',123n,0xfffffffe],['set',123n,null]]);assert.equal(f.shape.getStatus().radiusDIP,0);
  f.calls.length=0;f.value.maximized=false;f.value.fullscreen=true;f.window.emit('enter-full-screen');f.flush();assert.equal(f.calls.length,0);
  f.value.fullscreen=false;f.window.emit('leave-full-screen');f.flush();assert(f.calls.some(row=>row[0]==='create'));assert.equal(f.shape.getStatus().radiusDIP,24);
  f.value.destroyed=true;f.shape.dispose();
});

test('closing releases its single pending update and all window/display listeners',()=>{
  const f=fixture();f.window.emit('resize');assert.equal(f.timers.size,1);
  f.value.destroyed=true;f.window.emit('closed');assert.equal(f.timers.size,0);assert.equal(f.window.eventNames().length,0);assert.equal(f.screen.eventNames().length,0);assert.equal(f.window.webContents.eventNames().length,0);
  const count=f.calls.length;f.shape.update();f.shape.dispose();assert.equal(f.calls.length,count);assert.equal(f.shape.getStatus().disposed,true);
});

test('explicit disposal clears its native region without touching whole-window opacity or other windows',()=>{
  const f=fixture();f.calls.length=0;f.shape.dispose();
  assert.deepEqual(f.calls,[['set',123n,null],['corner',123n,0],['border',123n,0xffffffff]]);assert.equal(f.window.eventNames().length,0);
});

test('show, restore, first presentation and activation rebuild native framing even at unchanged geometry',()=>{
  const f=fixture();
  for (const event of ['show','ready-to-show','restore','focus','blur']) {
    f.calls.length=0;f.window.emit(event);f.flush();
    assert(f.calls.some(row=>row[0]==='create'),event);assert(f.calls.some(row=>row[0]==='border'&&row[2]===0xfffffffe),event);
  }
  f.calls.length=0;f.window.webContents.emit('did-finish-load');f.flush();assert(f.calls.some(row=>row[0]==='create'));
  f.value.destroyed=true;f.shape.dispose();
});

test('a forced presentation joins a pending ordinary resize and can be requested directly',()=>{
  const f=fixture();f.calls.length=0;f.window.emit('resize');f.window.emit('show');f.window.emit('focus');
  assert.equal(f.timers.size,1);f.flush();assert.equal(f.calls.filter(row=>row[0]==='create').length,1);
  f.calls.length=0;f.shape.update(true);assert.equal(f.calls.filter(row=>row[0]==='create').length,1);
  f.value.destroyed=true;f.shape.dispose();
});

test('unsupported platforms do not load or call Windows bindings',()=>{
  const window=new EventEmitter(),updates=[];window.isDestroyed=()=>false;
  const shape=attachDashboardShape({window,platform:'linux',onGeometry:value=>updates.push(value)});
  assert.equal(shape.getStatus().nativeRegion,false);assert.equal(updates[0].radiusDIP,24);shape.dispose();
});
