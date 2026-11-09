'use strict';
// A small metadata pool, not a playlist/audio cache. One visit keeps one order;
// a new visit samples again and prefers titles the last visit did not show.
function createHotPlaylists({loadPage,normalize,random=Math.random,now=Date.now}={}){
  const LIMIT=50,MAX=150,TTL=300000;
  let pool=[],loadedAt=0,pending=null,revision=0,current=[],previous=[];
  const clone=value=>structuredClone(value);
  function shuffle(values){const result=values.slice();for(let i=result.length-1;i>0;i--){const j=Math.max(0,Math.min(i,Math.floor((Number(random())||0)*(i+1))));[result[i],result[j]]=[result[j],result[i]];}return result;}
  async function ensure(options){
    if(pool.length&&now()-loadedAt<TTL)return;
    if(pending)return pending;
    const ticket=revision;
    const job=(async()=>{const rows=[];for(let page=0;page<3;page++){
      if(options.signal?.aborted)throw options.signal.reason||new Error('音乐操作已取消');
      let result;try{result=await loadPage({...options,offset:page*LIMIT,limit:LIMIT});}catch(error){if(options.signal?.aborted||!rows.length)throw error;break;}
      const body=result?.body||result;if(Number(body?.code)!==200){if(!rows.length)throw new Error('热门歌单暂时不可用');break;}
      const values=Array.isArray(body.playlists)?body.playlists.slice(0,LIMIT):[];rows.push(...values);
      if(body.more===false||!values.length||values.length<LIMIT)break;
    }
    if(options.signal?.aborted||ticket!==revision)return;
    const next=normalize(rows,[],MAX).filter(value=>Number(value.playCount)>0).slice(0,MAX);
    if(next.length){pool=next;loadedAt=now();}
    })().finally(()=>{if(pending===job)pending=null;});pending=job;return job;
  }
  async function select({options={},excluded=[],fallback=[],refresh=false}={}){
    const ticket=revision;
    if(!refresh&&current.length)return clone(current);
    try{await ensure(options);}catch(error){if(options.signal?.aborted)throw error;}
    if(ticket!==revision||options.signal?.aborted)throw Object.assign(new Error('音乐操作已取消'),{code:'CANCELLED'});
    const blocked=new Set(excluded.filter(Boolean).map(String)),source=(pool.length?pool:normalize(fallback,excluded,MAX)).filter(value=>!blocked.has(String(value.id)));
    if(!source.length)return [];
    const recent=new Set(previous),fresh=shuffle(source.filter(value=>!recent.has(String(value.id)))),older=shuffle(source.filter(value=>recent.has(String(value.id))));
    let next=[...fresh,...older].slice(0,18);
    if(next.length>1&&next.map(value=>value.id).join(',')===current.map(value=>value.id).join(','))next=[...next.slice(1),next[0]];
    current=next;previous=next.map(value=>String(value.id));return clone(current);
  }
  return {select,clear(){revision++;pool=[];loadedAt=0;pending=null;current=[];previous=[];},getStatus:()=>({pool:pool.length,maxPool:MAX,selected:current.length,pending:!!pending,loadedAt})};
}
module.exports={createHotPlaylists};
