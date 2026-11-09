'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {create}=require('../ui/movies/carousel.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const film=id=>({id:String(id),score:8});
function fixture(load){
  const dom=new JSDOM('<section id="root"></section>',{pretendToBeVisual:true}),root=dom.window.document.getElementById('root'),opened=[];
  const ui=create({root,load,renderItem:item=>`<button data-movie-card="${item.id}">${item.id}</button>`,onOpen:item=>opened.push(item.id)}),viewport=root.querySelector('.movie-carousel-viewport');
  Object.defineProperties(viewport,{clientWidth:{value:400},scrollWidth:{get:()=>root.querySelectorAll('[data-movie-card]').length*200}});
  const event=(type,data)=>{const event=new dom.window.Event(type,{bubbles:true,cancelable:true});for(const [key,value]of Object.entries(data))Object.defineProperty(event,key,{value});viewport.dispatchEvent(event);};
  return {dom,root,ui,viewport,opened,event,close(){ui.dispose();dom.window.close();}};
}
test('horizontal film deck appends on demand, keeps old nodes and retains its scroll position after navigation',async()=>{
  const calls=[],f=fixture(async({offset})=>{calls.push(offset);return {items:[film(offset+1),film(offset+2),film(offset+3)],nextOffset:offset+3,hasMore:offset===0};});
  try{f.ui.activate();await tick();const first=f.root.querySelector('[data-movie-card]');f.viewport.scrollLeft=240;f.viewport.dispatchEvent(new f.dom.window.Event('scroll'));await tick();assert.deepEqual(calls,[0,3]);assert.equal(f.root.querySelector('[data-movie-card]'),first);assert.equal(f.root.querySelectorAll('[data-movie-card]').length,6);f.ui.deactivate();f.ui.activate();assert.equal(f.viewport.scrollLeft,240);assert.deepEqual(f.ui.getState().items.map(value=>value.id),['1','2','3','4','5','6']);}finally{f.close();}
});
test('whole-card left and right dragging scrolls without opening a movie, ordinary click still opens',async()=>{
  const f=fixture(async()=>({items:Array.from({length:8},(_,index)=>film(index+1)),nextOffset:8,hasMore:false}));
  try{f.ui.activate();await tick();f.event('pointerdown',{button:0,pointerId:1,clientX:200,clientY:50,timeStamp:1});f.event('pointermove',{pointerId:1,clientX:80,clientY:52,timeStamp:20});f.event('pointerup',{pointerId:1,timeStamp:21});assert.equal(f.viewport.scrollLeft,120);f.root.querySelector('[data-movie-card]').click();assert.deepEqual(f.opened,[]);f.ui.deactivate();f.ui.activate();await new Promise(resolve=>setTimeout(resolve,460));f.root.querySelector('[data-movie-card]').click();assert.deepEqual(f.opened,['1']);f.event('pointerdown',{button:0,pointerId:2,clientX:80,clientY:50,timeStamp:500});f.event('pointermove',{pointerId:2,clientX:160,clientY:51,timeStamp:520});f.event('pointercancel',{pointerId:2,timeStamp:521});assert(f.viewport.scrollLeft<120);}finally{f.close();}
});
