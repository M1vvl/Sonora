(function(host,factory){'use strict';const value=factory(typeof module==='object'&&module.exports?require('../cover-loading.js'):host.PulseCoverLoading,typeof module==='object'&&module.exports?require('../horizontal-scroll.js'):host.PulseHorizontalScroll,typeof module==='object'&&module.exports?require('./playlist-loader.js'):host.PulsePlaylistLoader);if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicWorkspace=value;})(typeof window==='object'?window:globalThis,function(coverModule,scrollModule,playlistModule){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const modePaths={daily:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4M16 3v4M4 11h16M8 15h3v3H8z"/>',radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m12 12 6-6"/>',fm:'<path d="M12 12c-2-4-3-5-5-5a5 5 0 1 0 0 10c2 0 3-1 5-5s3-5 5-5a5 5 0 1 1 0 10c-2 0-3-1-5-5Z"/>',heart:'<path d="M12 20 4 12a5 5 0 0 1 8-6 5 5 0 0 1 8 6Z"/>',similar:'<path d="M8 18V5l12-2v13M8 9l12-2"/><ellipse cx="5" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>'};
  const playIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 5.5 10.5 6.5-10.5 6.5Z" fill="currentColor"/></svg>';
  function create({root,searchRoot,api,imageURL=value=>value,onPlay=()=>{},cardsFactory,onError=()=>{},onNotice=()=>{}}={}){
    if(!root?.ownerDocument||!searchRoot||typeof api!=='function')throw new TypeError('Music workspace needs roots and API');
    const $=selector=>root.querySelector(selector),state={active:false,obscured:false,disposed:false,query:'',songs:[],playlists:[],recent:[],cards:[],mode:'public',recommendationLabel:'公开每日推荐',loading:false,seedId:null,discovery:null,pendingMode:null,homePlaylists:[],discoveryModes:null,discoveryLabels:{},webPlayer:false,webPath:'/'},listeners=[];
    let visibleSongs=100;
    let generation=0,homeRequest=null,dayTimer=null,visit=0,deckLoaded=false,webFrame=null,webObserver=null,webKey=null,webVisible=false,webGeneration=0,webRequestedPath=null,webNavigate=false;
    const modeViews=new Map(),modeResults=new Map(),modeJobs=new Map();
    const modeSpecs=[['daily','每日推荐'],['radar','私人雷达'],['fm','私人漫游'],['heart','心动模式'],['similar','相似歌曲']];
    const modeTitle=mode=>state.discoveryLabels[mode]||modeSpecs.find(value=>value[0]===mode)?.[1]||'音乐发现';
    const modeSeed=()=>state.seedId||state.cards[0]?.id||state.songs[0]?.id;
    const modeKey=mode=>['heart','similar'].includes(mode)?`${mode}:${modeSeed()||''}`:mode;
    function clearModes(){modeViews.clear();modeResults.clear();modeJobs.clear();}
    const clearDay=()=>{if(dayTimer!==null)root.ownerDocument.defaultView.clearTimeout(dayTimer);dayTimer=null;};
    function scheduleDay(){clearDay();if(!state.active||state.disposed)return;const delay=86400000-((Date.now()+8*3600000)%86400000)+50;dayTimer=root.ownerDocument.defaultView.setTimeout(()=>{dayTimer=null;if(state.active&&!state.disposed){deckLoaded=false;home({force:true}).finally(scheduleDay);}},delay);}
    root.classList.add('music-workspace');searchRoot.innerHTML='<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></span><input type="search" placeholder="搜索歌曲、歌手、歌单" aria-label="搜索音乐" autocomplete="off"><button type="submit" class="music-search-submit" aria-label="搜索">搜索</button><button type="button" class="music-search-clear" aria-label="返回音乐推荐" hidden>×</button>';
    root.innerHTML='<div class="music-content-grid"><div class="music-explore-main"><nav class="music-discovery-modes" aria-label="音乐发现" data-no-window-drag></nav><section class="music-section music-playlists-section"><div class="music-section-heading"><h2>推荐歌单</h2></div><div class="music-playlist-list" tabindex="0" role="region" aria-label="推荐歌单，可左右滑动" data-no-window-drag></div></section><section class="music-section music-songs-section"><div class="music-section-heading"><h2 class="music-songs-heading">为你推荐歌曲</h2><span class="music-song-count"></span></div><div class="music-song-list"></div></section></div><aside class="music-discovery-side"><section class="music-metal-section" aria-label="音乐精选"><div class="music-cards-mount"></div></section><div class="music-listening-card" aria-label="今日聆听"><div class="music-listening-heading">LISTENING TODAY<span>今日聆听</span></div><div class="music-listening-grid"><div><strong><span data-listening="minutes">0</span><small>分钟</small></strong><p>聆听时长</p></div><div><strong><span data-listening="songs">0</span><small>首</small></strong><p>今日歌曲</p></div><div><strong><span data-listening="streak">0</span><small>天</small></strong><p>连续聆听</p></div></div></div></aside></div>';
    const covers=coverModule?.create({root,scrollRoot:$('.music-explore-main')});
    const cards=typeof cardsFactory==='function'?cardsFactory({root:$('.music-cards-mount'),onActivate:item=>play(item),onError:value=>notice(value)}):null;
    if(!cards)$('.music-cards-mount').innerHTML='<div class="music-empty-cards" aria-hidden="true">♪</div><span class="music-recommendation-mode"></span>';
    const playlistsScroll=scrollModule?.create({viewport:$('.music-playlist-list'),onScroll:()=>covers?.refresh(),cardSelector:'.music-playlist'});
    const on=(target,event,handler,options)=>{target.addEventListener(event,handler,options);listeners.push(()=>target.removeEventListener(event,handler,options));};
    async function request(action,payload={}){const result=await api(action,payload);if(result?.error)throw new Error(result.error);return result||{};}
    const webSection=root.ownerDocument.createElement('section');webSection.className='music-spotify-web-workspace';webSection.hidden=true;webSection.innerHTML='<nav class="music-spotify-web-toolbar" aria-label="Spotify 播放器"><div class="music-spotify-web-tabs"><button type="button" data-spotify-path="/" aria-current="page">推荐</button><button type="button" data-spotify-path="/collection/playlists">我的歌单</button><button type="button" data-spotify-path="/collection/tracks">收藏歌曲</button></div><button type="button" class="music-spotify-browser" data-spotify-browser>在浏览器中播放</button></nav><div class="music-spotify-web-surface" aria-label="Spotify 官方播放器"><p role="status">正在打开 Spotify 官方播放器…</p><button type="button" data-spotify-retry hidden>重新加载</button></div>';root.append(webSection);
    function hideWebPlayer(){
      webGeneration++;if(webFrame!==null)root.ownerDocument.defaultView.cancelAnimationFrame?.(webFrame);webFrame=null;webKey=null;
      if(!webVisible)return;webVisible=false;request('platformWebPlayer',{provider:'spotify',visible:false}).catch(()=>{});
    }
    function syncWebPlayer(){
      if(state.disposed||!state.active||state.obscured||!state.webPlayer){hideWebPlayer();return;}
      const rect=$('.music-spotify-web-surface').getBoundingClientRect(),bounds={x:Math.round(rect.left),y:Math.round(rect.top),width:Math.round(rect.width),height:Math.round(rect.height)};
      if(bounds.width<120||bounds.height<120){hideWebPlayer();return;}
      const key=JSON.stringify([bounds,state.webPath]);if(key===webKey)return;webKey=key;webVisible=true;const ticket=++webGeneration;
      // Bounds/visibility changes retain navigation performed inside Spotify.
      const navigation=webNavigate||webRequestedPath!==state.webPath?{path:state.webPath,...(webNavigate?{navigate:true}:{})}:{};webRequestedPath=state.webPath;webNavigate=false;
      request('platformWebPlayer',{provider:'spotify',visible:true,bounds,...navigation}).then(()=>{if(ticket===webGeneration&&!state.disposed){$('.music-spotify-web-surface p').textContent='Spotify 官方推荐、歌单与收藏';$('[data-spotify-retry]').hidden=true;}}).catch(error=>{if(ticket!==webGeneration||state.disposed)return;webKey=null;webRequestedPath=null;$('.music-spotify-web-surface p').textContent=error.message||'Spotify 官方页面暂时无法打开';$('[data-spotify-retry]').hidden=false;});
    }
    function scheduleWebPlayer(){if(webFrame!==null||state.disposed||!state.webPlayer||!state.active||state.obscured)return;const view=root.ownerDocument.defaultView;if(!view.requestAnimationFrame){syncWebPlayer();return;}webFrame=view.requestAnimationFrame(()=>{webFrame=null;syncWebPlayer();});}
    function renderWebPlayer(){
      $('.music-content-grid').hidden=state.webPlayer;webSection.hidden=!state.webPlayer;root.closest('.music-view')?.classList.toggle('has-spotify-web-player',state.webPlayer);root.dataset.provider=state.provider||'netease';
      for(const button of root.querySelectorAll('[data-spotify-path]')){if(button.dataset.spotifyPath===state.webPath)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
      syncWebPlayer();scheduleWebPlayer();
    }
    function navigateWebPlayer(path){state.webPath=path;webNavigate=true;webKey=null;state.query=path.startsWith('/search/')?searchRoot.querySelector('input').value.trim():'';searchRoot.querySelector('.music-search-clear').hidden=!state.query;renderWebPlayer();}
    function notice(value=''){if(!state.disposed)onNotice(value);}
    function cover(value,size=80,priority=false){const url=imageURL(value||'');return url?`<img data-cover ${priority?'data-cover-priority="high" ':''}width="${size}" height="${size}" ${priority?'src':'data-cover-src'}="${esc(url)}" alt="" loading="${priority?'eager':'lazy'}" decoding="async">`:'<span class="music-cover-fallback" aria-hidden="true">♪</span>';}
    const duration=value=>{const seconds=Math.max(0,Math.floor(Number(value)||0));return seconds?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'';};
    const rows=(items,recent=false)=>items.map((item,index)=>`<button class="music-song-row${recent?' recent':''}" type="button" data-music-song="${esc(item.id)}" data-song-list="${recent?'recent':'songs'}"><span class="music-song-index">${recent?'':String(index+1).padStart(2,'0')}</span><span class="music-song-cover">${cover(item.coverURL)}</span><span class="music-song-copy"><strong>${esc(item.title)}</strong><small>${esc(item.artist||'未知歌手')}</small></span>${recent?'':`<span class="music-song-album">${esc(item.album||'')}</span>`}<time>${duration(item.duration)}</time><span class="music-row-play">${playIcon}</span></button>`).join('');
    function renderModes(){
      const region=$('.music-discovery-modes');
      region.hidden=Array.isArray(state.discoveryModes)&&!state.discoveryModes.length;
      if(!region.children.length)region.innerHTML=modeSpecs.map(([mode,title])=>`<button type="button" class="music-discovery-mode" data-music-discovery="${mode}" aria-pressed="false"><span class="music-mode-art"></span><span class="music-mode-shade"></span><strong><i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${modePaths[mode]}</svg></i>${title}</strong><small></small></button>`).join('');
      const usedQQCovers=new Set();
      for(const [mode]of modeSpecs){
        const button=region.querySelector(`[data-music-discovery="${mode}"]`),entry=modeViews.get(mode);
        let first=mode==='daily'?(entry?.first||state.cards[0]||state.songs[0]):entry?.first;
        button.hidden=Array.isArray(state.discoveryModes)&&!state.discoveryModes.includes(mode);
        if(!button.hidden&&(first?.source==='qq'||first?.provider==='qq')){
          // QQ charts can share their first song or album. Use another real
          // song from this same chart for its card, without reordering playback.
          const candidates=modeResults.get(modeKey(mode))?.songs||(mode==='daily'?state.cards:[]);
          const coverKey=song=>String(song?.coverURL||'').split('?')[0];
          first=candidates.find(song=>coverKey(song)&&!usedQQCovers.has(coverKey(song)))||first;
          if(coverKey(first))usedQQCovers.add(coverKey(first));
        }
        const url=imageURL(first?.coverURL||''),art=button.querySelector('.music-mode-art');
        button.querySelector('strong').lastChild.textContent=modeTitle(mode);
        button.setAttribute('aria-pressed',String(state.discovery===mode));button.setAttribute('aria-busy',String(state.pendingMode===mode||entry?.status==='loading'));button.dataset.modeState=entry?.status||(mode==='daily'&&first?'ready':['radar','fm','heart'].includes(mode)&&state.mode!=='personal'?'login':'idle');button.title=entry?.message||first?.title||'';
        if(art.dataset.coverUrl!==url){art.dataset.coverUrl=url;art.innerHTML=cover(first?.coverURL,220,mode==='daily');}
        button.querySelector('small').textContent=state.pendingMode===mode?'正在载入歌曲…':entry?.status==='loading'?'读取歌曲…':entry?.status==='error'?'暂不可用，点击重试':first?.title||(['radar','fm','heart'].includes(mode)&&state.mode!=='personal'?'登录后使用':mode==='similar'?'从当前或每日首曲出发':'点击读取歌曲');
      }
    }
    function render(){
      renderWebPlayer();if(state.webPlayer)return;
      if(state.disposed)return;$('.music-playlists-section h2').textContent='推荐歌单';$('.music-songs-heading').textContent=state.discovery?state.query:state.query?'搜索结果':'为你推荐歌曲';$('.music-song-count').textContent=state.songs.length?`${state.songs.length} 首`:'';renderModes();
      $('.music-recommendation-mode').textContent=state.recommendationLabel;
      $('.music-playlist-list').innerHTML=state.playlists.length?state.playlists.slice(0,18).map((item,index)=>`<button class="music-playlist" type="button" data-music-playlist="${esc(item.id)}"><span class="music-playlist-cover">${cover(item.coverURL,384,index===0)}<span class="music-cover-play">${playIcon}</span></span><strong title="${esc(item.title)}">${esc(item.title)}</strong><small>${esc(item.subtitle||'精选歌单')}</small></button>`).join(''):`<p class="music-empty-copy">${state.loading?'正在寻找歌单…':state.query?'没有找到相关歌单。':'歌单暂时未能加载，稍后可再试。'}</p>`;
      $('.music-song-list').innerHTML=state.songs.length?rows(state.songs.slice(0,visibleSongs))+(state.songs.length>visibleSongs?'<button type="button" class="music-library-button" data-music-more-songs>显示更多歌曲</button>':''):`<p class="music-empty-copy">${state.loading?'正在加载歌曲…':state.discovery?'此模式暂未返回可用歌曲。':state.query?'没有找到相关歌曲，试试歌手或其他关键词。':'推荐歌曲暂时未能加载。'}</p>`;
      cards?.update(state.cards.map(item=>({...item,coverURL:imageURL(item.coverURL||'')})));if(state.active&&!state.obscured)cards?.activate();
      searchRoot.querySelector('.music-search-clear').hidden=!state.query;covers?.refresh();
    }
    async function modeData(mode,{force=false}={}){
      const key=modeKey(mode);if(!force&&modeResults.has(key))return modeResults.get(key);if(!force&&modeJobs.has(key))return modeJobs.get(key);
      const ticket=visit,seed=modeSeed();modeViews.set(mode,{status:'loading'});renderModes();
      const task=(async()=>{try{const result=await request('discovery',{mode,preview:true,...(['heart','similar'].includes(mode)&&seed?{seedId:seed}:{})});if(state.disposed||!state.active||ticket!==visit||key!==modeKey(mode))throw new Error('音乐发现已更新，请重试');if(!Array.isArray(result.songs)||!result.songs.length)throw new Error(result.message||'此模式暂时没有返回歌曲');modeResults.set(key,result);modeViews.set(mode,{status:'ready',first:result.songs[0],message:result.message||''});return result;}catch(error){if(!state.disposed&&state.active&&ticket===visit&&key===modeKey(mode))modeViews.set(mode,{status:'error',message:error.message});throw error;}finally{if(modeJobs.get(key)===task)modeJobs.delete(key);if(!state.disposed&&state.active&&ticket===visit){renderModes();covers?.refresh();}}})();modeJobs.set(key,task);return task;
    }
    async function previewModes(ticket,modes=['radar','fm','heart','similar']){const queue=modes.filter(mode=>(!Array.isArray(state.discoveryModes)||state.discoveryModes.includes(mode))&&(Array.isArray(state.discoveryModes)||mode==='similar'||state.mode==='personal'));const worker=async()=>{while(queue.length&&state.active&&!state.disposed&&ticket===visit){const mode=queue.shift();try{await modeData(mode);}catch{}}};await Promise.all([worker(),worker()]);}
    async function loadDeck(ticket){try{const result=await request('deck');if(state.disposed||!state.active||ticket!==visit)return;deckLoaded=true;const ordered=Array.isArray(result.cards)?result.cards.slice(0,530):[];if(ordered.length){state.cards=ordered;cards?.update(ordered.map(item=>({...item,coverURL:imageURL(item.coverURL||'')})));}if(result.message)notice(result.message);}catch{/* Home daily songs remain available if the private queue is unavailable. */}}
    function updateListening(value){if(!value||state.disposed)return;const number=value=>Math.max(0,Number.isFinite(Number(value))?Number(value):0);$('[data-listening="minutes"]').textContent=String(Math.floor(number(value.todaySeconds)/60));$('[data-listening="songs"]').textContent=String(Math.floor(number(value.todaySongs)));$('[data-listening="streak"]').textContent=String(Math.floor(number(value.streakDays)));}
    function play(song,{queue,supersede=true}={}){
      if(!song?.id||!state.active||state.disposed)return;
      // A direct song/card click wins over any playlist that is still loading.
      if(supersede){generation++;homeRequest=null;state.loading=false;state.pendingMode=null;renderModes();}
      const seen=new Set(),items=queue||[...state.songs,...state.cards,...state.recent];
      onPlay(song,{queue:items.filter(item=>item?.id&&!seen.has(String(item.id))&&seen.add(String(item.id)))});
    }
    async function home({force=false}={}){
      if(state.disposed||!state.active)return;if(homeRequest&&!force)return homeRequest;const ticket=++generation;state.loading=true;state.query='';state.discovery=null;searchRoot.querySelector('input').value='';notice();render();
      homeRequest=(async()=>{
        try{
          const result=await request('home',{refreshPlaylists:true});
          if(state.disposed||!state.active||ticket!==generation)return;
          state.provider=result.provider||'netease';state.webPlayer=state.provider==='spotify'&&result.webPlayer===true;
          if(state.webPlayer){clearModes();clearDay();state.songs=[];state.playlists=[];state.homePlaylists=[];state.recent=[];state.cards=[];state.discoveryModes=[];cards?.deactivate();covers?.deactivate();playlistsScroll?.deactivate();return;}
          state.songs=Array.isArray(result.songs)?result.songs:[];
          state.playlists=Array.isArray(result.playlists)?result.playlists:[];
          state.homePlaylists=state.playlists;
          state.recent=Array.isArray(result.recent)?result.recent:[];
          if(!deckLoaded)state.cards=Array.isArray(result.cards)?result.cards.slice(0,530):state.songs.slice(0,30);
          state.mode=result.recommendationMode==='personal'?'personal':'public';
          state.recommendationLabel=typeof result.recommendationLabel==='string'?result.recommendationLabel.slice(0,60):state.mode==='personal'?'每日推荐':'公开每日推荐';
          state.discoveryModes=Array.isArray(result.discoveryModes)?result.discoveryModes.filter(mode=>modeSpecs.some(value=>value[0]===mode)):null;
          state.discoveryLabels={};
          for(const [mode]of modeSpecs){
            const label=result.discoveryLabels?.[mode];
            if(typeof label==='string'&&label.trim())state.discoveryLabels[mode]=label.trim().slice(0,20);
          }
          updateListening(result.listening);
          if(result.message)notice(result.message);
          if(!deckLoaded)loadDeck(visit);
          previewModes(visit);
        }catch(value){
          if(ticket===generation&&!state.disposed){notice(value.message||'音乐推荐暂时不可用');onError(value.message);}
        }finally{
          if(ticket===generation){state.loading=false;homeRequest=null;render();}
        }
      })();
      return homeRequest;
    }
    async function search(query){const value=String(query||'').trim();if(!value)return home();const ticket=++generation;state.query=value;state.discovery=null;state.loading=true;notice();render();try{const result=await request('search',{query:value});if(state.disposed||!state.active||ticket!==generation)return;state.songs=Array.isArray(result.songs)?result.songs:[];state.playlists=Array.isArray(result.playlists)?result.playlists:[];}catch(error){if(ticket===generation)notice(error.message||'搜索暂时不可用');}finally{if(ticket===generation&&!state.disposed){state.loading=false;render();}}}
    async function playlist(id){const ticket=++generation;state.loading=true;notice();try{const result=await playlistModule.read({request,id,current:()=>!state.disposed&&state.active&&ticket===generation});if(state.disposed||!state.active||ticket!==generation)return;state.discovery=null;state.query=result.playlist?.title||'歌单歌曲';state.songs=Array.isArray(result.songs)?result.songs:[];searchRoot.querySelector('input').value='';if(state.songs.length)play({...state.songs[0],position:0},{queue:state.songs,supersede:false});else notice('这个歌单暂时没有可播放歌曲');}catch(value){if(ticket===generation)notice(value.message||'歌单暂时不可用');}finally{if(ticket===generation&&!state.disposed){state.loading=false;render();}}}
    async function discover(mode){if(Array.isArray(state.discoveryModes)&&!state.discoveryModes.includes(mode))return;const ticket=++generation;state.loading=true;state.pendingMode=mode;state.discovery=mode;state.query=modeTitle(mode)+' · 正在载入';notice();renderModes();$('.music-songs-heading').textContent=state.query;
      try{const result=await modeData(mode,{force:modeViews.get(mode)?.status==='error'});if(state.disposed||!state.active||ticket!==generation)return;state.query=result.label||'音乐发现';state.songs=result.songs;state.playlists=state.homePlaylists;searchRoot.querySelector('input').value='';if(result.message)notice(result.message);play({...state.songs[0],position:0},{queue:state.songs,supersede:false});}
      catch(value){if(ticket===generation){state.query=modeTitle(mode);state.songs=[];notice(value.message||'该发现模式暂时不可用');}}
      finally{if(ticket===generation&&!state.disposed){state.loading=false;state.pendingMode=null;render();const section=$('.music-songs-section');section.scrollIntoView?.({block:'start',behavior:root.ownerDocument.defaultView.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}}
    }
    on(searchRoot,'submit',event=>{event.preventDefault();const query=searchRoot.querySelector('input').value.trim();if(state.webPlayer)navigateWebPlayer(query?'/search/'+encodeURIComponent(query):'/');else search(query);});on(searchRoot.querySelector('.music-search-clear'),'click',()=>{if(state.webPlayer){searchRoot.querySelector('input').value='';navigateWebPlayer('/');}else home({force:true});});
    on(root,'click',event=>{if(event.target.closest('[data-music-more-songs]')){visibleSongs+=100;render();return;}const mode=event.target.closest('[data-music-discovery]');if(mode){discover(mode.dataset.musicDiscovery);return;}const song=event.target.closest('[data-music-song]');if(song){const list=song.dataset.songList==='recent'?state.recent:state.songs;play(list.find(item=>String(item.id)===song.dataset.musicSong));return;}const target=event.target.closest('[data-music-playlist]');if(target)playlist(target.dataset.musicPlaylist);});
    on(root,'error',event=>{if(event.target.tagName==='IMG'){event.target.hidden=true;event.target.parentNode.classList.add('cover-unavailable');}},true);
    on(webSection,'click',event=>{const path=event.target.closest('[data-spotify-path]');if(path){navigateWebPlayer(path.dataset.spotifyPath);return;}if(event.target.closest('[data-spotify-retry]')){webKey=null;webRequestedPath=null;syncWebPlayer();return;}if(event.target.closest('[data-spotify-browser]'))request('platformWebPlayer',{provider:'spotify',action:'browser'}).catch(error=>notice(error.message||'无法打开 Spotify 官方播放器'));});
    const view=root.ownerDocument.defaultView;if(typeof view.ResizeObserver==='function'){webObserver=new view.ResizeObserver(scheduleWebPlayer);webObserver.observe($('.music-spotify-web-surface'));}on(view,'resize',scheduleWebPlayer);
    render();
    return {activate(){if(state.disposed)return;state.active=true;visit++;deckLoaded=false;clearModes();scheduleDay();playlistsScroll?.activate();covers?.activate();cards?.activate();return home();},deactivate(){state.active=false;hideWebPlayer();visit++;deckLoaded=false;clearDay();++generation;homeRequest=null;playlistsScroll?.deactivate();covers?.deactivate();cards?.deactivate();},setObscured(value){state.obscured=!!value;syncWebPlayer();if(state.obscured){cards?.deactivate();covers?.deactivate();playlistsScroll?.deactivate();}else if(state.active&&!state.webPlayer){cards?.activate();covers?.activate();playlistsScroll?.activate();}},providerChanged(){hideWebPlayer();state.webPlayer=false;state.webPath='/';visit++;deckLoaded=false;clearModes();state.songs=[];state.playlists=[];state.homePlaylists=[];state.recent=[];state.cards=[];state.seedId=null;state.discoveryModes=[];render();return home({force:true});},refresh:()=>{visit++;deckLoaded=false;clearModes();return home({force:true});},updateListening,setSong(song){const next=song?.id||null;if(next===state.seedId)return;state.seedId=next;for(const mode of ['heart','similar']){modeViews.delete(mode);for(const key of modeResults.keys())if(key.startsWith(mode+':'))modeResults.delete(key);}if(state.active&&!state.webPlayer)previewModes(visit,['heart','similar']);},addRecent(song){if(!song?.id||state.disposed)return;state.recent=[song,...state.recent.filter(item=>String(item.id)!==String(song.id))].slice(0,20);},getState:()=>({provider:state.provider||'netease',webPlayer:state.webPlayer,webPath:state.webPath,query:state.query,songs:state.songs.length,playlists:state.playlists.length,recent:state.recent.length,mode:state.mode,modePreviews:[...modeViews].map(([mode,value])=>({mode,status:value.status,songId:value.first?.id||null})),active:state.active,loading:state.loading,cards:cards?.getState?.()||null}),dispose(){if(state.disposed)return;hideWebPlayer();webObserver?.disconnect();root.closest('.music-view')?.classList.remove('has-spotify-web-player');state.disposed=true;clearModes();clearDay();++generation;playlistsScroll?.dispose();covers?.dispose();cards?.dispose();listeners.splice(0).forEach(remove=>remove());root.replaceChildren();searchRoot.replaceChildren();}};
  }
  return {create};
});
