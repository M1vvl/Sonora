(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulsePlaylistStage=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  function create({root,imageURL=value=>value,onDetail=()=>{},onPlay=()=>{},onNeedMore=()=>{},onLike=()=>{},onEnqueue=()=>{},onAdd=()=>{},onNotice=()=>{},initialId=null,trackMode=false,settings={}}={}){
    const document=root.ownerDocument,view=document.defaultView,listeners=[],cards=new Map(),motion=view.matchMedia?.('(prefers-reduced-motion: reduce)');
    let items=[],index=0,position=0,target=0,velocity=0,disposed=false,pan=null,frame=null,last=0,suppress=0,requestedLength=0,wheelSnap=null,appearance={...settings},introAge=0,introDone=false,pointerX=0,pointerY=0;
    root.classList.add('music-playlist-stage');root.classList.toggle('music-track-stage',trackMode);root.setAttribute('role','listbox');root.tabIndex=0;
    const on=(event,fn,options)=>{root.addEventListener(event,fn,options);listeners.push(()=>root.removeEventListener(event,fn,options));};
    const number=(key,fallback,min=-Infinity,max=Infinity)=>Number.isFinite(Number(appearance[key]))?Math.max(min,Math.min(max,Number(appearance[key]))):fallback;
    const reduced=()=>motion?.matches||appearance.libraryDynamic===false;
    const scale=()=>number('shelfSize',1,.5,1.5)*(trackMode?number('shelfDetailScale',1,.5,2):1)*number('libraryWidth',320,260,420)/320;
    const stepSize=()=> (trackMode?80*number('shelfDetailRowGap',1,.5,2):88)*scale();
    const entryDuration=()=>number(trackMode?'shelfDetailOpenDuration':'shelfSummonOpenDuration',.22,.08,2)/(1+(number('shelfCameraEnterSpeed',.24,.2,1.5)-.24)*2);
    const clamp=value=>Math.max(0,Math.min(items.length-1,value));
    function stop(){if(frame!==null)view.cancelAnimationFrame(frame);frame=null;last=0;}
    function render(){
      if(disposed)return;
      if(!items.length){cards.clear();root.innerHTML='<div class="music-stage-empty">'+(trackMode?'正在读取歌单歌曲…':'登录后显示账号歌单')+'</div>';return;}
      index=clamp(Math.round(position));root.querySelector('.music-stage-empty')?.remove();const retained=new Set();
      for(let n=Math.max(0,index-3);n<=Math.min(items.length-1,index+3);n++){
        const item=items[n],key=String(item.id),d=n-position;retained.add(key);let card=cards.get(key);
        if(!card){card=document.createElement('article');card.className='music-stage-card';card.setAttribute('role','option');cards.set(key,card);root.append(card);}
        // Pagination and provider refreshes can update metadata without changing
        // the id. Preserve the card node and redraw its contents only when needed.
        const signature=JSON.stringify([item.title,item.artist,item.coverURL,item.trackCount,item.creator]);
        if(card.dataset.signature!==signature){const image=imageURL(item.coverURL||'');card.innerHTML=`<div class="music-stage-art">${image?`<img src="${esc(image)}" width="110" height="110" alt="" decoding="async" draggable="false">`:'<span aria-hidden="true">♫</span>'}</div><div class="music-stage-copy">${trackMode?'':'<small>我的歌单 · NE</small>'}<strong>${esc(item.title)}</strong><span>${trackMode?esc(item.artist||''):Number(item.trackCount)||0}${trackMode?'':' 首'+(item.creator?' · '+esc(item.creator):'')}</span></div>`;card.dataset.signature=signature;}
        card.dataset.stageIndex=String(n);card.setAttribute('aria-selected',String(n===index));
        const duration=entryDuration(),stagger=number('shelfSummonStagger',1,0,3)*.02;
        const rowDuration=trackMode?number('shelfDetailRowDuration',.72,.1,1.6):duration;
        const phase=introDone?1:Math.max(0,Math.min(1,(introAge-Math.abs(d)*stagger)/Math.max(duration,rowDuration))),entry=phase*phase*(3-2*phase),size=scale();
        const introStrength=trackMode?number('shelfDetailIntroStrength',1,0,2):number('shelfSummonSlide',1,0,4),parallax=number(trackMode?'shelfDetailParallax':'shelfSummonParallax',1,0,2.5);
        const offsetX=(trackMode?number('shelfDetailOffsetX',0,-4.8,4.8)*45:0)+Math.abs(d)*3+(1-entry)*24*introStrength+pointerX*8*parallax;
        const offsetY=(trackMode?number('shelfDetailOffsetY',0,-3.6,3.6)*45:0)+d*stepSize()+pointerY*6*parallax;
        const offsetZ=(trackMode?number('shelfDetailOffsetZ',0,-3.6,3.6)*50:0)-Math.abs(d)*66-(1-entry)*18*introStrength+(pointerY-pointerX)*3*parallax;
        card.style.transform=`translate(-50%,-50%) translate3d(${offsetX.toFixed(3)}px,${offsetY.toFixed(3)}px,${offsetZ.toFixed(3)}px) rotateY(${number(trackMode?'shelfDetailAngleY':'shelfAngleY',-13,-60,60)+pointerX*.8*parallax}deg) rotateX(${(trackMode?number('shelfDetailAngleX',7,-60,60):7)-pointerY*.6*parallax}deg) scale(${(size*(1-(1-entry)*.03*number('shelfSummonScale',1,0,3))).toFixed(4)})`;
        card.style.opacity=String(Math.max(.16,1-Math.abs(d)*.25)*entry*number('shelfOpacity',1,.2,1));card.style.zIndex=String(10-Math.abs(n-index));
        card.style.setProperty('--stage-bg-opacity',String(number('shelfBgOpacity',.85,0,1)));

        let actions=card.querySelector('.music-stage-actions');if(n===index&&!actions){actions=document.createElement('div');actions.className='music-stage-actions';actions.innerHTML=trackMode?'<button type="button" data-stage-action="like" aria-label="喜欢这首歌">'+(item.liked?'♥':'♡')+'</button><button type="button" data-stage-action="queue" aria-label="加入当前队列">+</button><button type="button" data-stage-action="add" aria-label="收藏到歌单">⊞</button><button type="button" data-stage-action="play">播放</button>':'<button type="button" data-stage-action="play">▶ 播放歌单</button><button type="button" data-stage-action="detail">详情</button>';card.querySelector('.music-stage-copy').append(actions);}else if(n!==index)actions?.remove();if(trackMode&&actions&&n===index){const heart=actions.querySelector('[data-stage-action=like]');if(heart){heart.textContent=item.liked?'♥':'♡';heart.setAttribute('aria-pressed',String(item.liked===true));}}
      }
      for(const[key,card]of cards)if(!retained.has(key)){card.remove();cards.delete(key);}
      root.dataset.index=String(index);root.setAttribute('aria-label',`${trackMode?'立体歌曲详情':'立体歌单架'}，${index+1}/${items.length} ${items[index].title}，可上下滚动选择`);
    }
    function tick(time){frame=null;if(disposed||document.hidden)return;const dt=Math.min(.04,Math.max(.001,last?(time-last)/1000:1/60));last=time;
      // Critically damped spring. Re-targeting preserves the current position
      // and velocity; input never waits for the previous animation to finish.
      const omega=trackMode?Math.max(9,Math.min(36,13/number('shelfDetailRowDuration',.72,.1,1.6))):18,x=position-target,z=velocity+omega*x,decay=Math.exp(-omega*dt);
      introAge+=dt;const duration=Math.max(entryDuration(),trackMode?number('shelfDetailRowDuration',.72,.1,1.6):0);if(introAge>=duration+number('shelfSummonStagger',1,0,3)*.06)introDone=true;
      position=target+(x+z*dt)*decay;velocity=(velocity-omega*z*dt)*decay;
      if(introDone&&Math.abs(position-target)<.001&&Math.abs(velocity)<.01){position=target;velocity=0;render();last=0;return;}
      render();frame=view.requestAnimationFrame(tick);
    }
    function move(value,{instant=false}={}){if(!items.length)return;target=clamp(value);if(instant||reduced()){stop();position=target;velocity=0;introDone=true;render();}else if(frame===null)frame=view.requestAnimationFrame(tick);if(target>=items.length-3&&requestedLength!==items.length){if(onNeedMore()!==false)requestedLength=items.length;}}
    on('wheel',event=>{if(!items.length)return;event.preventDefault();const raw=Math.abs(event.deltaY)>=Math.abs(event.deltaX)?event.deltaY:event.deltaX,delta=raw*(event.deltaMode===1?16:event.deltaMode===2?300:1);move(target+Math.max(-2,Math.min(2,delta/120)));if(wheelSnap!==null)view.clearTimeout(wheelSnap);wheelSnap=view.setTimeout(()=>{wheelSnap=null;move(Math.round(target));},140);},{passive:false});
    on('keydown',event=>{if(event.target.closest('button'))return;if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key))return;event.preventDefault();if(event.key==='Enter'){if(items[index])onDetail(items[index]);return;}move(event.key==='Home'?0:event.key==='End'?items.length-1:Math.round(target)+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1),{instant:true});});
    on('pointerdown',event=>{if(event.button!==0||event.target.closest('button'))return;stop();if(wheelSnap!==null)view.clearTimeout(wheelSnap);wheelSnap=null;pan={id:event.pointerId,y:event.clientY,start:position,moved:false,lastY:event.clientY,lastTime:view.performance.now()};velocity=0;});
    on('pointermove',event=>{if(!pan||pan.id!==event.pointerId)return;const delta=event.clientY-pan.y;if(Math.abs(delta)<8&&!pan.moved)return;event.preventDefault();pan.moved=true;try{root.setPointerCapture(event.pointerId);}catch{}const time=view.performance.now(),dt=Math.max(8,time-pan.lastTime);velocity=Math.max(-8,Math.min(8,-(event.clientY-pan.lastY)/stepSize()/(dt/1000)));pan.lastY=event.clientY;pan.lastTime=time;position=target=clamp(pan.start-delta/stepSize());render();});
    on('pointermove',event=>{if(pan||reduced())return;const bounds=root.getBoundingClientRect();pointerX=Math.max(-1,Math.min(1,(event.clientX-bounds.left)/Math.max(1,bounds.width)*2-1));pointerY=Math.max(-1,Math.min(1,(event.clientY-bounds.top)/Math.max(1,bounds.height)*2-1));render();});
    on('pointerleave',()=>{if(pan)return;pointerX=pointerY=0;render();});
    const finish=event=>{if(!pan||pan.id!==event.pointerId)return;const moved=pan.moved;if(moved)suppress=view.performance.now()+350;try{if(root.hasPointerCapture?.(event.pointerId))root.releasePointerCapture(event.pointerId);}catch{}pan=null;if(moved)move(Math.round(position+velocity*.08));};on('pointerup',finish);on('pointercancel',finish);on('lostpointercapture',()=>{if(pan){pan=null;move(Math.round(position));}});on('dragstart',event=>event.preventDefault());
    on('click',event=>{if(view.performance.now()<suppress){event.preventDefault();return;}const element=event.target.closest('[data-stage-action],[data-stage-index]');if(!element)return;event.stopPropagation();const action=element.dataset.stageAction;if(action&&items[index]){const item=items[index];if(action==='play')onPlay(item);else if(action==='detail')onDetail(item);else if(action==='queue')Promise.resolve(onEnqueue(item)).catch(error=>onNotice(error.message));else if(action==='add')onAdd(item);else if(action==='like'){element.disabled=true;Promise.resolve(onLike(item)).then(result=>{if(result?.error)throw new Error(result.error);if(typeof result?.liked!=='boolean')throw new Error('平台未确认收藏状态，本次没有显示为已收藏');item.liked=result.liked;if(element.isConnected)element.textContent=item.liked?'♥':'♡';}).catch(error=>onNotice(error.message)).finally(()=>{element.disabled=false;});}}else if(element.dataset.stageIndex!==undefined)move(Number(element.dataset.stageIndex));});
    const visibility=()=>{if(document.hidden){stop();if(wheelSnap!==null)view.clearTimeout(wheelSnap);wheelSnap=null;position=target;velocity=0;introDone=true;}};document.addEventListener('visibilitychange',visibility);listeners.push(()=>document.removeEventListener('visibilitychange',visibility));
    return {update(values){const id=items[index]?.id||initialId,oldLength=items.length;items=Array.isArray(values)?values.slice(0,trackMode?1000:500):[];if(oldLength!==items.length)requestedLength=0;const next=items.findIndex(value=>String(value.id)===String(id));if(oldLength===0||next!==index){stop();position=target=Math.max(0,next);velocity=0;}else{position=clamp(position);target=clamp(target);}if(reduced())introDone=true;render();if(oldLength===0&&items.length&&!reduced()){introAge=0;introDone=false;if(frame===null)frame=view.requestAnimationFrame(tick);}},updateSettings(value={}){appearance={...value};if(reduced()){stop();position=target;velocity=0;introDone=true;}render();},enter(){introAge=0;introDone=!!reduced();render();if(!introDone&&frame===null)frame=view.requestAnimationFrame(tick);},pause(){stop();if(wheelSnap!==null)view.clearTimeout(wheelSnap);wheelSnap=null;velocity=0;target=position;pan=null;introDone=true;},getState:()=>({items:items.length,index,selectedId:items[index]?.id||null,position,target,velocity,introDone,pendingFrame:frame!==null,pendingSnap:wheelSnap!==null}),dispose(){disposed=true;stop();if(wheelSnap!==null)view.clearTimeout(wheelSnap);wheelSnap=null;listeners.splice(0).forEach(fn=>fn());cards.clear();root.replaceChildren();}};
  }
  return {create,createDetails:options=>create({...options,trackMode:true})};
});
