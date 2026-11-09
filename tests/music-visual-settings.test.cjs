'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {normalize,DEFAULTS}=require('../ui/music/visual-settings.js'),{createVisualSettings}=require('../src/music/visual-settings.cjs');
test('visual preferences whitelist scalar bounds and reject media, credentials and invalid CSS',()=>{const result=normalize({fontSize:999,particleCount:999,fps:120,backgroundColor:'url(secret)',preset:'unknown',cookie:'secret',media:'file://secret',lyricMotion:false,backgroundZoom:NaN});assert.equal(result.fontSize,64);assert.equal(result.particleCount,undefined);assert.equal(result.fps,60);assert.equal(result.backgroundColor,DEFAULTS.backgroundColor);assert.equal(result.preset,DEFAULTS.preset);assert.equal(result.lyricMotion,false);assert(!JSON.stringify(result).includes('secret'));});
test('visual preferences survive restart in independent small storage',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-visuals-'));try{const store=createVisualSettings(dir);store.save({preset:'planet',fontSize:32,accent:'#aabbcc'});assert.equal(createVisualSettings(dir).read().preset,'cover');assert.equal(createVisualSettings(dir).read().fontSize,32);assert.deepEqual(fs.readdirSync(dir),['music-visuals.json']);assert(fs.statSync(path.join(dir,'music-visuals.json')).size<16384);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('removed global glass cannot override the dedicated transport default',()=>{const settings=normalize({glassOpacity:.9,backgroundMode:'wallpaper',preset:'removed'});assert.equal(settings.transportGlass,.2);assert.equal(settings.glassOpacity,undefined);assert.equal(settings.backgroundMode,undefined);assert.equal(settings.preset,'cover');assert.equal(normalize({transportGlass:.55}).transportGlass,.55);});
test('font twenty migrates only the old default while retaining custom settings on restart',()=>{assert.equal(normalize().fontSize,20);const migrated=normalize({sourceSchemaVersion:1,fontSize:27});assert.equal(migrated.fontSize,20);assert.equal(migrated.sourceSchemaVersion,2);assert.equal(normalize(migrated).fontSize,20);assert.equal(normalize({sourceSchemaVersion:1,fontSize:32}).fontSize,32);assert.equal(normalize({sourceSchemaVersion:2,fontSize:27}).fontSize,27);});
test('visual preset toggle defaults on and persists separately from lyric visibility',()=>{
  assert.equal(normalize().visualEnabled,true);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sonara-visual-toggle-'));
  try{
    createVisualSettings(dir).save({visualEnabled:false,lyricMode:'immersive'});
    const settings=createVisualSettings(dir).read();
    assert.equal(settings.visualEnabled,false);
    assert.equal(settings.lyricMode,'immersive');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('original Sonic selection persists and rejects removed presets',()=>{
  assert.equal(normalize().preset,'cover');
  assert.equal(normalize({preset:'invalid'}).preset,'cover');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sonara-stage-style-'));
  try{
    createVisualSettings(dir).save({preset:'topography',visualEnabled:true,lyricMode:'immersive'});
    const restored=createVisualSettings(dir).read();
    assert.equal(restored.preset,'topography');
    assert.equal(restored.visualEnabled,true);
    assert.equal(restored.lyricMode,'immersive');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
