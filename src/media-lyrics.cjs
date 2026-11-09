'use strict';
const { isLyricText } = require('./music/lyrics.cjs');

function createMediaLyrics({ lookup, onChange=()=>{}, now=Date.now }={}) {
  const cache=new Map();
  const empty=Object.freeze([]);
  let current='',pending='',revision=0,disposed=false;
  function update(value) {
    if(disposed)return;
    if(value?.source==='agentpulse'){current=pending='';revision++;return;}
    const key=value?.available?value.trackKey:'';
    if(key!==current)pending='';
    const saved=cache.get(key);
    if(key===current&&(!value?.playing||saved&&(saved.lines.length||now()<saved.retryAt)||pending===key))return;
    current=key;
    const ticket=++revision;
    if(!key||!value.playing||!value.title||!value.artist)return;
    if(saved&&(saved.lines.length||now()<saved.retryAt)){onChange();return;}
    pending=key;
    Promise.resolve().then(()=>lookup(value)).then(lines=>{
      if(disposed||ticket!==revision)return;
      const valid=(Array.isArray(lines)?lines:[]).filter(line=>line&&Number.isFinite(line.time)&&isLyricText(line.text)).slice(0,1000);
      cache.set(key,{lines:valid,retryAt:now()+300000});
      while(cache.size>6)cache.delete(cache.keys().next().value);
      onChange();
    }).catch(()=>{
      if(!disposed&&ticket===revision){
        cache.set(key,{lines:empty,retryAt:now()+30000});
        while(cache.size>6)cache.delete(cache.keys().next().value);
      }
    }).finally(()=>{if(ticket===revision)pending='';});
  }
  return {update,getLines:key=>cache.get(key)?.lines||empty,dispose(){disposed=true;revision++;pending='';cache.clear();}};
}

module.exports={createMediaLyrics};
