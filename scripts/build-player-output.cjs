'use strict';
// Deterministic derived shader metadata. No GPU code/coefficients are rewritten.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'native/player/resources/shaders');
const {SHADER_PRESETS}=require('../src/player-settings.cjs'),{targetShaderText}=require('../src/player-output.cjs');
for(const target of ['1080p','1440p','2160p'])for(const name of new Set(Object.values(SHADER_PRESETS).flat())){
  fs.writeFileSync(path.join(directory,'AgentPulse_'+target+'_'+name),targetShaderText(fs.readFileSync(path.join(directory,name),'utf8'),target));
}
console.log('Built target-aware GPU shader metadata; original Anime4K files unchanged.');
