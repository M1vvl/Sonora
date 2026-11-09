'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyzeSurroundings}=require('../src/glass-appearance.cjs');
const geometry={width:80,height:44,padding:10};
function pixels(color){const bytes=new Uint8Array(100*64*4);for(let i=0;i<bytes.length;i+=4){bytes[i]=bytes[i+1]=bytes[i+2]=color;bytes[i+3]=255;}return bytes;}
test('exterior brightness chooses contrasting ink while interior contents cannot influence the decision',()=>{
 const bytes=pixels(245),initial=analyzeSurroundings(bytes,geometry);assert.equal(initial.ink,'dark');assert.equal(initial.tint,.06);
 for(let y=10;y<54;y++)for(let x=10;x<90;x++)bytes.fill(0,(y*100+x)*4,(y*100+x)*4+3);
 assert.deepEqual(analyzeSurroundings(bytes,geometry),initial);assert.equal(analyzeSurroundings(pixels(10),geometry).ink,'light');
});
test('busy surroundings increase tint within bounds and threshold hysteresis prevents flicker',()=>{
 const bytes=pixels(0);for(let i=0;i<bytes.length;i+=8)bytes[i]=bytes[i+1]=bytes[i+2]=255;
 const result=analyzeSurroundings(bytes,geometry);assert(result.tint>.06&&result.tint<=.22);
 assert.equal(analyzeSurroundings(pixels(145),geometry,{ink:'dark',luminance:.57}).ink,'dark');assert.equal(analyzeSurroundings(pixels(145),geometry,{ink:'light',luminance:.57}).ink,'light');
 assert.equal(analyzeSurroundings(new Uint8Array(3),geometry),null);
});
