(function(host,factory){'use strict';const api=factory(typeof module==='object'&&module.exports?require('../horizontal-scroll.js'):host.PulseHorizontalScroll);if(typeof module==='object'&&module.exports)module.exports=api;else host.PulseMovieCarousel=api;})(typeof window==='object'?window:globalThis,function(scrollModule){
  'use strict';
  function create({root,load,renderItem,onOpen=()=>{},onAppend=()=>{},maxItems=120}={}){
    if(!root?.ownerDocument||typeof load!=='function'||typeof renderItem!=='function')throw new TypeError('Movie carousel needs a root, loader and card renderer');
    const view=root.ownerDocument.defaultView,listeners=[],items=[],seen=new Set();
    let active=false,disposed=false,pending=false,cursor=0,hasMore=true,error='',restoreScroll=0,generation=0;
    root.classList.add('movie-carousel');root.setAttribute('data-no-window-drag','');
    root.innerHTML='<div class="movie-carousel-heading"><span>高分电影</span></div><div class="movie-carousel-viewport" tabindex="0" role="region" aria-label="高分电影卡片，可左右拖动"><div class="movie-carousel-track"></div></div><p class="movie-carousel-status" role="status"></p>';
    const $=selector=>root.querySelector(selector),viewport=$('.movie-carousel-viewport'),track=$('.movie-carousel-track'),status=$('.movie-carousel-status');
    const on=(node,name,handler,options)=>{node.addEventListener(name,handler,options);listeners.push(()=>node.removeEventListener(name,handler,options));};
    function paintStatus(){status.textContent=error||(!items.length&&pending?'正在寻找高分电影…':!hasMore?'本次精选已展示完，可向右拖回之前的电影':'');status.dataset.retry=String(!!error);status.tabIndex=error?0:-1;status.setAttribute('role',error?'button':'status');}
    async function more(){
      if(!active||disposed||pending||!hasMore||error)return;
      pending=true;paintStatus();const ticket=generation,offset=cursor;
      try{
        const result=await load({offset});if(disposed||!active||ticket!==generation)return;
        const incoming=Array.isArray(result?.items)?result.items:[],added=incoming.filter(item=>item&&item.id&&Number(item.score)>=7.5&&!seen.has(String(item.id))&&seen.add(String(item.id))).slice(0,Math.max(0,maxItems-items.length));
        const start=items.length;items.push(...added);track.insertAdjacentHTML('beforeend',added.map((item,index)=>renderItem(item,start+index)).join(''));onAppend(added);
        const next=Number(result?.nextOffset);cursor=Number.isSafeInteger(next)&&next>=offset?next:offset+incoming.length;
        hasMore=items.length<maxItems&&result?.hasMore===true;
        if(cursor<=offset&&!added.length)hasMore=false;
        // Sparse score pages keep the old cards and expose an explicit retry;
        // do not spin requests while an unfilled viewport remains in view.
        if(!added.length&&hasMore)error='暂未找到新的高分电影，点击继续寻找';
      }catch(value){if(!disposed&&active&&ticket===generation&&!/abort|cancel|已取消/i.test(String(value?.message)))error='高分电影暂未加载，点击重试';}
      finally{if(ticket===generation){pending=false;paintStatus();}}
    }
    function nearEnd(){if(viewport.clientWidth>0&&viewport.scrollWidth-viewport.scrollLeft-viewport.clientWidth<viewport.clientWidth*.8)more();}
    on(viewport,'click',event=>{const card=event.target.closest('[data-movie-card]');if(!card)return;event.preventDefault();event.stopPropagation();const item=items.find(value=>String(value.id)===card.dataset.movieCard);if(item)onOpen(item);});
    const scroll=scrollModule.create({viewport,onScroll:nearEnd,cardSelector:'.movie-metal-card',maxTravelCards:10});
    on(status,'click',()=>{if(error){error='';more();}});on(status,'keydown',event=>{if(error&&['Enter',' '].includes(event.key)){event.preventDefault();error='';more();}});
    return {
      activate(){if(disposed||active)return;active=true;scroll.activate();viewport.scrollLeft=restoreScroll;more();},
      deactivate(){if(disposed||!active)return;restoreScroll=viewport.scrollLeft;active=false;generation++;pending=false;scroll.deactivate();},
      getState:()=>({items:items.map(item=>({id:String(item.id),score:Number(item.score)})),nextOffset:cursor,hasMore,pending,active,error,scrollLeft:viewport.scrollLeft,motion:scroll.getState()}),
      dispose(){if(disposed)return;this.deactivate();disposed=true;scroll.dispose();listeners.splice(0).forEach(remove=>remove());items.length=0;seen.clear();root.replaceChildren();}
    };
  }
  return {create};
});
