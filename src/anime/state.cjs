'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {validateNetwork}=require('./config.cjs');

function createState(dataDir,{installedRulesPath=path.join(process.env.APPDATA||'', 'com.example','kazumi','plugins','v2','plugins.json')}={}) {
  const file=path.join(dataDir,'anime-state.json');
  let data;let importedFrom='bundled-kazumi-rules';
  try{data=JSON.parse(fs.readFileSync(file,'utf8'));importedFrom=data.importedFrom||'saved';}catch{}
  if(!data){
    let rules;
    try{const stat=fs.statSync(installedRulesPath);if(stat.size>512*1024)throw new Error();rules=JSON.parse(fs.readFileSync(installedRulesPath,'utf8'));if(!Array.isArray(rules))throw new Error();importedFrom='local-kazumi-rules';}catch{rules=require('./default-rules.json');}
    data={version:1,rules:rules.map(r=>({...r,id:r.name,enabled:true})),network:validateNetwork(),history:[],importedFrom};
  }
  data.rules=Array.isArray(data.rules)?data.rules:[];
  data.history=Array.isArray(data.history)?data.history.slice(0,100):[];
  data.historyRevision=Number.isSafeInteger(data.historyRevision)&&data.historyRevision>=0?data.historyRevision:0;
  try{data.network=validateNetwork(data.network);}catch{data.network=validateNetwork();}
  // Writes serialize in call order. Atomic rename protects the previous valid state.
  let tail=Promise.resolve();
  function save(){tail=tail.catch(()=>{}).then(async()=>{const json=JSON.stringify(data,null,2);await fs.promises.mkdir(dataDir,{recursive:true});const temp=file+'.tmp';await fs.promises.writeFile(temp,json,'utf8');await fs.promises.rename(temp,file);});return tail;}
  function updateHistory(update,afterSave){
    // Queue the mutation itself, not only serialized bytes. This keeps writes,
    // durable revisions and notifications in the same order.
    let result;
    const job=tail.catch(()=>{}).then(async()=>{
      const previous=data.history,previousRevision=data.historyRevision;
      data.history=update(previous);
      data.historyRevision=previousRevision+1;
      const json=JSON.stringify(data,null,2);
      try{
        await fs.promises.mkdir(dataDir,{recursive:true});const temp=file+'.tmp';
        await fs.promises.writeFile(temp,json,'utf8');await fs.promises.rename(temp,file);
      }catch(error){data.history=previous;data.historyRevision=previousRevision;throw error;}
      result=await afterSave?.();
      return result;
    });
    tail=job;return job;
  }
  return {data,save,updateHistory,flush:()=>tail,importedFrom};
}
module.exports={createState};
