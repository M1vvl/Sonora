(function(host,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else host.PulseHorizontalScroll=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const VELOCITY_LIMIT=8,PROJECTION_MS=300;
  function create({viewport,onScroll=()=>{},maxTravelCards=2,cardSelector=null}={}){
    if(!viewport?.ownerDocument)throw new TypeError('Horizontal scroll needs a viewport');
    const document=viewport.ownerDocument,view=document.defaultView,listeners=[];
    let active=false,disposed=false,pan=null,frame=null,inertia=null,suppressUntil=0,lastNotified=null,gesture=null;
    const on=(node,name,handler,options)=>{node.addEventListener(name,handler,options);listeners.push(()=>node.removeEventListener(name,handler,options));};
    const reduced=()=>view.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
    function changed(){if(!active||disposed)return;const left=viewport.scrollLeft;if(left===lastNotified)return;lastNotified=left;onScroll();}
    function stop(){if(frame!==null)view.cancelAnimationFrame(frame);frame=null;inertia=null;}
    function endPan(){const previous=pan;pan=null;if(previous)try{if(viewport.hasPointerCapture?.(previous.id))viewport.releasePointerCapture(previous.id);}catch{}viewport.classList.remove('is-dragging');}
    function bounds(){
      // Geometry is sampled once at pointerdown, never between pointermove writes.
      const cards=cardSelector?viewport.querySelectorAll(cardSelector):viewport.children,first=cards[0]?.getBoundingClientRect(),second=cards[1]?.getBoundingClientRect();
      const stride=first?Math.max(first.width,second?Math.abs(second.left-first.left):0):viewport.clientWidth,travel=stride*Math.max(1,Number(maxTravelCards)||2),start=viewport.scrollLeft;
      return {start,stride,travel,low:Math.max(0,start-travel),high:Math.max(0,Math.min(viewport.scrollWidth-viewport.clientWidth,start+travel))};
    }
    const bounded=(value,limits)=>Math.max(limits.low,Math.min(limits.high,value));
    function flushDrag(){if(!pan?.moved)return;viewport.scrollLeft=pan.target;changed();}
    function paint(time){
      frame=null;if(!active||disposed||document.visibilityState==='hidden')return;
      if(pan){flushDrag();return;}
      if(!inertia)return;
      const current=inertia,progress=Math.max(0,Math.min(1,(time-current.started)/current.duration)),ease=1-Math.pow(1-progress,3);
      viewport.scrollLeft=current.from+current.distance*ease;changed();
      if(progress<1)frame=view.requestAnimationFrame(paint);else inertia=null;
    }
    function schedule(){if(frame===null)frame=view.requestAnimationFrame(paint);}
    function finish(event,canceled=false){
      if(!pan||event.pointerId!==pan.id)return;const current=pan;
      if(current.moved){suppressUntil=view.performance.now()+450;flushDrag();}
      endPan();stop();
      const age=Math.max(0,event.timeStamp-current.lastAt),velocity=current.velocity*Math.exp(-age/80),from=viewport.scrollLeft;
      if(current.moved&&!canceled&&!reduced()&&Math.abs(velocity)>.05){
        const target=bounded(from+velocity*PROJECTION_MS,current.bounds),distance=target-from;
        if(Math.abs(distance)>1){inertia={from,distance,started:view.performance.now(),duration:Math.max(48,Math.min(900,3*Math.abs(distance/velocity)))};schedule();}
      }
      changed();
    }
    on(viewport,'pointerdown',event=>{
      if(!active||disposed||event.button!==0||event.isPrimary===false||event.pointerType==='touch')return;
      stop();endPan();gesture=bounds();pan={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastAt:event.timeStamp,velocity:0,moved:false,target:gesture.start,bounds:gesture};
    });
    on(viewport,'pointermove',event=>{
      if(!pan||pan.id!==event.pointerId)return;
      const dx=event.clientX-pan.x,dy=event.clientY-pan.y;
      if(!pan.moved&&Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){stop();endPan();return;}
      if(!pan.moved&&Math.abs(dx)<6)return;
      if(!pan.moved){pan.moved=true;viewport.classList.add('is-dragging');try{viewport.setPointerCapture(event.pointerId);}catch{}}
      event.preventDefault();pan.target=bounded(pan.bounds.start-dx,pan.bounds);
      const elapsed=Math.max(1,event.timeStamp-pan.lastAt),instant=Math.max(-VELOCITY_LIMIT,Math.min(VELOCITY_LIMIT,(pan.lastX-event.clientX)/elapsed));
      pan.velocity=pan.velocity*.25+instant*.75;pan.lastX=event.clientX;pan.lastAt=event.timeStamp;schedule();
    });
    on(viewport,'pointerup',event=>finish(event));on(viewport,'pointercancel',event=>finish(event,true));
    on(viewport,'lostpointercapture',()=>{if(pan){stop();endPan();}});
    on(viewport,'dragstart',event=>event.preventDefault());
    on(viewport,'scroll',changed,{passive:true});
    on(viewport,'wheel',event=>{if(!active||disposed)return;stop();endPan();const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY,before=viewport.scrollLeft;viewport.scrollLeft+=delta;if(viewport.scrollLeft!==before){event.preventDefault();changed();}},{passive:false});
    on(viewport,'keydown',event=>{if(!active||disposed||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();stop();endPan();if(event.key==='Home')viewport.scrollLeft=0;else if(event.key==='End')viewport.scrollLeft=viewport.scrollWidth;else viewport.scrollLeft+=(event.key==='ArrowRight'?1:-1)*viewport.clientWidth*.75;changed();});
    on(viewport,'click',event=>{if(view.performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
    on(document,'visibilitychange',()=>{if(document.visibilityState==='hidden'){stop();endPan();}});
    on(view,'blur',()=>{stop();endPan();});
    return {
      activate(){if(!disposed){active=true;lastNotified=null;}},
      deactivate(){active=false;stop();endPan();},
      getState:()=>({active,pendingFrame:frame!==null,dragging:!!pan?.moved,inertia:!!inertia,stride:gesture?.stride||0,maxTravel:gesture?.travel||0}),
      dispose(){if(disposed)return;this.deactivate();disposed=true;listeners.splice(0).forEach(remove=>remove());}
    };
  }
  return {create};
});
