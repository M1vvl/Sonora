(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicQueue=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // MineRadio 14-player-controls.js cycles a single mode control; sequence is
  // split from its loop mode so natural queue end can stop without wrapping.
  const MODES=Object.freeze(['sequence','repeat-one','shuffle','repeat-all']);
  function create({random=Math.random}={}){
    let items=[],mode='sequence',bag=[],history=[];
    const id=value=>String(value?.id??value??'');
    function set(values){const seen=new Set();items=(Array.isArray(values)?values:[]).filter(value=>value?.id&&!seen.has(id(value))&&seen.add(id(value))).slice(0,10000);bag=[];history=[];}
    function choose(current,delta=1,{ended=false}={}){
      if(!items.length)return null;const currentId=id(current),at=items.findIndex(value=>id(value)===currentId);
      if(ended&&mode==='repeat-one'&&at>=0)return items[at];
      if(mode==='shuffle'){
        if(delta<0&&history.length){const previous=history.pop();return items.find(value=>id(value)===previous)||items[Math.max(0,at)];}
        if(items.length===1)return items[0];
        if(!bag.length){bag=items.filter(value=>id(value)!==currentId).map(id);for(let n=bag.length-1;n>0;n--){const k=Math.max(0,Math.min(n,Math.floor(random()*(n+1))));[bag[n],bag[k]]=[bag[k],bag[n]];}}
        const next=bag.shift();if(at>=0){history.push(currentId);if(history.length>1000)history.shift();}return items.find(value=>id(value)===next)||items[0];
      }
      if(at<0)return items[0];if(ended&&mode==='sequence'&&(at+delta>=items.length||at+delta<0))return null;return items[(at+delta+items.length)%items.length];
    }
    return {set,choose,setMode(value){if(!MODES.includes(value))return false;mode=value;bag=[];history=[];return true;},remove(value){const target=id(value);items=items.filter(item=>id(item)!==target);bag=bag.filter(item=>item!==target);history=history.filter(item=>item!==target);},clear(){items=[];bag=[];history=[];},getItems:()=>items.slice(),getMode:()=>mode};
  }
  return {create,MODES};
});
