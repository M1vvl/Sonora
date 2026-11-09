(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicFeedback=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // One short-lived announcement, outside layout. Repeated failures replace
  // this text rather than adding rows or an unbounded queue of notifications.
  function create({root,duration=4200}={}){
    if(!root?.ownerDocument)throw new TypeError('Music feedback needs a root');
    const document=root.ownerDocument,view=document.defaultView,node=document.createElement('p');
    node.className='music-feedback';node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.setAttribute('aria-atomic','true');node.hidden=true;
    let timer=null,disposed=false,currentRoot=root;
    function clear(){if(timer!==null)view.clearTimeout(timer);timer=null;node.hidden=true;node.textContent='';}
    function show(value){
      if(disposed)return;const text=String(value||'').trim().slice(0,280);clear();if(!text)return;
      const modal=currentRoot.querySelector('dialog[open]'),parent=modal||currentRoot;
      node.classList.toggle('is-modal',!!modal);if(node.parentNode!==parent)parent.append(node);
      node.textContent=text;node.hidden=false;
      timer=view.setTimeout(clear,Math.max(2000,Math.min(6500,duration)));
    }
    return {show,clear,setRoot(parent){currentRoot=parent?.ownerDocument===document?parent:root;if(node.parentNode)currentRoot.append(node);},dispose(){if(disposed)return;clear();disposed=true;node.remove();}};
  }
  return {create};
});
