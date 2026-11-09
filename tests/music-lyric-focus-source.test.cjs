'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {contextStyle}=require('../ui/music/lyric-motion.js');

function fixture({fit=true,throwOnUpdate=false}={}){
  const viewportCalls=[],state={active:false,disposed:false,errors:[]};
  const fx={lyricLiveViewportFit:fit,fontSize:33,lyricColorMode:'custom',lyricColor:'#b0c8da',lyricHighlightMode:'custom',lyricHighlightColor:'#ffd89a'};
  const document={addEventListener(){},fonts:{}},window={document,addEventListener(){},parent:{postMessage(){}}};
  const sandbox={window,document,URLSearchParams,location:{search:'?token=test'},pulseSourceLyricHost:state,fx,scene:{},camera:{},renderer:{},uniforms:{uTime:{value:0}},pulseLyricFontAdd:null,lyricTextMeasureWarmupTimer:0,scheduleLyricTextMeasureWarmup(){},setTimeout:()=>1,clearTimeout(){},lyricBufferedTrackWindow(){},stageLyricPersistentNextTextRunwayRange(){},trimStageLyricPersistentTrackRows(){},lyricQualityPoolBudgetBytes:()=>1024,
    lyricRowLiveViewportScale(row,intendedScale){viewportCalls.push({row,intendedScale});return .8;},
    updateLyricRowLayers(data,options){
      if(throwOnUpdate)throw new Error('source failure');
      data.trackPresentationLineIndex=options.index;
      for(const row of data.rowLayers){
        row.isActive=row.lineIndex===options.index;row.delta=row.lineIndex-options.index;
        const base=row.isActive?1:Math.max(.84,1-Math.min(5.5,Math.abs(row.delta))*.026);
        row.targetScale=base*(fx.lyricLiveViewportFit?sandbox.lyricRowLiveViewportScale(row,base):1);
        row.shownScale+=(row.targetScale-row.shownScale)*.135;
      }
    }
  };
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/music/source-presets/source-lyrics-adapter.js'),'utf8'),sandbox);
  const data={rowLayers:Array.from({length:15},(_,lineIndex)=>({lineIndex,isPrimary:true,shownScale:1}))};
  return {sandbox,fx,data,viewportCalls,update:index=>sandbox.updateLyricRowLayers(data,{index})};
}

test('native row targets match DOM distance hierarchy without increasing authored current scale',()=>{
  const f=fixture();f.update(7);
  assert.equal(f.data.rowLayers[7].targetScale,.8,'existing viewport fit remains in force');
  for(let distance=1;distance<=7;distance++){
    const expected=contextStyle(distance).scale*.8;
    assert(Math.abs(f.data.rowLayers[7-distance].targetScale-expected)<1e-12);
    assert(Math.abs(f.data.rowLayers[7+distance].targetScale-expected)<1e-12);
    assert(f.data.rowLayers[7+distance].targetScale<f.data.rowLayers[7].targetScale);
  }
});

test('source row targets retain their existing interpolation and converge without replacing nodes',()=>{
  const f=fixture({fit:false});f.update(7);const old=f.data.rowLayers[7],next=f.data.rowLayers[8];
  f.update(8);const first=next.shownScale;
  for(let i=0;i<40;i++)f.update(8);
  assert.equal(f.data.rowLayers[7],old);assert.equal(f.data.rowLayers[8],next);assert(next.shownScale>first);assert(next.shownScale<1);assert(old.shownScale<next.shownScale);assert.equal(next.targetScale,1);
  assert.equal(f.viewportCalls.length,0,'disabled viewport fit does not invoke projection work');
  assert.equal(f.fx.lyricLiveViewportFit,false);
});

test('native adaptation restores saved settings, including failure and optional fit state',()=>{
  for(const fit of [true,false,undefined]){
    const f=fixture({fit}),before={...f.fx};f.update(7);assert.deepEqual(f.fx,before);
    const failed=fixture({fit,throwOnUpdate:true}),saved={...failed.fx};assert.throws(()=>failed.update(7),/source failure/);assert.deepEqual(failed.fx,saved);
  }
});
