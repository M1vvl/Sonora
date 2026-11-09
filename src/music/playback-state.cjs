'use strict';
// Resume metadata only. Never persists an audio URL, response, cookie or PCM.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {song}=require('./catalog.cjs');
const MAX_BYTES=512*1024;
function normalize(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))input={};
  const seen=new Set(),queue=(Array.isArray(input.queue)?input.queue:[]).slice(0,1000).map(song).filter(value=>value&&!seen.has(value.id)&&seen.add(value.id));
  const current=song(input.song),position=current?Math.max(0,Math.min(current.duration||86400,Number(input.position)||0)):0;
  const value={version:1,queue:[],song:current,position,mode:['sequence','repeat-one','shuffle','repeat-all'].includes(input.mode)?input.mode:'sequence',volume:Math.max(0,Math.min(1,Number.isFinite(input.volume)?input.volume:.7)),muted:input.muted===true};
  let bytes=Buffer.byteLength(JSON.stringify(value));for(const item of queue){const cost=Buffer.byteLength(JSON.stringify(item))+(value.queue.length?1:0);if(bytes+cost>MAX_BYTES)break;bytes+=cost;value.queue.push(item);}return value;
}
function createPlaybackState(dataDir){const file=dataDir?path.join(dataDir,'music-playback.json'):null;let current=null;
  function get(){if(current===null){current=normalize();try{if(file&&fs.statSync(file).size<=MAX_BYTES)current=normalize(JSON.parse(fs.readFileSync(file,'utf8')));}catch{}}return structuredClone(current);}
  function save(input){get();const value=normalize(input);if(file){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}}current=value;return get();}
  return {get,save};
}
module.exports={createPlaybackState,normalize,MAX_BYTES};
