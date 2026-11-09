(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicTrackOptions=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const QUALITIES=Object.freeze([
    {id:'sky',label:'沉浸环绕声',short:'环绕',description:'SVIP · 以歌曲与账号返回为准'},
    {id:'jymaster',label:'超清母带',short:'母带',description:'SVIP · 臻享规格'},
    {id:'vivid',label:'臻音全景声',short:'全景',description:'空间音频 · 以平台实际返回为准'},
    {id:'jyeffect',label:'高清臻音',short:'臻音',description:'优先臻音 · 需对应播放权限'},
    {id:'lossless',label:'无损音质',short:'SQ',description:'FLAC 无损'},
    {id:'exhigh',label:'极高音质',short:'HQ',description:'最高 320 kbps'},
    {id:'standard',label:'标准音质',short:'标准',description:'最高 128 kbps'}
  ].map(Object.freeze));
  const SOURCES=Object.freeze([{id:'netease',label:'网易云音乐',mark:'NE',available:true},{id:'qq',label:'QQ 音乐',mark:'QQ'},{id:'kugou',label:'酷狗音乐',mark:'KG'},{id:'qishui',label:'汽水音乐',mark:'QS'},{id:'spotify',label:'Spotify',mark:'SP'}].map(Object.freeze));
  function create({root,onQuality=()=>{},onSource=()=>{},onOpenSource=()=>{}}={}){
    if(!root?.ownerDocument)throw new TypeError('Track options need a root');
    const document=root.ownerDocument,removers=[];let disposed=false,open=null,current=null,busy=false,hasSong=false,qualityKey='',availableQualities=[];
    root.classList.add('music-track-options');
    root.innerHTML='<button type="button" class="music-track-badge music-source-badge" data-track-menu="source" aria-label="选择音乐来源" aria-haspopup="menu" aria-expanded="false">NE</button><button type="button" class="music-track-badge music-quality-badge" data-track-menu="quality" aria-label="选择音质" aria-haspopup="menu" aria-expanded="false" disabled>音质</button><div class="music-track-menu" role="menu" aria-label="音乐来源" data-track-panel="source" hidden></div><div class="music-track-menu" role="menu" aria-label="歌曲音质" data-track-panel="quality" hidden></div>';
    const source=root.querySelector('[data-track-panel="source"]'),quality=root.querySelector('[data-track-panel="quality"]'),qualityButton=root.querySelector('.music-quality-badge'),sourceButton=root.querySelector('.music-source-badge');
    for(const entry of SOURCES){const button=document.createElement('button');button.type='button';button.className='music-track-choice';button.disabled=!entry.available;button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(!!entry.available));button.innerHTML='<span class="music-source-mark"></span><span class="music-choice-copy"><strong></strong><small></small></span><span class="music-choice-current"></span>';button.querySelector('.music-source-mark').textContent=entry.mark;button.querySelector('strong').textContent=entry.label;button.querySelector('small').textContent=entry.available?'当前来源':'后续接入';button.querySelector('.music-choice-current').textContent=entry.available?'✓':'';button.dataset.sourceChoice=entry.id;source.append(button);}
    function renderQualities(entries){
      const key=JSON.stringify(entries);if(key===qualityKey)return;
      qualityKey=key;quality.replaceChildren();availableQualities=entries;
      for(const entry of entries){
        const button=document.createElement('button');button.type='button';button.className='music-track-choice';button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked','false');button.dataset.qualityChoice=entry.id;
        button.innerHTML='<span class="music-choice-copy"><strong></strong><small></small></span><span class="music-choice-current"></span>';
        button.querySelector('strong').textContent=entry.label;button.querySelector('small').textContent=entry.description||'以当前平台返回为准';quality.append(button);
      }
    }
    const on=(target,name,fn)=>{target.addEventListener(name,fn);removers.push(()=>target.removeEventListener(name,fn));};
    function close({focus=false}={}){const previous=open;open=null;source.hidden=quality.hidden=true;for(const button of root.querySelectorAll('[data-track-menu]'))button.setAttribute('aria-expanded','false');if(focus&&previous)root.querySelector(`[data-track-menu="${previous}"]`).focus();}
    function toggle(name){if(disposed)return;if(open===name){close();return;}close();open=name;const panel=name==='source'?source:quality;panel.hidden=false;root.querySelector(`[data-track-menu="${name}"]`).setAttribute('aria-expanded','true');panel.querySelector('button:not(:disabled)')?.focus();}
    function update(value={}){
      hasSong=!!value.song;busy=!!value.busy;current=value.quality||null;
      const provider=value.source||value.song?.source||value.song?.provider||'netease',sourceEntry=SOURCES.find(item=>item.id===provider);
      sourceButton.textContent=sourceEntry?.mark||'音源';sourceButton.title=sourceEntry?.label||String(provider);
      const entries=Array.isArray(value.qualityOptions)?value.qualityOptions.filter(item=>typeof item?.id==='string'&&/^[a-z0-9_-]{1,40}$/.test(item.id)&&typeof item.label==='string').slice(0,16):provider==='netease'?QUALITIES:[];
      renderQualities(entries);
      const entry=availableQualities.find(item=>item.id===current),extra={higher:'较高',dolby:'杜比'};
      qualityButton.textContent=value.trial===true?'试听':entry?.short||entry?.shortLabel||extra[current]||String(value.qualityLabel||'音质').slice(0,8);qualityButton.disabled=!hasSong||busy||!availableQualities.length;
      qualityButton.title=(value.bitrate?`${entry?.label||current||'音质'} · ${Math.round(value.bitrate/1000)} kbps`:entry?.label||value.qualityLabel||'选择音质')+(value.trial===true?' · 试听':'');
      for(const button of quality.querySelectorAll('button')){const selected=button.dataset.qualityChoice===current;button.disabled=busy;button.setAttribute('aria-checked',String(selected));button.querySelector('.music-choice-current').textContent=selected?'✓':'';}
      for(const button of source.querySelectorAll('[data-source-choice]')){
        const selected=button.dataset.sourceChoice===provider;
        const capability=value.sources?.find(item=>item.id===button.dataset.sourceChoice);
        const available=capability?.available===true||button.dataset.sourceChoice==='netease'||selected;
        button.disabled=busy||!available;
        button.setAttribute('aria-checked',String(selected));button.querySelector('.music-choice-current').textContent=selected?'✓':'';
        button.querySelector('small').textContent=selected?'当前来源':available?'匹配并切换当前歌曲':capability?.reason||'请先在账号面板连接';
      }
    }
    on(root,'click',event=>{
      const menu=event.target.closest('[data-track-menu]');
      if(menu){if(menu.dataset.trackMenu==='source')onOpenSource();toggle(menu.dataset.trackMenu);return;}
      const qualityChoice=event.target.closest('[data-quality-choice]');
      if(qualityChoice&&!qualityChoice.disabled){const id=qualityChoice.dataset.qualityChoice;close();onQuality(id);return;}
      const sourceChoice=event.target.closest('[data-source-choice]');
      if(sourceChoice&&!sourceChoice.disabled){const id=sourceChoice.dataset.sourceChoice;close();onSource(id);}
    });
    on(document,'pointerdown',event=>{if(open&&!root.contains(event.target))close();});
    on(root,'keydown',event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close({focus:true});return;}if(!open||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const list=[...(open==='source'?source:quality).querySelectorAll('button:not(:disabled)')];if(!list.length)return;event.preventDefault();const index=list.indexOf(document.activeElement),at=event.key==='Home'?0:event.key==='End'?list.length-1:(Math.max(index,0)+(event.key==='ArrowDown'?1:-1)+list.length)%list.length;list[at].focus();});
    update();
    return {update,close,dispose(){if(disposed)return;disposed=true;close();removers.splice(0).forEach(remove=>remove());root.replaceChildren();}};
  }
  return {create,QUALITIES,SOURCES};
});
