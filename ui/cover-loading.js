(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseCoverLoading=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Native lazy loading owns distant images; only the visible row and a small
  // look-ahead margin are promoted. No downloaded image/object URL copies.
  function create({root,scrollRoot=root?.closest?.('.content-scroll'),selector='img[data-cover]'}={}){
    if(!root?.ownerDocument)throw new TypeError('Cover loading needs a root');
    const document=root.ownerDocument,view=document.defaultView,entries=new Map();
    const requestFrame=typeof view.requestAnimationFrame==='function'?view.requestAnimationFrame.bind(view):callback=>view.setTimeout(callback,16);
    const cancelFrame=typeof view.cancelAnimationFrame==='function'?view.cancelAnimationFrame.bind(view):view.clearTimeout.bind(view);
    let active=false,disposed=false,observer=null,frame=null;
    const source=img=>img.getAttribute('data-cover-src')||img.getAttribute('src')||'';
    function state(img){let entry=entries.get(img);if(!entry){entry={src:source(img),retries:0,timer:null};entries.set(img,entry);}if(entry.src!==source(img)){view.clearTimeout(entry.timer);entry.src=source(img);entry.retries=0;}return entry;}
    function ready(img){if(disposed||!entries.has(img)||!img.naturalWidth)return;const entry=state(img),src=entry.src;const show=()=>{if(!disposed&&img.isConnected&&img.getAttribute('src')===src){img.hidden=false;img.dataset.coverReady='true';img.parentElement?.classList.remove('anime-image-failed','cover-unavailable');}};if(typeof img.decode==='function')img.decode().then(show,show);else show();}
    function promote(img,visible=false){if(!active||disposed||!source(img))return;img.loading='eager';if(img.getAttribute('src')!==source(img))img.src=source(img);if(visible&&img.dataset.coverPriority==='high')img.fetchPriority='high';else if(!img.getAttribute('fetchpriority'))img.fetchPriority='auto';if(img.complete&&img.naturalWidth)ready(img);}
    function inView(img,margin=0){let box=img.getBoundingClientRect();if(!box.width||!box.height)box=img.parentElement?.getBoundingClientRect()||box;return box.width>0&&box.height>0&&box.right>=0&&box.left<=view.innerWidth&&box.bottom>=-margin&&box.top<=view.innerHeight+margin;}
    function refresh(){
      if(disposed)return;for(const [img,entry]of entries)if(!root.contains(img)){view.clearTimeout(entry.timer);observer?.unobserve(img);entries.delete(img);}
      for(const img of root.querySelectorAll(selector)){state(img);img.decoding='async';if(active){observer?.observe(img);if(inView(img))promote(img,true);else if(inView(img,220))promote(img);if(img.complete&&img.naturalWidth)ready(img);}}
    }
    function schedule(){if(!active||frame!==null)return;frame=requestFrame(()=>{frame=null;refresh();});}
    function load(event){const img=event.target;if(img.matches?.(selector)){state(img);ready(img);}}
    function error(event){const img=event.target;if(!active||disposed||!img.matches?.(selector))return;const entry=state(img);if(entry.retries>=1||entry.timer||!entry.src||!inView(img,220))return;entry.retries++;entry.timer=view.setTimeout(()=>{entry.timer=null;if(!active||disposed||!root.contains(img)||source(img)!==entry.src)return;img.hidden=false;img.removeAttribute('src');img.src=entry.src;},650);}
    if(typeof view.IntersectionObserver==='function')observer=new view.IntersectionObserver(items=>{for(const entry of items)if(entry.isIntersecting)promote(entry.target);},{root:scrollRoot||null,rootMargin:'220px 180px',threshold:0});
    root.addEventListener('load',load,true);root.addEventListener('error',error,true);scrollRoot?.addEventListener('scroll',schedule,{passive:true});view.addEventListener('resize',schedule);
    return {refresh,activate(){if(disposed)return;active=true;refresh();},deactivate(){active=false;observer?.disconnect();for(const entry of entries.values()){view.clearTimeout(entry.timer);entry.timer=null;}if(frame!==null)cancelFrame(frame);frame=null;},getStatus:()=>({active,tracked:entries.size,retries:[...entries.values()].reduce((sum,item)=>sum+item.retries,0)}),dispose(){if(disposed)return;this.deactivate();disposed=true;root.removeEventListener('load',load,true);root.removeEventListener('error',error,true);scrollRoot?.removeEventListener('scroll',schedule);view.removeEventListener('resize',schedule);entries.clear();}};
  }
  return {create};
});
