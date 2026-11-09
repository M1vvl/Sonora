'use strict';

// A bounded append-only visit deck. Shuffle only newly discovered films;
// earlier positions must keep their identity when the viewer scrolls back.
function createRecommendations({loadPage,remember=value=>value,random=Math.random,maxItems=120,batchSize=12}={}){
  const items=[],seen=new Set();let cursor=0,ended=false,pending=null,disposed=false,revision=0;
  function add(values){
    const fresh=(Array.isArray(values)?values:[]).filter(item=>item&&item.id&&Number.isFinite(Number(item.score))&&Number(item.score)>=7.5&&!seen.has(String(item.id))&&seen.add(String(item.id)));
    for(let index=fresh.length-1;index>0;index--){const draw=Math.max(0,Math.min(.999999999,Number(random())||0)),target=Math.floor(draw*(index+1));[fresh[index],fresh[target]]=[fresh[target],fresh[index]];}
    const accepted=fresh.slice(0,Math.max(0,maxItems-items.length));remember(accepted);items.push(...accepted);
    if(items.length>=maxItems)ended=true;
  }
  function snapshot(offset){return {items:structuredClone(items.slice(offset,offset+batchSize)),nextOffset:Math.min(items.length,offset+batchSize),hasMore:!ended||offset+batchSize<items.length,exhausted:ended&&offset+batchSize>=items.length,limit:batchSize};}
  async function request(payload={}){
    if(disposed)throw new Error('影视推荐已关闭');
    const offset=Math.min(maxItems,Math.max(0,Math.floor(Number(payload.offset)||0))),ticket=revision;
    if(offset+batchSize<=items.length||ended)return snapshot(offset);
    if(pending){await pending;if(disposed||ticket!==revision)throw Object.assign(new Error('影视推荐已取消'),{name:'AbortError'});return request(payload);}
    const task=(async()=>{
      // At most three source pages per gesture; sparse scores cannot cause an
      // unbounded hidden request loop. A later swipe can continue the cursor.
      for(let attempt=0;attempt<3&&!ended&&items.length<offset+batchSize;attempt++){
        const page=await loadPage(cursor);
        if(disposed||ticket!==revision)throw Object.assign(new Error('影视推荐已取消'),{name:'AbortError'});
        const next=Number(page.nextOffset);add(page.items);
        if(!page.hasMore||!Number.isSafeInteger(next)||next<=cursor)ended=true;
        else cursor=next;
      }
    })();
    pending=task;
    try{await task;return snapshot(offset);}finally{if(pending===task)pending=null;}
  }
  return {request,seed:values=>{if(!disposed)add(values);},cancel(){revision++;},dispose(){disposed=true;revision++;items.length=0;seen.clear();},getStatus:()=>({items:items.length,cursor,ended,pending:!!pending})};
}
module.exports={createRecommendations};
