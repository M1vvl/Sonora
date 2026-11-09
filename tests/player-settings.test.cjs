'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DEFAULT_PLAYER_SETTINGS,SHADER_PRESETS,sanitizePlayerSettings,shaderPaths,createPlayerSettings}=require('../src/player-settings.cjs');

test('Kazumi modes preserve ordered, immutable shader chains and explicit off clears all shaders',()=>{
  assert.equal(SHADER_PRESETS.efficiency.length,7);assert.equal(SHADER_PRESETS.quality.length,6);
  assert.deepEqual(SHADER_PRESETS.efficiency.slice(0,4),['Anime4K_Clamp_Highlights.glsl','Anime4K_Restore_CNN_M.glsl','Anime4K_Restore_CNN_S.glsl','Anime4K_Upscale_CNN_x2_M.glsl']);
  assert.deepEqual(SHADER_PRESETS.quality.slice(0,3),['Anime4K_Clamp_Highlights.glsl','Anime4K_Restore_CNN_VL.glsl','Anime4K_Upscale_CNN_x2_VL.glsl']);
  assert(Object.isFrozen(SHADER_PRESETS));assert(Object.values(SHADER_PRESETS).every(Object.isFrozen));
  assert.deepEqual(shaderPaths('off'),[]);assert.throws(()=>shaderPaths('__proto__',os.tmpdir()));
  assert.throws(()=>shaderPaths('quality','relative'));assert.throws(()=>shaderPaths('quality',path.join(os.tmpdir(),'bad;other')));
  const list=shaderPaths('quality',os.tmpdir());assert(list.every(path.isAbsolute));assert.equal(path.basename(list.at(-1)),'Anime4K_Upscale_CNN_x2_M.glsl');
});
test('playback settings clamp finite numeric ranges, reject invalid enum/code values, and leave unrelated fields out',()=>{
  assert.equal(DEFAULT_PLAYER_SETTINGS.superResolution,'quality');assert.equal(DEFAULT_PLAYER_SETTINGS.outputResolution,'2160p');assert.equal(DEFAULT_PLAYER_SETTINGS.volume,100);
  assert.deepEqual(sanitizePlayerSettings({speed:8,volume:-1,brightness:1000,contrast:-1000,command:'quit'}),{...DEFAULT_PLAYER_SETTINGS,speed:3,volume:0,brightness:100,contrast:-100});
  assert.throws(()=>sanitizePlayerSettings({superResolution:'CSS-sharp'}));assert.throws(()=>sanitizePlayerSettings({aspect:'fake'}));
  assert.throws(()=>sanitizePlayerSettings({volume:NaN}));assert.throws(()=>sanitizePlayerSettings({speed:Infinity}));assert.throws(()=>sanitizePlayerSettings({volume:'70'}));assert.throws(()=>sanitizePlayerSettings({mute:1}));
  assert.equal(sanitizePlayerSettings({aspect:'4:3',gamma:0.5}).aspect,'4:3');
  assert.equal(sanitizePlayerSettings({aspect:'fill'}).aspect,'fill');
});
test('preview neither changes memory nor writes a file; successful preferences round-trip separately from monitor state',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-player-settings-')),file=path.join(directory,'player.json');
  try{
    const settings=createPlayerSettings(file);assert.equal(fs.existsSync(file),false);
    assert.equal(settings.preview({superResolution:'efficiency'}).superResolution,'efficiency');assert.equal(settings.get().superResolution,'quality');assert.equal(fs.existsSync(file),false);
    settings.save({superResolution:'quality',aspect:'16:9',volume:55});const returned=settings.get();returned.volume=0;assert.equal(settings.get().volume,55);
    assert.deepEqual(createPlayerSettings(file).get(),{...DEFAULT_PLAYER_SETTINGS,superResolution:'quality',aspect:'16:9',volume:55});
    const previous=fs.readFileSync(file,'utf8');assert.throws(()=>settings.save({superResolution:'unknown'}));assert.equal(fs.readFileSync(file,'utf8'),previous);
    fs.writeFileSync(file,'malformed');assert.deepEqual(createPlayerSettings(file).get(),DEFAULT_PLAYER_SETTINGS);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});


test('legacy defaults migrate to the requested best quality once while new-schema explicit choices remain preserved',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-output-legacy-')),file=path.join(directory,'player.json');
  try{fs.writeFileSync(file,JSON.stringify({superResolution:'off',volume:27}));const current=createPlayerSettings(file);assert.equal(current.get().superResolution,'quality');assert.equal(current.get().outputResolution,'2160p');assert.equal(current.get().volume,27);assert.throws(()=>current.preview({outputResolution:'8k-fiction'}));current.save({outputResolution:'1080p',superResolution:'off'});const reopened=createPlayerSettings(file).get();assert.equal(reopened.outputResolution,'1080p');assert.equal(reopened.superResolution,'off');assert.equal(reopened.volume,27);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
