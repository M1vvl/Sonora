'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {processingShaders,outputSize,targetShaderText}=require('../src/player-output.cjs');
const {DEFAULT_PLAYER_SETTINGS}=require('../src/player-settings.cjs');
test('GPU output targets fit their real bounding rectangles while preserving wide and portrait source aspect',()=>{
  assert.deepEqual(outputSize(1280,720,'1080p'),{width:1920,height:1080});assert.deepEqual(outputSize(1920,1080,'1440p'),{width:2560,height:1440});assert.deepEqual(outputSize(1920,1080,'2160p'),{width:3840,height:2160});assert.deepEqual(outputSize(1920,800,'2160p'),{width:3840,height:1600});assert.deepEqual(outputSize(1080,1920,'1080p'),{width:607,height:1080});assert.equal(outputSize(0,0,'2160p'),null);assert.equal(outputSize(1920,1080,'auto'),null);
});
test('target selection appends a real owned MAIN shader without modifying the imported neural pipeline',()=>{
  const directory=path.resolve('native/player/resources/shaders');
  for(const [mode,width,height]of [['1080p',1920,1080],['1440p',2560,1440],['2160p',3840,2160]]){
    const files=processingShaders({...DEFAULT_PLAYER_SETTINGS,outputResolution:mode},directory);assert.equal(files.length,7);assert.equal(path.basename(files.at(-1)),`AgentPulse_Output_${mode}.glsl`);
    const shader=fs.readFileSync(files.at(-1),'utf8');assert(shader.includes('//!HOOK MAIN'));assert(shader.includes(`//!DESC AgentPulse GPU target ${width}x${height}`));assert(shader.includes('//!WIDTH'));assert(shader.includes('//!HEIGHT'));assert(!shader.includes('//!HOOK OUTPUT'));
  }
  assert.deepEqual(processingShaders({superResolution:'off',outputResolution:'auto'},directory),[]);assert.equal(processingShaders({superResolution:'off',outputResolution:'1080p'},directory).length,1);assert.throws(()=>processingShaders({...DEFAULT_PLAYER_SETTINGS,outputResolution:'fake'},directory));
});
test('target-aware neural files change only metadata expressions, retaining shader code and original coefficients',()=>{
  const directory=path.resolve('native/player/resources/shaders');
  for(const mode of ['1080p','1440p','2160p'])for(const file of processingShaders({superResolution:'quality',outputResolution:mode},directory).slice(0,-1)){
    const original=fs.readFileSync(path.join(directory,path.basename(file).replace('AgentPulse_'+mode+'_','')),'utf8'),derived=fs.readFileSync(file,'utf8');
    assert.equal(derived,targetShaderText(original,mode));
    const body=text=>text.split(/\r?\n/).filter(line=>!line.startsWith('//!')&&!line.startsWith('// Agent Pulse target-aware')).join('\n');
    assert.equal(body(derived),body(original));assert(!derived.split(/\r?\n/).some(line=>line.startsWith('//!')&&/\bOUTPUT\.[wh]\b/.test(line)));
  }
});
