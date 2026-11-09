'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../ui/music/remote-clock.js');
test('real remote samples advance smoothly without extending stale or buffering time',()=>{
 let now=0;const clock=create({now:()=>now});clock.update(12,180,true);now=250;assert.equal(clock.position(),12.25);clock.update(12,180,true);now=750;assert.equal(clock.position(),12.75);
 now=2000;assert.equal(clock.position(),13.1);now=3000;clock.update(12,180,true);assert.equal(clock.position(),13.1);
 clock.update(13,180,true);now=3250;assert.equal(clock.position(),13.25);clock.update(13,180,false);now=8000;assert.equal(clock.position(),13);
 clock.update(42,180,true);assert.equal(clock.position(),42);clock.update(179.9,180,true);now+=500;assert.equal(clock.position(),180);clock.reset();assert.equal(clock.position(),0);
});
