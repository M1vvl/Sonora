'use strict';
const {authError}=require('./netease.cjs');
const MODES=Object.freeze([
  {id:'daily',label:'每日推荐'},
  {id:'radar',label:'私人雷达',requiresAuth:true},
  {id:'fm',label:'私人漫游',requiresAuth:true},
  {id:'heart',label:'心动模式',requiresAuth:true},
  {id:'similar',label:'相似歌曲',requiresSeed:true}
].map(Object.freeze));
// Provider capabilities share this dispatcher, not another provider's algorithm.
// A provider can register only real supported operations; missing methods fail closed.
function createDiscovery({providers,getDefaultSource=()=> 'netease'}={}){
  return async function discovery(payload={}){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw authError('INVALID_DISCOVERY','音乐发现参数无效');
    const source=payload.source===undefined?getDefaultSource():payload.source,mode=MODES.find(item=>item.id===payload.mode);
    if(!mode)throw authError('INVALID_DISCOVERY','不支持的音乐发现模式');
    const provider=typeof source==='string'&&Object.hasOwn(providers,source)?providers[source]:null;
    if(!provider||typeof provider[mode.id]!=='function')throw authError('SOURCE_UNAVAILABLE','该音乐平台尚未接通此发现功能');
    const result=await provider[mode.id](payload);
    return {...result,source,mode:mode.id};
  };
}
module.exports={MODES,createDiscovery};
