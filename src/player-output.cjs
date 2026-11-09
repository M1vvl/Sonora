'use strict';
const path=require('node:path');
const {shaderPaths}=require('./player-settings.cjs');
const OUTPUT_TARGETS=Object.freeze({auto:null,'1080p':Object.freeze({width:1920,height:1080}),'1440p':Object.freeze({width:2560,height:1440}),'2160p':Object.freeze({width:3840,height:2160})});
function outputSize(width,height,target){
  const bounds=OUTPUT_TARGETS[target];
  if(!bounds||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
  const scale=Math.min(bounds.width/width,bounds.height/height);
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}
function targetExpressions(target){
  const bounds=OUTPUT_TARGETS[target];if(!bounds)throw new TypeError('固定输出目标不能为空');
  const ratio='NATIVE.w NATIVE.h / 1.7777777778 >';
  return {width:`${ratio} ${bounds.width} * ${ratio} ! NATIVE.w NATIVE.h / ${bounds.height} * * +`,height:`${ratio} ${bounds.width} NATIVE.w NATIVE.h / / * ${ratio} ! ${bounds.height} * +`};
}
function targetShaderText(source,target){
  const expressions=targetExpressions(target);
  // Only metadata expressions change. Neural coefficients, shader code,
  // upstream licensing and the original files remain byte-for-byte intact.
  const header=source.replace(/^\/\/!.*$/gm,line=>line.replace(/\bOUTPUT\.(?:w|width)\b/g,expressions.width).replace(/\bOUTPUT\.(?:h|height)\b/g,expressions.height));
  return '// Agent Pulse target-aware metadata adaptation; original Anime4K MIT notice retained.\n'+header;
}
function processingShaders(settings,directory){
  if(!Object.hasOwn(OUTPUT_TARGETS,settings.outputResolution))throw new TypeError('无效的超分输出目标');
  let shaders=shaderPaths(settings.superResolution,directory);
  if(settings.outputResolution!=='auto'){
    if(typeof directory!=='string'||!path.isAbsolute(directory)||/[\0\r\n;]/.test(directory))throw new TypeError('着色器目录必须是有效的绝对路径');
    shaders=shaders.map(file=>path.join(directory,'AgentPulse_'+settings.outputResolution+'_'+path.basename(file)));
    shaders.push(path.join(directory,'AgentPulse_Output_'+settings.outputResolution+'.glsl'));
  }
  return shaders;
}
module.exports={OUTPUT_TARGETS,outputSize,processingShaders,targetExpressions,targetShaderText};
