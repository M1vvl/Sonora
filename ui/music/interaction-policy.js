/* Music presentation surfaces do not participate in dashboard text selection.
 * Actual form controls retain editing, copy and select-all behavior. */
(function(host,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicInteractionPolicy=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const SURFACES='.music-view,.music-immersive,.music-account-root,.music-library,.music-feedback';
  const EDITABLE='input,textarea,select,[contenteditable=""],[contenteditable="true"]';
  function create({root,isActive=()=>true}={}){
    const document=root.ownerDocument,view=document.defaultView,listeners=[];let disposed=false;
    root.setAttribute('data-no-window-drag','');
    const target=event=>event.target?.nodeType===3?event.target.parentElement:event.target;
    const on=(name,fn)=>{document.addEventListener(name,fn,true);listeners.push(()=>document.removeEventListener(name,fn,true));};
    const inMusic=node=>!!node?.closest?.(SURFACES);
    const editing=node=>!!node?.closest?.(EDITABLE);
    function selectionInMusic(){const selection=view.getSelection?.();if(!selection||selection.isCollapsed)return false;return [selection.anchorNode,selection.focusNode].some(node=>inMusic(node?.nodeType===3?node.parentElement:node));}
    function clear(){if(selectionInMusic())view.getSelection()?.removeAllRanges();}
    on('selectstart',event=>{const node=target(event);if(inMusic(node)&&!editing(node)){event.preventDefault();clear();}});
    on('dragstart',event=>{const node=target(event);if(inMusic(node)&&!editing(node))event.preventDefault();});
    for(const name of ['copy','cut'])on(name,event=>{if(!isActive())return;const node=target(event);if(!editing(node)&&(inMusic(node)||selectionInMusic())){event.preventDefault();clear();}});
    on('keydown',event=>{if(!isActive()||!(event.ctrlKey||event.metaKey)||event.altKey||editing(target(event)))return;if(['a','c','x'].includes(event.key?.toLowerCase())){event.preventDefault();clear();}});
    on('selectionchange',()=>{if(isActive()&&!editing(document.activeElement))clear();});
    return {clear,dispose(){if(disposed)return;disposed=true;listeners.splice(0).forEach(remove=>remove());root.removeAttribute('data-no-window-drag');}};
  }
  return {create};
});
