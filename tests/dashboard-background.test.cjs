'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {attachDashboardLifecycle}=require('../src/dashboard-lifecycle.cjs');
test('closing a dashboard preserves a pending or prepared music owner and reports native visibility',()=>{
  const window=new EventEmitter(),calls=[];let playing=true,quitting=false;
  window.hide=()=>{calls.push('hide');window.emit('hide');};
  attachDashboardLifecycle({window,isQuitting:()=>quitting,hasPlayback:()=>playing,onBackground:()=>calls.push('background'),onClose:()=>calls.push('cancel'),onVideoClose:()=>calls.push('video-close'),onVisibility:visible=>calls.push(visible)});
  const event={preventDefault(){calls.push('prevent');}};
  window.emit('close',event);assert.deepEqual(calls,['video-close','prevent','background','hide',false]);
  calls.length=0;window.emit('show');assert.deepEqual(calls,[true]);
  calls.length=0;playing=false;window.emit('close',event);assert.deepEqual(calls,['video-close','cancel']);
  calls.length=0;quitting=true;window.emit('close',event);assert.deepEqual(calls,[]);
  window.emit('closed');assert.equal(window.listenerCount('close'),0);assert.equal(window.listenerCount('hide'),0);
});
