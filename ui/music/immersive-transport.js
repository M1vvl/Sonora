/* MineRadio public/index.html #bottom-bar / #controls layout adaptation.
 * GPL-3.0-only source reference; same Agent Pulse audio and control nodes. */
(function(host,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicImmersiveTransport=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const svg=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  function create({player,onLyrics=()=>{},onReset=()=>{},onFullscreen=()=>{},onGlass=()=>{},getGlass=()=>.2}){
    const root=player.getRoot(),document=root.ownerDocument,view=document.defaultView;let active=false,portals=[],unsub=null;
    const bar=root.querySelector('.music-player-bar'),mount=document.createElement('div');mount.className='music-stage-transport';mount.hidden=true;
    mount.innerHTML='<div class="music-stage-progress"></div><div class="music-stage-controls"><div class="music-stage-track"></div><div class="music-stage-center"><div class="music-stage-primary"></div><div class="music-stage-playback"></div><div class="music-stage-secondary"></div></div><div class="music-stage-tools"></div><div class="music-stage-clock"></div></div>';
    const $=s=>mount.querySelector(s),button=(label,html,handler)=>{const node=document.createElement('button');node.type='button';node.className='music-icon-button';node.setAttribute('aria-label',label);node.title=label;node.innerHTML=html;node.addEventListener('click',handler);return node;};
    const lyric=button('显示或隐藏歌词','<b>词</b>',onLyrics),reset=button('重置舞台镜头',svg('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>'),onReset),fullscreen=button('切换全屏',svg('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13 0h5v-5"/>'),onFullscreen);
    const glass=document.createElement('label');
    glass.className='music-transport-glass';
    glass.innerHTML=`<span aria-hidden="true">◐</span><span class="music-transport-glass-popover">播放栏玻璃<input type="range" min=".2" max="1" step=".05" aria-label="播放栏玻璃厚度" value=".2"></span>`;
    const glassRange=glass.querySelector('input');
    glassRange.addEventListener('input',()=>onGlass(Number(glassRange.value)));
    function move(node,target){if(!node)return;const marker=document.createComment('stage-control');node.before(marker);portals.push({node,marker});target.append(node);}
    function sync(){const position=root.querySelector('.music-position')?.textContent||'0:00',duration=root.querySelector('.music-duration')?.textContent||'0:00';$('.music-stage-clock').textContent=position+' / '+duration;}
    function deactivate(){if(!active)return;active=false;unsub?.();unsub=null;for(const{node,marker}of portals.reverse())if(marker.parentNode)marker.replaceWith(node);portals=[];mount.hidden=true;root.classList.remove('uses-stage-transport');mount.remove();}
    return {setFullscreen(value){fullscreen.setAttribute('aria-pressed',String(value===true));fullscreen.setAttribute('aria-label',value?'退出全屏（Esc）':'切换全屏');fullscreen.title=value?'退出全屏（Esc）':'切换全屏';},activate(){if(active)return;active=true;bar.append(mount);mount.hidden=false;root.classList.add('uses-stage-transport');
      move(root.querySelector('.music-now-playing'),$('.music-stage-track'));
      for(const action of ['like','add-playlist','mode','previous']){
        move(root.querySelector(`[data-player-action="${action}"]`),$('.music-stage-primary'));
      }
      move(root.querySelector('[data-player-action="toggle"]'),$('.music-stage-playback'));
      for(const selector of ['[data-player-action="next"]','[data-player-action="queue"]','.music-immersive-diy']){
        move(root.querySelector(selector),$('.music-stage-secondary'));
      }
      move(root.querySelector('.music-seek'),$('.music-stage-progress'));move(root.querySelector('.music-volume-label'),$('.music-stage-tools'));
      glassRange.value=String(getGlass());$('.music-stage-tools').prepend(lyric);$('.music-stage-tools').append(glass,reset,fullscreen);sync();unsub=player.subscribe(sync);},deactivate,getState:()=>({active,portals:portals.length}),dispose(){deactivate();mount.remove();}};
  }
  return {create};
});
