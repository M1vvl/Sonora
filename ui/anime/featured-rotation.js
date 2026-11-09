(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseAnimeFeaturedRotation=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const PERIOD=5000,REFRESH=300000,LIMIT=10;
  function candidates(values){const seen=new Set();return (Array.isArray(values)?values:[]).filter(item=>item&&item.id&&Number.isFinite(Number(item.score))&&Number(item.score)>=7.5&&!seen.has(String(item.id))&&seen.add(String(item.id)));}
  function select(values,random=Math.random){const items=candidates(values).slice();for(let index=items.length-1;index>0;index--){const at=Math.min(index,Math.max(0,Math.floor((Number(random())||0)*(index+1))));[items[index],items[at]]=[items[at],items[index]];}return items.slice(0,LIMIT);}
  async function collect(requestPage,initial=[],{isCurrent=()=>true}={}){let items=candidates(initial),offset=0;for(let page=0;page<6&&items.length<LIMIT;page++){if(!isCurrent())throw Object.assign(new Error('番剧轮播已取消'),{name:'AbortError'});const result=await requestPage({category:'热门',offset}),next=Number(result?.nextOffset);if(!isCurrent())throw Object.assign(new Error('番剧轮播已取消'),{name:'AbortError'});items=candidates([...items,...candidates(result?.items)]);if(result?.hasMore!==true||!Number.isSafeInteger(next)||next<=offset)break;offset=next;}return candidates(items);}
  function create({onChange,load,now=Date.now,random=Math.random,setTimer=setTimeout,clearTimer=clearTimeout,isVisible=()=>true}={}){
    if(typeof onChange!=='function'||typeof load!=='function')throw new TypeError('Featured rotation needs load and onChange');
    let active=false,disposed=false,timer=null,pending=null,revision=0,items=[],index=0,nextAt=0,refreshAt=0,attempted=false;
    function stop(){if(timer!==null)clearTimer(timer);timer=null;}
    function show(){if(items.length)onChange(items[index],items[(index+1)%items.length],{index,items});}
    function schedule(){stop();if(!active||disposed||!isVisible()||pending)return;const deadline=items.length>1?Math.min(nextAt,refreshAt):refreshAt;if(!deadline)return;timer=setTimer(tick,Math.max(1,deadline-now()));timer?.unref?.();}
    function replace(values){const next=select(values,random);if(!next.length)return false;items=next;index=0;nextAt=now()+PERIOD;refreshAt=now()+REFRESH;show();return true;}
    async function refresh(){if(disposed||!active||!isVisible()||pending)return;stop();attempted=true;const ticket=revision;const task=Promise.resolve().then(()=>load({isCurrent:()=>active&&!disposed&&ticket===revision&&isVisible()}));pending=task;
      try{const values=await task;if(disposed||!active||ticket!==revision)return;replace(values);}
      catch{}finally{if(pending===task){pending=null;if(ticket===revision){refreshAt=now()+REFRESH;nextAt=now()+PERIOD;schedule();}}}
    }
    function goTo(value){if(disposed||!active||!isVisible()||!items.length||!Number.isSafeInteger(Number(value)))return false;index=((Number(value)%items.length)+items.length)%items.length;nextAt=now()+PERIOD;show();schedule();return true;}
    function tick(){timer=null;if(!active||disposed||!isVisible())return;if(now()>=refreshAt){refresh();return;}if(items.length>1&&now()>=nextAt){index=(index+1)%items.length;nextAt=now()+PERIOD;show();}schedule();}
    return {
      goTo,next:()=>goTo(index+1),previous:()=>goTo(index-1),
      seed(values){if(!disposed&&!items.length)replace(values);},
      activate(){if(disposed)return;active=true;if(!items.length||(!attempted&&items.length<LIMIT)||now()>=refreshAt)refresh();else{nextAt=now()+PERIOD;schedule();}},
      deactivate(){active=false;revision++;pending=null;stop();},
      visibilityChanged(){if(!active||disposed)return;if(isVisible()){if(!items.length||(!attempted&&items.length<LIMIT)||now()>=refreshAt)refresh();else{nextAt=now()+PERIOD;schedule();}}else{revision++;pending=null;stop();}},
      getState:()=>({active,items:items.map(item=>({id:String(item.id),score:Number(item.score)})),index,pending:!!pending,pendingTimer:timer!==null,refreshAt}),
      dispose(){disposed=true;active=false;revision++;pending=null;stop();items=[];}
    };
  }
  return {create,candidates,select,collect,PERIOD,REFRESH,LIMIT};
});
