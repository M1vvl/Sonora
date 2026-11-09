'use strict';
const fs=require('node:fs'),path=require('node:path');
const defaults=require('./default-sources.cjs'),{httpURL,text}=require('./cms.cjs');
function normalizeSource(value){
  if(!value||typeof value!=='object')throw new Error('无效的片源');
  const name=text(value.name,80),url=httpURL(value.url||value.baseURL);if(!name)throw new Error('请填写片源名称');
  const id=text(value.id||'custom-'+require('node:crypto').randomUUID(),100);if(!/^[\w.-]+$/.test(id))throw new Error('无效的片源标识');
  if(value.isAdult===true)throw new Error('不支持成人片源');
  return {id,name,url,enabled:value.enabled!==false};
}
function createState(dataDir,{sources=defaults}={}){
  const file=path.join(dataDir,'movies-state.json');let input;try{const stat=fs.statSync(file);if(stat.size<=2*1024*1024)input=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  const savedSources=Array.isArray(input?.sources)?[...input.sources]:sources;
  // Add only newly introduced defaults on upgrade. Previously removed sources,
  // custom URLs and enabled choices stay under the user's control.
  if(input&&sources===defaults){const revision=Number(input.defaultsRevision)||1;for(const source of defaults)if((source.introducedIn||1)>revision&&!savedSources.some(saved=>saved.id===source.id)&&savedSources.length<24)savedSources.push(source);}
  const data={version:1,defaultsRevision:sources===defaults?2:Number(input?.defaultsRevision)||1,sources:savedSources.slice(0,24).flatMap(value=>{try{return [normalizeSource(value)];}catch{return [];}}),settings:{adFilter:input?.settings?.adFilter!==false},history:Array.isArray(input?.history)?input.history.slice(0,100):[],historyRevision:Number.isSafeInteger(input?.historyRevision)?Math.max(0,input.historyRevision):0};
  let tail=Promise.resolve();
  async function write(next){await fs.promises.mkdir(dataDir,{recursive:true});const temporary=file+'.tmp';await fs.promises.writeFile(temporary,JSON.stringify(next),'utf8');await fs.promises.rename(temporary,file);}
  function transaction(update,afterSave){const result=tail.catch(()=>{}).then(async()=>{const next=structuredClone(data);update(next);await write(next);Object.assign(data,next);return afterSave?.();});tail=result;return result;}
  return {data,transaction,updateHistory(update,afterSave){return transaction(next=>{next.history=update(next.history);next.historyRevision++;},afterSave);},flush:()=>tail};
}
module.exports={createState,normalizeSource};
