'use strict';
// Small bounded JSON cache, shared by metadata and chapter adapters. It never
// stores response bodies/HTML and an over-budget entry evicts earlier work.
function createCache({maxEntries=40,maxBytes=12*1024*1024}={}){
  const entries=new Map();let bytes=0;
  return {get(key){const entry=entries.get(key);if(!entry)return;entries.delete(key);entries.set(key,entry);return entry.value;},set(key,value){const old=entries.get(key);if(old){bytes-=old.bytes;entries.delete(key);}const size=Buffer.byteLength(JSON.stringify(value));if(size>maxBytes)return value;entries.set(key,{value,bytes:size});bytes+=size;while(entries.size>maxEntries||bytes>maxBytes){const first=entries.keys().next().value;bytes-=entries.get(first).bytes;entries.delete(first);}return value;},has:key=>entries.has(key),delete(key){const old=entries.get(key);if(old){bytes-=old.bytes;entries.delete(key);}return !!old;},clear(){entries.clear();bytes=0;},values:function*(){for(const entry of entries.values())yield entry.value;},get size(){return entries.size;},get bytes(){return bytes;}};
}
module.exports={createCache};
