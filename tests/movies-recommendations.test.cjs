'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRecommendations}=require('../src/movies/recommendations.cjs');
const film=(id,score=8)=>({id:String(id),title:'电影'+id,score});
test('movie deck appends only rated films and preserves previous randomized identities on backward reads',async()=>{
  const calls=[];const deck=createRecommendations({batchSize:3,random:()=>.1,loadPage:async offset=>{calls.push(offset);return {items:offset?[film(4),film(5),film(1)]:[film(1),film(2),film(3,7.4)],nextOffset:offset+24,hasMore:offset===0};}});
  const first=await deck.request({offset:0}),ids=first.items.map(value=>value.id);
  assert(first.items.every(value=>value.score>=7.5));assert.equal(new Set(first.items.map(value=>value.id)).size,first.items.length);
  const next=await deck.request({offset:3});assert(next.items.length>0);assert.equal(next.hasMore,false);
  assert.deepEqual((await deck.request({offset:0})).items.map(value=>value.id),ids);assert.deepEqual(calls,[0,24]);deck.dispose();
});
test('a sparse high-score catalog advances in bounded rounds and never substitutes lower scores',async()=>{
  let calls=0;const deck=createRecommendations({loadPage:async offset=>{calls++;return {items:[film(offset,6)],nextOffset:offset+24,hasMore:true};}});
  assert.deepEqual((await deck.request()).items,[]);assert.equal(calls,3);assert.equal(deck.getStatus().cursor,72);
  await deck.request();assert.equal(calls,6);deck.dispose();
});
test('deck caps a visit and canceled late responses cannot change retained positions',async()=>{
  let finish;const deck=createRecommendations({maxItems:3,batchSize:2,loadPage:async()=>new Promise(resolve=>finish=resolve)});
  deck.seed([film(1),film(2)]);const pending=deck.request({offset:2});deck.cancel();finish({items:[film(3)],nextOffset:24,hasMore:true});await assert.rejects(pending,{name:'AbortError'});assert.equal(deck.getStatus().items,2);
  deck.seed([film(3),film(4)]);assert.equal(deck.getStatus().items,3);assert.equal((await deck.request({offset:2})).hasMore,false);deck.dispose();
});
