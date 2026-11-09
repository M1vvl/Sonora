'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../ui/dashboard-state.js');
function fixture(options={}){
  const timers=new Map(),listeners=new Map(),saved=[],sync=[],errors=[];let nextId=0,value={selected:'a'},captures=0;
  const view={setTimeout(callback){const id=++nextId;timers.set(id,callback);return id;},clearTimeout(id){timers.delete(id);},addEventListener(name,callback){listeners.set(name,callback);},removeEventListener(name,callback){if(listeners.get(name)===callback)listeners.delete(name);}};
  const controller=create({view,capture(){captures++;return value;},save(input){saved.push(input);},flushSync(input){sync.push(input);},onError:error=>errors.push(error),...options});
  return {controller,timers,listeners,saved,sync,errors,get captures(){return captures;},set(valueNext){value=valueNext;},tick(){for(const [id,callback]of [...timers]){timers.delete(id);callback();}},exit(){listeners.get('beforeunload')?.();}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('dashboard persistence stays inert until hydration starts and owns one trailing timer',async()=>{
  const f=fixture();f.controller.schedule();assert.equal(f.timers.size,0);assert.equal(await f.controller.flush(),false);assert.equal(f.captures,0);
  f.controller.start();for(let i=0;i<12;i++){f.set({selected:String(i)});f.controller.schedule();assert.equal(f.timers.size,1);}
  assert.equal(f.saved.length,0);f.tick();await settle();assert.deepEqual(f.saved,[{selected:'11'}]);assert.equal(f.timers.size,0);f.controller.dispose();
});

test('flush captures fresh state and cancels scheduled work; equivalent updates do not write again',async()=>{
  const f=fixture();f.controller.start();f.controller.schedule();f.set({selected:'latest'});assert.equal(await f.controller.flush(),true);
  assert.equal(f.timers.size,0);assert.deepEqual(f.saved,[{selected:'latest'}]);f.controller.schedule();f.tick();await settle();assert.equal(f.saved.length,1);f.controller.dispose();
});

test('capture is copied so later UI mutation cannot change an already submitted state',async()=>{
  const state={scroll:{sessions:10}},f=fixture();f.set(state);f.controller.start();await f.controller.flush();state.scroll.sessions=99;assert.equal(f.saved[0].scroll.sessions,10);f.controller.dispose();
});

test('exit captures pending changes synchronously and leaves no delayed or queued saves',async()=>{
  const pending=[];const f=fixture({save:input=>new Promise(resolve=>pending.push({input,resolve}))});f.controller.start();
  const first=f.controller.flush();assert.equal(pending.length,1);f.set({selected:'exit'});f.controller.schedule();f.exit();assert.equal(f.timers.size,0);assert.deepEqual(f.sync,[{selected:'exit'}]);
  pending[0].resolve();await first;await settle();assert.equal(pending.length,1,'old save completion never schedules another write');f.controller.dispose();
});

test('new submissions happen immediately and obsolete async errors cannot invalidate the latest state',async()=>{
  const pending=[],f=fixture({save:input=>new Promise((resolve,reject)=>pending.push({input,resolve,reject}))});f.controller.start();
  const a=f.controller.flush();f.set({selected:'b'});const b=f.controller.flush();assert.deepEqual(pending.map(item=>item.input),[{selected:'a'},{selected:'b'}]);
  pending[1].resolve();assert.equal(await b,true);pending[0].reject(new Error('obsolete'));assert.equal(await a,false);assert.equal(f.errors.length,0);assert.equal(await f.controller.flush(),true);assert.equal(pending.length,2);f.controller.dispose();
});

test('failed writes and IPC error results remain retryable and report only current failures',async()=>{
  let attempts=0;const f=fixture({save(){attempts++;return attempts===1?{error:'disk full'}:undefined;}});f.controller.start();assert.equal(await f.controller.flush(),false);assert.equal(f.errors.length,1);assert.equal(await f.controller.flush(),true);assert.equal(attempts,2);f.controller.dispose();
});

test('capture errors and synchronous write failures do not escape event handlers',async()=>{
  let broken=true;const f=fixture({capture(){if(broken)throw new Error('capture failed');return {selected:'a'};},flushSync(){throw new Error('sync failed');}});
  f.controller.start();assert.equal(await f.controller.flush(),false);assert.equal(f.errors.length,1);broken=false;assert.doesNotThrow(()=>f.exit());assert.equal(f.errors.length,2);f.controller.dispose();
});

test('dispose removes exit listeners and pending timers and suppresses late callbacks',async()=>{
  let reject;const f=fixture({save:()=>new Promise((_resolve,no)=>{reject=no;})});f.controller.start();const pending=f.controller.flush();f.controller.schedule();
  f.controller.dispose();f.controller.dispose();assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);reject(new Error('late'));assert.equal(await pending,false);assert.equal(f.errors.length,0);
  f.controller.start();f.controller.schedule();assert.equal(f.timers.size,0);assert.equal(await f.controller.flush(),false);
});
