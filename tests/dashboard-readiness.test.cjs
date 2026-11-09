'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {attachDashboardReadiness}=require('../src/dashboard-readiness.cjs');

function fixture() {
  const window=new EventEmitter(),web=new EventEmitter(),tasks=new Map(),calls=[];
  let serial=0,destroyed=false;
  window.webContents=web;window.isDestroyed=web.isDestroyed=()=>destroyed;
  web.invalidate=()=>calls.push('paint');
  const control=attachDashboardReadiness({window,onReady:()=>calls.push('ready'),onLoading:reason=>calls.push(reason),onTimeout:()=>calls.push('timeout'),setTimer:fn=>{const id=++serial;tasks.set(id,fn);return id;},clearTimer:id=>tasks.delete(id)});
  return {window,web,control,tasks,calls,destroy(){destroyed=true;window.emit('closed');},expire(){const batch=[...tasks.values()];tasks.clear();batch.forEach(fn=>fn());},ready(){web.emit('did-finish-load');window.emit('ready-to-show');control.markRendererReady();}};
}

test('dashboard waits for local workspace initialization after the document loads',()=>{
  const f=fixture();f.web.emit('did-finish-load');f.window.emit('ready-to-show');
  assert.equal(f.control.isReady(),false);assert.deepEqual(f.calls,[]);
  f.control.markRendererReady();assert.equal(f.control.isReady(),true);assert.deepEqual(f.calls,['paint','ready']);assert.equal(f.tasks.size,0);
  f.control.markRendererReady();f.web.emit('did-finish-load');assert.deepEqual(f.calls,['paint','ready']);f.destroy();
});

test('renderer handshake can precede load and native paint without revealing a blank window',()=>{
  const f=fixture();f.control.markRendererReady();f.window.emit('ready-to-show');assert.equal(f.control.isReady(),false);
  f.web.emit('did-finish-load');assert.equal(f.control.isReady(),true);assert.equal(f.calls.filter(value=>value==='ready').length,1);f.destroy();
});

test('a hidden transparent window can initialize when ready-to-show never fires',()=>{
  const f=fixture();f.web.emit('did-finish-load');f.control.markRendererReady();
  assert.equal(f.control.isReady(),true);assert.equal(f.control.getStatus().nativePainted,false);
  assert.deepEqual(f.calls,['paint','ready']);assert.equal(f.tasks.size,0);
  f.expire();assert(!f.calls.includes('timeout'));f.destroy();
});

test('crash and full main navigation revoke a stale ready flag and require a new handshake',()=>{
  const f=fixture();f.ready();f.calls.length=0;
  f.web.emit('render-process-gone',{}, {reason:'crashed'});assert.equal(f.control.isReady(),false);assert.equal(f.control.repaint(),false);
  f.web.emit('did-start-navigation',{},'file:///dashboard.html',false,true);f.web.emit('did-finish-load');
  assert.equal(f.control.isReady(),false);f.control.markRendererReady();assert.equal(f.control.isReady(),true);
  assert.deepEqual(f.calls,['renderer-gone','navigation','paint','ready']);f.destroy();
});

test('subframes, same-document navigation and aborted loads preserve the existing music owner',()=>{
  const f=fixture();f.ready();f.calls.length=0;
  f.web.emit('did-start-navigation',{},'about:blank',false,false);
  f.web.emit('did-start-navigation',{},'file:///dashboard.html#section',true,true);
  f.web.emit('did-fail-load',{},-2,'subframe failed','about:blank',false);
  f.web.emit('did-fail-load',{},-3,'aborted','file:///dashboard.html',true);
  f.window.emit('hide');f.window.emit('show');assert.equal(f.control.isReady(),true);assert.equal(f.tasks.size,0);
  f.control.repaint();assert.deepEqual(f.calls,['paint']);f.destroy();
});

test('initialization deadline fires once and delegates bounded recovery without polling',()=>{
  const f=fixture();assert.equal(f.tasks.size,1);f.expire();f.expire();assert.deepEqual(f.calls,['timeout']);assert.equal(f.tasks.size,0);
  f.web.emit('did-start-navigation',{},'file:///dashboard.html',false,true);assert.equal(f.tasks.size,1);f.ready();f.expire();assert.equal(f.calls.filter(value=>value==='timeout').length,1);f.destroy();
});

test('main load failure revokes ready and closing clears all listeners and deadlines',()=>{
  const f=fixture();f.ready();f.web.emit('did-fail-load',{},-2,'failed','file:///dashboard.html',true);
  assert.equal(f.control.isReady(),false);assert.equal(f.tasks.size,1);f.destroy();
  assert.equal(f.tasks.size,0);assert.equal(f.web.listenerCount('did-start-navigation'),0);assert.equal(f.web.listenerCount('did-finish-load'),0);assert.equal(f.window.listenerCount('ready-to-show'),0);assert.equal(f.control.markRendererReady(),false);
});
