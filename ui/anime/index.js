(function (host, factory) {
  'use strict';
  const api = factory(typeof module==='object'&&module.exports?require('../movies/carousel.js'):host.PulseMovieCarousel,typeof module==='object'&&module.exports?require('../cover-loading.js'):host.PulseCoverLoading,typeof module==='object'&&module.exports?require('./featured-rotation.js'):host.PulseAnimeFeaturedRotation);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else host.PulseAnimeUI = api;
})(typeof window === 'object' ? window : globalThis, function (movieCarouselModule,coverLoadingModule,featuredRotationModule) {
  'use strict';
  const DEFAULT_CATEGORIES = ['主页', '热门', '日常', '原创', '异世界', '热血', '悬疑', '治愈', '搞笑'];
  const MOVIE_CATEGORIES = ['主页', '热门', '电影', '电视剧', '动作', '喜剧', '科幻', '悬疑', '爱情', '恐怖', '动画', '纪录片'];
  const glyphs = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    play: '<path d="M8 5 20 12 8 19Z"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5"/><circle cx="15" cy="17" r="2.5"/>',
    back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
    star: '<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3a7 7 0 0 0 11.6-1"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    source: '<path d="M8 4h8v5h4v7h-5v4H8v-4H4V9h4Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${glyphs[name] || glyphs.film}</svg>`;
  function safeImage(value) {
    if (typeof value !== 'string' || value.length > 16000000) return '';
    if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z\d+/=\s]+$/i.test(value)) return value;
    try { const url = new URL(value); return ['https:', 'http:', 'pulse-anime:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  function normalizeItem(value) {
    if (!value || typeof value !== 'object') return null;
    const id = String(value.id ?? '');
    if (!id) return null;
    return { ...value, id, title: String(value.title || value.name_cn || value.name || '未命名番剧'), originalTitle: String(value.originalTitle || ''), summary: String(value.summary || ''), cover: safeImage(value.cover || ''), coverLarge: safeImage(value.coverLarge || value.cover || ''), tags: Array.isArray(value.tags) ? value.tags.map(tag => String(typeof tag === 'string' ? tag : tag?.name || '')).filter(Boolean).slice(0, 8) : [], score: Number(value.score) > 0 ? Number(value.score) : null, rank: Number(value.rank) > 0 ? Number(value.rank) : null };
  }
  const normalizeItems = values => (Array.isArray(values) ? values : []).map(normalizeItem).filter(Boolean);
  function create({ root, api, subscribeHistory, kind = 'anime', scrollRoot = root?.closest?.('.content-scroll'), imageURL = value => /^https?:/i.test(value) ? `pulse-anime-image://image?url=${encodeURIComponent(value)}` : value } = {}) {
    if (!root || typeof root.querySelector !== 'function' || typeof api !== 'function') throw new TypeError('Anime UI requires a root element and an API function');
    const document = root.ownerDocument, movies=kind==='movies', noun=movies?'影视':'番剧', inputId=movies?'movies-query':'anime-query', defaults=movies?MOVIE_CATEGORIES:DEFAULT_CATEGORIES;
    const state = { active: false, disposed: false, loaded: false, mode: 'home', category: '主页', query: '', categories: defaults, rules: [], settings: { adFilter:true }, network: { bangumi: 'mirror', rules: 'ghProxy', images: 'ech' }, networkOptions: {}, history: [], historyRevision: -1, home: null, catalog: [], total: null, offset: 0, nextOffset: 0, hasMore: false, pageLoading: false, pageError: '', duplicatePages: 0, selected: null, sources: null, lines: [], selectedSource: null, settingsTab: 'rules', settingsQuery: '', repository: null, busy: new Set(), message: '', notice: '', sequence: 0, bootstrap: null };
    const qualityResults=new Map(),qualityPending=new Set();
    const itemStore = new Map();
    const listeners = [];
    let pan = null, suppressTabClick = false, messageTimer = null, activeRequest = 0, dialogPreviousFocus = null, pageObserver = null, historyEvents = 0, movieCarousel=null, movieCarouselRoot=null, sourceJob=null, featuredRotation=null, featuredRoot=null, featuredPreload=null,featuredNextCover='';
    root.classList.add('anime-view');if(movies)root.classList.add('movies-view');
    root.innerHTML = `<div class="anime-toolbar"><form class="anime-search" data-no-window-drag role="search"><label class="anime-sr-only" for="${inputId}">搜索${noun}</label>${icon('search')}<input id="${inputId}" name="query" type="search" placeholder="搜索${noun}名称…" maxlength="120" autocomplete="off"><button type="submit" aria-label="搜索${noun}">${icon('arrow')}</button></form><div class="anime-category-viewport" data-no-window-drag><nav class="anime-categories" aria-label="${noun}分类"></nav></div><button class="anime-icon-button anime-settings-trigger" data-action="settings" title="${movies?'片源与播放设置':'规则与网络设置'}" aria-label="${movies?'片源与播放设置':'规则与网络设置'}">${icon('settings')}</button></div><div class="anime-message" role="status" hidden></div><div class="anime-content" aria-live="polite"></div><div class="anime-dialog-host"></div>`;
    const $ = selector => root.querySelector(selector);
    const on = (target, event, callback, options) => { target.addEventListener(event, callback, options); listeners.push(() => target.removeEventListener(event, callback, options)); };
    const covers=coverLoadingModule?.create({root,scrollRoot});
    function clearFeaturedPreload(){if(featuredPreload){featuredPreload.removeAttribute('src');featuredPreload=null;}}
    function syncFeaturedPreload(){
      if(document.hidden||!state.active||state.mode!=='home'||$('.anime-dialog')||!featuredNextCover){clearFeaturedPreload();return;}
      const url=imageURL(featuredNextCover);if(featuredPreload?.src===url)return;
      clearFeaturedPreload();if(typeof document.defaultView.Image==='function'){featuredPreload=new document.defaultView.Image();featuredPreload.decoding='async';featuredPreload.src=url;}
    }
    function remember(item) { const normalized = normalizeItem(item); if (normalized) itemStore.set(normalized.id, normalized); return normalized; }
    function poster(item, className = '', loading = 'lazy',priority=loading==='eager'?'high':'auto') {
      return `<span class="anime-poster ${className}">${item.cover ? `<img data-cover data-cover-priority="${priority}" ${loading==='lazy'?'data-cover-src':'src'}="${esc(imageURL(item.cover))}" alt="" loading="${loading}" fetchpriority="${priority}" decoding="async" width="300" height="450" referrerpolicy="no-referrer">` : ''}<span class="anime-poster-fallback" aria-hidden="true">${icon('film')}</span></span>`;
    }
    function metrics(item) { return `${item.score ? `<span class="anime-score">${icon('star')}${item.score.toFixed(1)}</span>` : ''}${item.rank ? `<span class="anime-rank">#${item.rank}</span>` : ''}`; }
    function message(text, failure = false) {
      state.message = String(text || ''); const el = $('.anime-message'); el.hidden = !text; el.textContent = state.message; el.dataset.error = String(failure);
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = text && !failure ? setTimeout(() => { if (!state.disposed) { el.hidden = true; state.message = ''; } }, 6000) : null;
    }
    function errorText(error, fallback = `${noun}服务暂时不可用，请稍后重试。`) {
      const candidates = [typeof error === 'string' ? error : null, error?.message, error?.error?.message, error?.cause?.message, typeof error?.error === 'string' ? error.error : null];
      const text = candidates.filter(value => typeof value === 'string').map(value => value.trim()).find(value => value && !/^(Error|TypeError|\[object Object\])$/i.test(value));
      if (!text) return fallback;
      if (/^(fetch failed|Failed to fetch|NetworkError)/i.test(text)) return '无法连接番剧服务，请检查网络或稍后重试。';
      return text.slice(0, 600);
    }
    async function request(action, payload = {}) {
      const value = await api(action, payload);
      if (value?.error && !value.ruleId) throw new Error(errorText(value.error));
      return value;
    }
    async function task(key, job) {
      if (state.busy.has(key) || state.disposed) return;
      const sequence = activeRequest; state.busy.add(key); refreshBusy();
      try { return await job(); } catch (error) { if (!state.disposed && state.active && sequence === activeRequest && !/abort|cancel|已取消/i.test(`${error?.name || ''} ${error?.message || ''}`)) message(errorText(error), true); }
      finally { state.busy.delete(key); if (!state.disposed) refreshBusy(); }
    }
    function refreshBusy() {
      root.querySelectorAll('[data-busy]').forEach(button => { button.disabled = state.busy.has(button.dataset.busy); });
      root.querySelectorAll('[data-network]').forEach(control => { control.disabled = state.busy.has('network'); });
      root.querySelectorAll('[data-rule-toggle],[data-rule-move],[data-rule-edit],[data-source-toggle],[data-source-edit],[data-source-delete]').forEach(control => {
        const index=state.rules.findIndex(rule=>String(rule.id||rule.name)===control.dataset.ruleMove),next=index+Number(control.dataset.direction);
        control.disabled=state.busy.has('rules-write')||(control.hasAttribute('data-rule-move')&&(index<0||next<0||next>=state.rules.length));
      });
    }
    async function cancelRequests() { try { await api('cancel', {}); } catch { /* Navigation also works with an older adapter. */ } }
    function renderCategories() {
      $('.anime-categories').innerHTML = state.categories.map(category => `<button type="button" data-category="${esc(category)}" class="anime-category${category === state.category ? ' active' : ''}" aria-pressed="${category === state.category}">${esc(category)}</button>`).join('');
    }
    function smallCard(raw, index) {
      const item = remember(raw);
      return `<button class="anime-hot-card" data-item="${esc(item.id)}">${poster(item,'','eager','auto')}<span class="anime-small-copy"><span class="anime-item-kicker">${index < 3 ? '热门推荐' : noun}</span><strong>${esc(item.title)}</strong><span class="anime-small-meta">${metrics(item)}</span></span><span class="anime-play-dot">${icon('play')}</span></button>`;
    }
    function featureCard(raw, hero = false) {
      const item = remember(raw);
      return `<button class="anime-feature-card${hero ? ' anime-hero' : ''}" data-item="${esc(item.id)}">${poster(hero&&!movies?{...item,cover:item.coverLarge||item.cover}:item, '', hero ? 'eager' : 'lazy')}<span class="anime-card-shade"></span>${hero ? `<span class="anime-feature-label">${icon('star')}高分热门</span>` : ''}<span class="anime-feature-copy"><span class="anime-tags">${item.tags.slice(0, hero ? 3 : 1).map(tag => `<span>${esc(tag)}</span>`).join('')}</span><strong>${esc(item.title)}</strong>${item.originalTitle && hero ? `<span class="anime-original-title">${esc(item.originalTitle)}</span>` : ''}<span class="anime-feature-summary">${esc(item.summary || `查看${noun}详情与可用播放源`)}</span><span class="anime-feature-bottom"><span class="anime-card-metrics">${metrics(item)}</span><span class="anime-watch${hero ? '' : ' anime-watch-icon'}">${icon('play')}${hero ? '<span>开始观看</span>' : ''}</span></span></span></button>`;
    }
    function historyCards() {
      return state.history.slice(0, 5).map(record => { const item = remember(record.subject || record.item || record); if (!item) return ''; const episode = record.episodeName || record.episodeTitle || record.episode?.title || ''; const progress = Number(record.duration) > 0 ? Number(record.position) / Number(record.duration) : Number(record.progress); return `<button class="anime-history-card" data-history="${esc(item.id)}">${poster(item)}<span><strong>${esc(item.title)}</strong><small>${esc(episode || '继续观看')}</small>${progress > 0 ? `<span class="anime-history-progress"><i style="width:${Math.max(0, Math.min(100, progress * 100))}%"></i></span>` : ''}</span><i class="anime-play-dot">${icon('play')}</i></button>`; }).join('');
    }
    function renderHistory() {
      const panel = $('.anime-history-panel'); if (!panel || state.mode !== 'home') return;
      panel.querySelector('.anime-section-heading').innerHTML = `<h2>继续观看</h2>${state.history.length ? '<button class="anime-quiet-button" data-action="history-clear" title="清空观看历史">清空</button>' : ''}`;
      panel.querySelector('.anime-history-list').innerHTML = historyCards();
      covers?.refresh();
    }
    function acceptHistory(value) {
      if (!Array.isArray(value?.history)) return false;
      const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : null;
      if (revision === null ? state.historyRevision >= 0 : revision < state.historyRevision) return false;
      state.history = value.history.slice(0, 100);
      if (revision !== null) state.historyRevision = revision;
      if (state.active && state.mode === 'home') renderHistory();
      return true;
    }
    async function refreshHistory() {
      const sequence = historyEvents, result = await request('history');
      if (!state.disposed && (Number.isSafeInteger(result?.revision) || sequence === historyEvents)) acceptHistory(result);
    }
    function stopPagination() { pageObserver?.disconnect(); pageObserver = null; }
    function requestMore() {
      if (!state.active || state.disposed || state.mode !== 'catalog' || !state.hasMore || state.pageLoading || state.pageError) return;
      loadCatalog(state.category, state.query, true);
    }
    function onCatalogScroll() {
      if (!scrollRoot || scrollRoot.clientHeight <= 0 || scrollRoot.scrollHeight <= 0) return;
      if (scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight <= 360) requestMore();
    }
    function watchPagination() {
      stopPagination();
      const sentinel = $('.anime-load-more'); if (!sentinel || !state.hasMore || state.pageError || !state.active) return;
      if (typeof document.defaultView.IntersectionObserver === 'function') {
        const sequence = activeRequest;
        const observer = new document.defaultView.IntersectionObserver(entries => { if (sequence === activeRequest && pageObserver === observer && entries.some(entry => entry.isIntersecting)) requestMore(); }, { root: scrollRoot || null, rootMargin: '0px 0px 360px 0px' });
        pageObserver = observer; observer.observe(sentinel);
      }
    }
    function paginationMarkup() {
      if (state.pageLoading) return `<div class="anime-load-more" role="status">正在加载更多${noun}…</div>`;
      if (state.pageError) return `<div class="anime-load-more anime-page-error"><span>${esc(state.pageError)}</span><button class="anime-button" data-action="more">重试加载</button></div>`;
      return state.hasMore ? '<div class="anime-load-more"><button class="anime-button" data-action="more">加载更多</button></div>' : `<div class="anime-catalog-end" role="status">已显示全部${noun}</div>`;
    }
    function refreshPagination() {
      const previous = $('.anime-load-more,.anime-catalog-end');
      if (previous) previous.outerHTML = paginationMarkup();
      watchPagination();
    }
    function empty(title, detail = '', retry = false) { return `<div class="anime-empty">${icon('film')}<strong>${esc(title)}</strong>${detail ? `<p>${esc(detail)}</p>` : ''}${retry ? '<button class="anime-button" data-action="retry">重新加载</button>' : ''}</div>`; }
    function loading(label) { return `<div class="anime-loading"><i></i><span>${esc(label)}</span></div>`; }
    function renderHome() {
      const hot = normalizeItems(state.home?.hot), featured = normalizeItems(state.home?.featured).slice(0, 5);
      const top=movies?'<div class="movie-carousel-mount"></div>':featured.length?'<span class="anime-hero-mount" style="display:contents"></span>':'';
      $('.anime-content').innerHTML = `<div class="anime-home-layout"><aside class="anime-left-column"><section class="anime-side-panel anime-hot-panel"><div class="anime-section-heading"><h2>热门${noun}</h2><button class="anime-quiet-button" data-category="热门">查看全部 ${icon('arrow')}</button></div><div class="anime-hot-list">${hot.length ? hot.slice(0, 3).map(smallCard).join('') : empty(`暂未获取到${noun}`)}</div></section><section class="anime-side-panel anime-history-panel"><div class="anime-section-heading"><h2>继续观看</h2>${state.history.length ? `<button class="anime-quiet-button" data-action="history-clear" title="清空观看历史">清空</button>` : ''}</div><div class="anime-history-list">${historyCards()}</div></section></aside><section class="anime-featured" aria-label="高分热门${noun}">${featured.length||movies ? `${top}<div class="anime-featured-row">${featured.slice(1).map(item => featureCard(item)).join('')}</div>` : empty(`${noun}加载未完成`, state.notice || '检查网络设置后可重新加载。', true)}</section></div>${state.notice ? `<p class="anime-page-note">${esc(state.notice)}</p>` : ''}`;
      if(!movies&&featured.length&&featuredRotationModule){
        if(!featuredRoot){
          featuredRoot=document.createElement('section');featuredRoot.className='anime-featured-rotator';featuredRoot.setAttribute('role','region');featuredRoot.setAttribute('aria-roledescription','轮播');featuredRoot.setAttribute('aria-label','高分热门番剧');featuredRoot.setAttribute('data-no-window-drag','');
          const arrow=direction=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction==='previous'?'m14 6-6 6 6 6':'m10 6 6 6-6 6'}"/></svg>`;
          featuredRoot.innerHTML=`<div class="anime-rotation-scene"></div><button type="button" class="anime-featured-arrow anime-featured-previous" data-featured-direction="previous" aria-label="上一部推荐番剧">${arrow('previous')}</button><button type="button" class="anime-featured-arrow anime-featured-next" data-featured-direction="next" aria-label="下一部推荐番剧">${arrow('next')}</button><div class="anime-featured-dots" role="group" aria-label="选择推荐番剧"></div>`;
          featuredRotation=featuredRotationModule.create({
            load:async({isCurrent})=>normalizeItems(await featuredRotationModule.collect(payload=>request('catalog',payload),[],{isCurrent})),
            isVisible:()=>!document.hidden&&state.active&&state.mode==='home'&&!$('.anime-dialog'),
            onChange:(item,next,rotation)=>{
              if(state.disposed)return;featuredRoot.querySelector('.anime-rotation-scene').innerHTML=featureCard(item,true);
              const dots=featuredRoot.querySelector('.anime-featured-dots'),identity=rotation.items.map(value=>String(value.id)).join(',');
              if(dots.dataset.items!==identity){dots.dataset.items=identity;dots.innerHTML=rotation.items.map((value,index)=>`<button type="button" class="anime-featured-dot" data-featured-index="${index}" aria-label="第${index+1}部：${esc(value.title)}" title="${index+1} · ${esc(value.title)}"></button>`).join('');}
              for(const dot of dots.children)dot.setAttribute('aria-current',String(Number(dot.dataset.featuredIndex)===rotation.index));
              dots.hidden=rotation.items.length<2;for(const button of featuredRoot.querySelectorAll('[data-featured-direction]'))button.hidden=rotation.items.length<2;
              covers?.refresh();
              featuredNextCover=next?.id!==item.id?(next?.coverLarge||next?.cover||''):'';syncFeaturedPreload();
            }
          });
          featuredRotation.seed([...hot,...featured]);
        }
        $('.anime-hero-mount').append(featuredRoot);if(state.active)featuredRotation.activate();syncFeaturedPreload();
      }
      if(movies&&movieCarouselModule){
        if(!movieCarouselRoot){movieCarouselRoot=document.createElement('section');movieCarousel=movieCarouselModule.create({root:movieCarouselRoot,load:payload=>request('recommendations',payload),renderItem:movieMetalCard,onAppend:()=>covers?.refresh(),onOpen:item=>{remember(item);openDetail(item.id);}});}
        $('.movie-carousel-mount').append(movieCarouselRoot);if(state.active)movieCarousel.activate();
      }
    }
    function movieMetalCard(raw,index){const item=remember(raw);return `<button type="button" class="movie-metal-card" data-movie-card="${esc(item.id)}" aria-label="查看${esc(item.title)}，评分${item.score?.toFixed(1)||''}">${poster(item,'',index<4?'eager':'lazy',index<2?'high':'auto')}<span class="anime-card-shade"></span><span class="anime-feature-copy"><strong>${esc(item.title)}</strong><span class="movie-metal-description">${esc(item.year||'高分电影')}</span><span class="anime-feature-bottom">${metrics(item)}<span class="anime-watch anime-watch-icon">${icon('play')}</span></span></span></button>`;}
    function gridCard(raw) { const item = remember(raw); return `<button class="anime-grid-card" data-item="${esc(item.id)}">${poster(item)}<span class="anime-grid-copy"><strong>${esc(item.title)}</strong><span>${metrics(item)}${item.tags[0] ? `<small>${esc(item.tags[0])}</small>` : ''}</span></span><span class="anime-grid-play">${icon('play')}</span></button>`; }
    function catalogCount() { return state.total === null ? `已加载 ${state.catalog.length} 部${noun}` : `${state.total} 部${noun}`; }
    function renderCatalog() {
      stopPagination();
      $('.anime-content').innerHTML = `<div class="anime-results-heading"><div><span class="anime-eyebrow">${movies?'DISCOVER MOVIES':'DISCOVER ANIME'}</span><h1>${esc(state.query ? `“${state.query}”的搜索结果` : state.category)}</h1></div><span data-catalog-count>${catalogCount()}</span></div>${state.catalog.length || state.hasMore ? `<div class="anime-catalog-grid">${state.catalog.map(gridCard).join('')}</div>${paginationMarkup()}` : empty(`没有找到匹配的${noun}`, '尝试其他名称或分类。')}`;
      watchPagination();
    }
    function renderDetail() {
      const item = state.selected;
      if (!item) return;
      const sources = state.sources?.sources || [];
      $('.anime-content').innerHTML = `<section class="anime-detail"><button class="anime-back" data-action="back">${icon('back')}返回${state.category === '主页' ? '主页' : '列表'}</button><div class="anime-detail-overview">${poster(item, 'anime-detail-poster', 'eager')}<div class="anime-detail-copy"><span class="anime-eyebrow">${movies?'MOVIE':'ANIME'} / ${item.rank ? `RANK ${item.rank}` : 'DETAIL'}</span><h1>${esc(item.title)}</h1>${item.originalTitle ? `<p class="anime-original-title">${esc(item.originalTitle)}</p>` : ''}<div class="anime-detail-metrics">${metrics(item)}${item.tags.map(tag => `<span class="anime-tag">${esc(tag)}</span>`).join('')}</div><p class="anime-synopsis">${esc(item.summary || '暂无简介')}</p><div class="anime-detail-actions"><button class="anime-primary" data-action="find-sources" data-busy="sources">${icon('play')}查找播放源</button></div></div></div><section class="anime-playback-section" data-no-window-drag><div class="anime-section-heading"><h2>可用播放源</h2><span>${state.sources ? `${sources.filter(source => source.items?.length).length} 个来源` : (movies?'按已启用片源并行搜索':'按已启用规则并行搜索')}</span></div>${state.busy.has('sources') ? `${loading(movies?'正在搜索已启用片源并验证播放线路…':'正在搜索已启用的番剧规则…')}<button class="anime-button anime-cancel-search" data-action="cancel-sources">取消搜索</button>${renderSources(sources)}` : state.sources ? `${movies&&sources.some(source=>source.items?.length)?'<button class="anime-button movie-quality-trigger" data-action="probe-quality" data-busy="quality">检测片源画质</button>':''}${renderSources(sources)}` : `<p class="anime-playback-hint">${movies?'选择“查找播放源”，比较此影片的可用来源与响应速度。':'选择“查找播放源”，使用 Kazumi 规则搜索此番剧。'}</p>`}<div class="anime-episode-area">${renderEpisodes()}</div></section></section>`;
      refreshBusy();
      covers?.refresh();
    }
    function qualityKey(source,item){return source.ruleId+'\n'+item.url;}
    function qualityBadge(source,item){
      if(!movies)return '';
      const key=qualityKey(source,item),value=qualityResults.get(key);
      const text=qualityPending.has(key)?'检测中…':value?.label||'画质待检测';
      const basis=value?.method==='manifest'?'HLS 清单分辨率':value?.method==='segment'?'样本分片编码尺寸':value?.reason||'检测后显示真实尺寸，不以来源名称推测 4K';
      return `<small class="movie-quality-badge" title="${esc(basis)}">${esc(text)}</small>`;
    }
    async function probeSourceQuality(source,item,sequence=activeRequest){
      const key=qualityKey(source,item);if(qualityPending.has(key))return;
      qualityPending.add(key);if(state.mode==='detail')renderDetail();
      try{
        const result=await request('quality',{ruleId:source.ruleId,url:item.url});
        if(state.disposed||!state.active||sequence!==activeRequest)return;
        qualityResults.delete(key);qualityResults.set(key,result);while(qualityResults.size>160)qualityResults.delete(qualityResults.keys().next().value);
      }catch(error){if(!state.disposed&&state.active&&sequence===activeRequest&&!/取消/.test(error.message))qualityResults.set(key,{label:'画质待实测',reason:errorText(error)});}
      finally{qualityPending.delete(key);if(!state.disposed&&state.active&&sequence===activeRequest&&state.mode==='detail')renderDetail();}
    }
    async function probeSourceQualities(){
      if(!movies||state.busy.has('quality'))return;
      const sequence=activeRequest,targets=(state.sources?.sources||[]).filter(source=>source.items?.length).slice(0,12).map(source=>({source,item:source.items.find(item=>item.title===state.selected?.title)||source.items[0]}));let index=0;
      await task('quality',async()=>{await Promise.all(Array.from({length:Math.min(2,targets.length)},async()=>{while(index<targets.length&&state.active&&!state.disposed&&sequence===activeRequest){const target=targets[index++];await probeSourceQuality(target.source,target.item,sequence);}}));});
    }
    function renderSources(sources) {
      const nonempty = sources.filter(source => source.items?.length);
      return `${nonempty.length ? `<div class="anime-source-groups">${nonempty.map((source, sourceIndex) => `<div class="anime-source-group"><strong>${esc(source.name || source.ruleId)}${movies&&Number.isFinite(source.latencyMs)?` <small class="movie-source-latency">${Math.round(source.latencyMs)} ms</small>`:''}</strong><div>${source.items.slice(0, 30).map((entry, index) => `<button class="anime-source-chip${state.selectedSource?.ruleId === source.ruleId && state.selectedSource?.url === entry.url ? ' active' : ''}" data-source="${sourceIndex}:${index}">${esc(entry.title || '播放条目')}${qualityBadge(source,entry)}</button>`).join('')}</div></div>`).join('')}</div>` : empty('没有匹配的播放源', movies?'可以在片源设置中检查启用状态，或换用其他名称搜索。':'可以在规则设置中检查启用状态，或换用其他名称搜索。')}<details class="anime-source-status"><summary>来源状态 · ${sources.length} 个已检查</summary>${sources.map(source => `<p><strong>${esc(source.name || source.ruleId)}</strong><span>${esc(source.error || `${source.items?.length || 0} 个匹配条目`)}</span></p>`).join('')}</details>`;
    }
    function renderEpisodes() {
      if (state.busy.has('episodes')) return loading('正在读取播放线路与集数…');
      if (!state.selectedSource) return '';
      if (!state.lines.length) return empty('此来源暂未返回可播放集数', '尝试选择其他播放来源。');
      return `<div class="anime-section-heading"><h2>选择集数</h2><span>${esc(state.selectedSource.name || state.selectedSource.ruleId)}</span></div>${state.lines.map((line, lineIndex) => `<div class="anime-episode-line"><h3>${esc(line.name || `线路 ${lineIndex + 1}`)}</h3><div>${(line.episodes || []).map((episode, episodeIndex) => `<button class="anime-episode" data-episode="${lineIndex}:${episodeIndex}" data-busy="play">${esc(episode.title || `第 ${episodeIndex + 1} 集`)}</button>`).join('')}</div></div>`).join('')}`;
    }
    function renderMovieSettings() {
      const filtered=state.rules.filter(source=>`${source.name||source.id} ${source.url||source.baseURL||''}`.toLowerCase().includes(state.settingsQuery.toLowerCase()));
      $('.anime-content').innerHTML=`<section class="anime-settings"><div class="anime-settings-heading"><button class="anime-back" data-action="back">${icon('back')}返回影视</button><div><h1>影视设置</h1><p>管理可用片源与播放偏好</p></div></div><div class="anime-settings-body"><div class="anime-rule-banner"><span class="anime-rule-mark">${icon('source')}</span><div><h2>我的片源</h2><p>使用影片名称跨源搜索，单个来源失败不会影响其他来源。</p></div><div class="anime-rule-actions"><button class="anime-primary" data-action="source-add">＋ 添加片源</button><button class="anime-button" data-action="sources-probe" data-busy="rules-write">${icon('refresh')}测试片源</button></div></div><div class="anime-rule-toolbar"><label class="anime-rule-search" data-no-window-drag>${icon('search')}<input type="search" data-rule-query placeholder="搜索名称或站点" value="${esc(state.settingsQuery)}"></label><span>${state.rules.length} 个片源</span></div><div class="anime-rule-list">${filtered.map(source=>`<article class="anime-rule-row"><span class="anime-rule-avatar">${icon('source')}</span><div class="anime-rule-copy"><strong>${esc(source.name||source.id)}</strong><small>${esc(source.url||source.baseURL||'')}</small><span>${esc(source.error||source.status||(Number.isFinite(source.latencyMs)?`${Math.round(source.latencyMs)} ms`:'等待检测'))}</span></div><label class="anime-rule-toggle" title="${source.enabled===false?'启用片源':'停用片源'}"><span class="anime-sr-only">启用 ${esc(source.name||source.id)}</span><input type="checkbox" data-source-toggle="${esc(source.id||source.name)}" ${source.enabled!==false?'checked':''}></label><button class="anime-button" data-source-edit="${esc(source.id||source.name)}">编辑</button></article>`).join('')||empty('没有符合条件的片源')}</div><div class="anime-network-panel movie-playback-preferences"><span class="anime-eyebrow">PLAYBACK</span><h2>播放偏好</h2><label class="anime-network-row"><span><strong>过滤广告分片</strong><small>按播放列表中的广告特征过滤；无法识别的片段会保留。</small></span><input class="switch" type="checkbox" data-movie-ad-filter ${state.settings.adFilter!==false?'checked':''}></label></div></div></section>`;
      refreshBusy();
    }
    function renderSettings() {
      if(movies){renderMovieSettings();return;}
      $('.anime-content').innerHTML = `<section class="anime-settings"><div class="anime-settings-heading"><button class="anime-back" data-action="back">${icon('back')}返回番剧</button><div><h1>番剧设置</h1><p>独立管理播放规则与访问加速</p></div></div><div class="anime-settings-tabs" data-no-window-drag><button data-settings-tab="rules" class="${state.settingsTab === 'rules' ? 'active' : ''}">规则管理 <span>${state.rules.length}</span></button><button data-settings-tab="network" class="${state.settingsTab === 'network' ? 'active' : ''}">网络设置</button></div><div class="anime-settings-body">${state.settingsTab === 'network' ? networkSettings() : ruleSettings()}</div></section>`;
      refreshBusy();
    }
    function ruleSettings() {
      const filtered = state.rules.filter(rule => `${rule.name || rule.id} ${rule.baseURL || rule.baseUrl || ''}`.toLowerCase().includes(state.settingsQuery.toLowerCase()));
      return `<div class="anime-rule-banner"><span class="anime-rule-mark">${icon('source')}</span><div><h2>我的规则</h2><p>使用 Kazumi 的规则字段与解析方式。按从上到下的顺序搜索。</p></div><div class="anime-rule-actions"><button class="anime-primary" data-action="rule-add">＋ 添加规则</button><button class="anime-button" data-action="repository" data-busy="repository">规则仓库</button></div></div><div class="anime-rule-toolbar"><label class="anime-rule-search" data-no-window-drag>${icon('search')}<input type="search" data-rule-query placeholder="搜索名称或站点" value="${esc(state.settingsQuery)}"></label><button class="anime-button" data-action="rules-update" data-busy="rules-update">${icon('refresh')}更新全部</button></div><div class="anime-rule-list">${filtered.map(rule => { const index = state.rules.indexOf(rule); return `<article class="anime-rule-row"><span class="anime-rule-avatar">${icon('source')}</span><div class="anime-rule-copy"><strong>${esc(rule.name || rule.id)}</strong><small>${esc(rule.baseURL || rule.baseUrl || rule.searchURL || '')}</small><span>v${esc(rule.version || '—')}</span></div><label class="anime-rule-toggle" title="${rule.enabled === false ? '启用规则' : '停用规则'}"><span class="anime-sr-only">启用 ${esc(rule.name || rule.id)}</span><input type="checkbox" data-rule-toggle="${esc(rule.id || rule.name)}" ${rule.enabled !== false ? 'checked' : ''}></label><div class="anime-rule-order"><button data-rule-move="${esc(rule.id || rule.name)}" data-direction="-1" aria-label="上移 ${esc(rule.name || rule.id)}" ${index === 0 ? 'disabled' : ''}>↑</button><button data-rule-move="${esc(rule.id || rule.name)}" data-direction="1" aria-label="下移 ${esc(rule.name || rule.id)}" ${index === state.rules.length - 1 ? 'disabled' : ''}>↓</button></div><button class="anime-button anime-rule-edit" data-rule-edit="${esc(rule.id || rule.name)}">编辑</button></article>`; }).join('') || empty('没有符合条件的规则')}</div>`;
    }
    function networkSettings() {
      const fields = [['bangumi', '番剧条目加速', '番剧信息与评论'], ['rules', '规则仓库加速', '规则下载与更新'], ['images', '图片加速', '封面与头像']];
      return `<div class="anime-network-panel"><span class="anime-eyebrow">NETWORK / ACCESS</span><h2>访问加速</h2>${fields.map(([key, title, description]) => `<label class="anime-network-row"><span><strong>${title}</strong><small>${description}</small></span><select data-network="${key}">${(state.networkOptions[key] || [{ value: state.network[key], label: state.network[key] }]).map(option => `<option value="${esc(option.value)}" ${option.value === state.network[key] ? 'selected' : ''}>${esc(option.label)}${option.description ? ` · ${esc(option.description)}` : ''}</option>`).join('')}</select></label>`).join('')}<p class="anime-network-note">默认沿用 Kazumi：番剧条目使用镜像，规则仓库使用 gh-proxy，图片使用 ECH。修改仅影响番剧模块。</p></div>`;
    }
    function render() { if (state.disposed) return; if(state.mode!=='home'){movieCarousel?.deactivate();featuredRotation?.deactivate();clearFeaturedPreload();}renderCategories(); if (state.mode === 'settings') renderSettings(); else if (state.mode === 'detail') renderDetail(); else if (state.mode === 'catalog') renderCatalog(); else renderHome();covers?.refresh(); }
    async function loadBootstrap() {
      if (state.bootstrap) return state.bootstrap;
      state.bootstrap = request('bootstrap').then(value => { if (state.disposed) return; state.rules = Array.isArray(value?.rules) ? value.rules : []; state.network = { ...state.network, ...value?.network }; state.networkOptions = value?.networkOptions || {}; acceptHistory(value); state.settings={...state.settings,...value?.settings};state.categories = Array.isArray(value?.categories) && value.categories.length ? value.categories.map(String) : defaults; state.loaded = true; renderCategories(); }).catch(error => { state.bootstrap = null; throw error; });
      return state.bootstrap;
    }
    async function loadHome() {
      const sequence = ++activeRequest; sourceJob=null;state.busy.delete('sources');movieCarousel?.deactivate();featuredRotation?.deactivate();clearFeaturedPreload();stopPagination(); state.pageLoading = false; message('');
      state.mode = 'home'; state.category = '主页'; state.query = ''; renderCategories();
      await cancelRequests(); if (state.disposed || sequence !== activeRequest) return;
      $('.anime-content').innerHTML = loading(`正在获取热门${noun}…`);
      try { await loadBootstrap(); const result = await request('home'); if (state.disposed || sequence !== activeRequest) return; state.home = result || {}; acceptHistory(result); state.notice = result?.notice || ''; message(''); render(); }
      catch (error) { if (!state.disposed && sequence === activeRequest) { const detail = errorText(error); $('.anime-content').innerHTML = empty(`暂时无法加载${noun}`, detail, true); message(detail, true); } }
    }
    async function loadCatalog(category, query = '', more = false) {
      if (more && (state.pageLoading || !state.hasMore || state.mode !== 'catalog')) return;
      const sequence = more ? activeRequest : ++activeRequest;
      const offset = more ? state.nextOffset : 0;
      if (!more) {
        sourceJob=null;state.busy.delete('sources');movieCarousel?.deactivate();featuredRotation?.deactivate();clearFeaturedPreload();
        stopPagination(); state.pageLoading = false; state.pageError = ''; state.catalog = []; state.total = null; state.nextOffset = 0; state.hasMore = false; state.duplicatePages = 0; message('');
        state.category = category; state.query = query; state.mode = 'catalog'; renderCategories();
        await cancelRequests(); if (state.disposed || sequence !== activeRequest) return;
        if (scrollRoot) scrollRoot.scrollTop = 0;
        $('.anime-content').innerHTML = loading(query ? `正在搜索${noun}…` : `正在加载${category}${noun}…`);
      }
      state.pageLoading = true; state.pageError = ''; if (more) refreshPagination();
      try {
        await loadBootstrap();
        const result = await request('catalog', { category: query ? '热门' : category, query, offset });
        if (state.disposed || sequence !== activeRequest || state.mode !== 'catalog') return;
        const entries = normalizeItems(result?.items), seen = new Set(state.catalog.map(item => item.id));
        const added = entries.filter(item => !seen.has(item.id) && seen.add(item.id));
        state.catalog = more ? [...state.catalog, ...added] : added;
        state.total = typeof result?.total === 'number' && Number.isFinite(result.total) ? Math.max(0, result.total) : null;
        state.offset = offset;
        const rawCount = Number.isSafeInteger(result?.rawCount) ? result.rawCount : entries.length;
        const nextOffset = Number.isSafeInteger(result?.nextOffset) ? result.nextOffset : offset + rawCount;
        state.nextOffset = Math.max(offset, nextOffset);
        state.hasMore = typeof result?.hasMore === 'boolean' ? result.hasMore : state.total !== null ? state.nextOffset < state.total : rawCount >= (Number(result?.limit) || 24);
        if (nextOffset <= offset || rawCount === 0) state.hasMore = false;
        state.duplicatePages = more && rawCount > 0 && added.length === 0 ? state.duplicatePages + 1 : 0;
        if (state.duplicatePages >= 2 && state.hasMore) state.pageError = '来源连续返回重复条目，可手动继续加载。';
        state.pageLoading = false; message('');
        if (more && $('.anime-catalog-grid')) {
          $('.anime-catalog-grid').insertAdjacentHTML('beforeend', added.map(gridCard).join(''));
          covers?.refresh();
          $('[data-catalog-count]').textContent = catalogCount(); refreshPagination();
        } else render();
      } catch (error) {
        if (sequence === activeRequest && !state.disposed) {
          state.pageLoading = false; const detail = errorText(error);
          if (more) { state.pageError = detail; refreshPagination(); }
          else { $('.anime-content').innerHTML = empty(`暂时无法加载${noun}`, detail, true); message(detail, true); }
        }
      } finally { if (sequence === activeRequest) state.pageLoading = false; }
    }
    async function openDetail(id) {
      const item = itemStore.get(String(id)); if (!item) return;
      const sequence = ++activeRequest; sourceJob=null;state.busy.delete('sources');movieCarousel?.deactivate();featuredRotation?.deactivate();clearFeaturedPreload();stopPagination(); message(''); state.pageLoading = false;
      await cancelRequests(); if (state.disposed || sequence !== activeRequest) return;
      state.selected = item; state.mode = 'detail'; state.sources = null; state.lines = []; state.selectedSource = null; render();
      try { const result = await request('detail', { id: item.id }); if (state.disposed || sequence !== activeRequest) return; state.selected = remember(result?.item || result || item) || item; render(); if(movies&&state.active)findSources(); }
      catch (error) { if (sequence === activeRequest && !state.disposed) message(errorText(error, `${noun}详情暂时无法读取，请稍后重试。`), true); }
    }
    async function findSources() {
      if (!state.selected) return;
      const id = state.selected.id, sequence=activeRequest, keyword=state.selected.title, rules=state.rules.filter(rule=>rule.enabled!==false);
      if(sourceJob?.id===id&&sourceJob.sequence===sequence)return sourceJob.promise;
      const job={id,sequence,promise:null};sourceJob=job;state.busy.add('sources');state.sources={sources:[]};state.lines=[];state.selectedSource=null;renderDetail();let next=0;
      const current=()=>sourceJob===job&&!state.disposed&&state.active&&state.mode==='detail'&&state.selected?.id===id&&sequence===activeRequest;
      job.promise=(async()=>{
        async function worker(){while(next<rules.length&&current()){
          const rule=rules[next++];let result;
          try{result=await request('searchSource',{ruleId:rule.id||rule.name,keyword});}
          catch(error){if(!current())return;result={ruleId:rule.id||rule.name,name:rule.name,items:[],error:errorText(error)};}
          if(!current())return;state.sources.sources.push(result);state.sources.sources.sort((a,b)=>{if(movies){const delta=(Number.isFinite(a.latencyMs)?a.latencyMs:Infinity)-(Number.isFinite(b.latencyMs)?b.latencyMs:Infinity);if(!Number.isNaN(delta)&&delta)return delta;}return rules.findIndex(rule=>(rule.id||rule.name)===a.ruleId)-rules.findIndex(rule=>(rule.id||rule.name)===b.ruleId);});renderDetail();
        }}
        try{await Promise.all(Array.from({length:Math.min(3,rules.length)},worker));}
        finally{if(current()){sourceJob=null;state.busy.delete('sources');renderDetail();}}
      })();return job.promise;
    }
    async function chooseSource(indexValue) {
      const [sourceIndex, itemIndex] = indexValue.split(':').map(Number);
      const groups = (state.sources?.sources || []).filter(source => source.items?.length);
      const source = groups[sourceIndex], item = source?.items?.[itemIndex]; if (!source || !item) return;
      const id = state.selected.id;
      state.selectedSource = { ruleId: source.ruleId, name: source.name, ...item }; state.lines = [];
      await task('episodes', async () => { renderDetail(); const result = await request('episodes', { ruleId: source.ruleId, url: item.url }); if (state.disposed || state.mode !== 'detail' || state.selected?.id !== id || state.selectedSource?.url !== item.url) return; state.lines = Array.isArray(result?.lines) ? result.lines : []; });
      if (state.mode === 'detail') renderDetail();
      if(movies&&state.active&&!state.disposed)probeSourceQuality(source,item).catch(()=>{});
    }
    async function playEpisode(indexValue) {
      const [lineIndex, episodeIndex] = indexValue.split(':').map(Number), line = state.lines[lineIndex], episode = line?.episodes?.[episodeIndex]; if (!episode || !state.selectedSource || !state.selected) return;
      await task('play', async () => { const payload = { id: state.selected.id, subject: state.selected, item: state.selected, ruleId: state.selectedSource.ruleId, subjectUrl: state.selectedSource.url, roadIndex:lineIndex,episodeIndex, line: line.name, episode, url: episode.url, title: episode.title }; const result = await request('play', payload); if (result?.canceled) return; message(result?.message || '已打开播放器'); });
    }
    async function loadRules() { const result = await request('rules'); state.rules = Array.isArray(result) ? result : result?.rules || []; }
    async function mutateRule(action, payload) { await task('rules-write', async () => { await request(action, payload); await loadRules(); if (state.mode === 'settings' && !state.disposed) renderSettings(); }); }
    function closeDialog() { $('.anime-dialog-host').innerHTML = ''; if (dialogPreviousFocus?.isConnected) dialogPreviousFocus.focus(); dialogPreviousFocus = null; }
    function showSourceEditor(id) {
      const source=state.rules.find(entry=>String(entry.id||entry.name)===id);
      dialogPreviousFocus=document.activeElement;
      $('.anime-dialog-host').innerHTML=`<div class="anime-dialog-backdrop" data-no-window-drag><section class="anime-dialog movie-source-dialog" role="dialog" aria-modal="true" aria-label="${source?'编辑':'添加'}片源"><div class="anime-dialog-heading"><h2>${source?'编辑':'添加'}片源</h2><button class="anime-icon-button" data-action="dialog-close" aria-label="关闭">${icon('close')}</button></div><p>填写片源名称和采集接口地址。</p><label class="movie-source-field" for="movies-source-name"><span>名称</span><input id="movies-source-name" data-source-name maxlength="80" value="${esc(source?.name||'')}" autocomplete="off"></label><label class="movie-source-field" for="movies-source-url"><span>采集接口</span><input id="movies-source-url" data-source-url type="url" maxlength="2048" value="${esc(source?.url||source?.baseURL||'')}" placeholder="https://example.com/api.php/provide/vod" autocomplete="off" spellcheck="false"></label><div class="anime-dialog-error" role="alert" hidden></div><div class="anime-dialog-actions">${source?`<button class="anime-danger-button" data-source-delete="${esc(source.id||source.name)}">删除此片源</button>`:''}<button class="anime-button" data-action="dialog-close">取消</button><button class="anime-primary" data-action="source-save" data-source-id="${esc(source?.id||'')}" data-busy="source-save">保存片源</button></div></section></div>`;
      $('[data-source-name]').focus();
    }
    async function saveSource(){
      const name=$('[data-source-name]')?.value.trim(),url=$('[data-source-url]')?.value.trim(),button=$('[data-action="source-save"]');
      let parsed;try{parsed=new URL(url);}catch{}
      if(!name||!parsed||!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password){const error=$('.anime-dialog-error');error.hidden=false;error.textContent='请填写名称和有效的 HTTP 或 HTTPS 采集接口地址。';return;}
      const previous=state.rules.find(source=>String(source.id||source.name)===button.dataset.sourceId);
      await task('source-save',async()=>{await request('sourceSave',{source:{id:button.dataset.sourceId||undefined,name,url:parsed.href,enabled:previous?.enabled!==false}});await loadRules();closeDialog();if(state.mode==='settings')renderSettings();message('片源已保存');});
    }
    function showRuleEditor(id) {
      const rule = state.rules.find(entry => String(entry.id || entry.name) === id);
      dialogPreviousFocus = document.activeElement;
      $('.anime-dialog-host').innerHTML = `<div class="anime-dialog-backdrop" data-no-window-drag><section class="anime-dialog" role="dialog" aria-modal="true" aria-label="${rule ? '编辑' : '添加'}规则"><div class="anime-dialog-heading"><h2>${rule ? '编辑' : '添加'} Kazumi 规则</h2><button class="anime-icon-button" data-action="dialog-close" aria-label="关闭">${icon('close')}</button></div><p>保留原始规则字段；保存前会校验 JSON 和必需字段。</p><label class="anime-sr-only" for="anime-rule-json">规则 JSON</label><textarea id="anime-rule-json" spellcheck="false" rows="16">${esc(JSON.stringify(rule || { name: '', version: '1.0', useNativePlayer: true, useLegacyParser: false, usePost: false, useApi: false, baseURL: '', searchURL: '', searchList: '', searchName: '', searchResult: '', chapterRoads: '', chapterResult: '', chapterName: '', chapterURL: '' }, null, 2))}</textarea><div class="anime-dialog-error" role="alert" hidden></div><div class="anime-dialog-actions">${rule ? `<button class="anime-danger-button" data-rule-delete="${esc(rule.id || rule.name)}">删除此规则</button>` : ''}<button class="anime-button" data-action="dialog-close">取消</button><button class="anime-primary" data-action="rule-save" data-busy="rule-save">保存规则</button></div></section></div>`;
      $('.anime-dialog textarea').focus();
    }
    async function showRepository() {
      await task('repository', async () => { const result = await request('ruleRepository'); if (state.disposed || !state.active || state.mode !== 'settings') return; state.repository = Array.isArray(result) ? result : result?.items || []; dialogPreviousFocus = document.activeElement; $('.anime-dialog-host').innerHTML = `<div class="anime-dialog-backdrop" data-no-window-drag><section class="anime-dialog" role="dialog" aria-modal="true" aria-label="规则仓库"><div class="anime-dialog-heading"><h2>规则仓库</h2><button class="anime-icon-button" data-action="dialog-close" aria-label="关闭">${icon('close')}</button></div><p>Kazumi 官方规则仓库 · 使用当前仓库加速设置</p><div class="anime-repository-list">${state.repository.map(entry => { const name = String(typeof entry === 'string' ? entry : entry.name || entry.id); const installed = state.rules.some(rule => (rule.name || rule.id) === name); return `<div><span><strong>${esc(name)}</strong><small>${esc(typeof entry === 'object' ? entry.version || '' : '')}</small></span><button class="anime-button" data-rule-install="${esc(name)}">${installed ? '重新安装' : '安装'}</button></div>`; }).join('') || empty('仓库中暂无规则')}</div></section></div>`; $('.anime-dialog [data-action="dialog-close"]').focus(); });
    }
    async function saveRule() {
      let value; try { value = JSON.parse($('.anime-dialog textarea').value); } catch { const error = $('.anime-dialog-error'); error.hidden = false; error.textContent = 'JSON 格式无效，请检查逗号、引号与括号。'; return; }
      await task('rule-save', async () => { await request('ruleSave', { rule: value }); await loadRules(); closeDialog(); if (state.mode === 'settings') renderSettings(); message('规则已保存'); });
    }
    async function routeAction(action) {
      if (action === 'settings') { const sequence = ++activeRequest;sourceJob=null;state.busy.delete('sources');movieCarousel?.deactivate(); stopPagination(); state.pageLoading=false; message(''); await cancelRequests(); await loadBootstrap(); if (state.disposed || sequence !== activeRequest) return; state.mode = 'settings'; render(); }
      else if (action === 'back') { const sequence=++activeRequest;sourceJob=null;state.busy.delete('sources');cancelRequests();closeDialog();message('');state.pageLoading=false;state.mode=state.category==='主页'&&!state.query?'home':'catalog';if(state.mode==='home'){try{await refreshHistory();}catch(error){if(sequence===activeRequest)message(errorText(error),true);}}if(!state.disposed&&sequence===activeRequest)render(); }
      else if (action === 'retry') { message(''); state.mode === 'catalog' ? await loadCatalog(state.category, state.query) : await loadHome(); }
      else if (action === 'more') {state.pageError='';await loadCatalog(state.category,state.query,true);}
      else if (action === 'find-sources') await findSources();
      else if (action === 'probe-quality') await probeSourceQualities();
      else if (action === 'cancel-sources') { ++activeRequest;sourceJob=null;await cancelRequests();state.busy.delete('sources');renderDetail();message('搜索已取消'); }
      else if (action === 'history-clear') await task('history', async () => { const result=await request('historyClear');acceptHistory(result);renderHistory(); });
      else if (action === 'source-add') showSourceEditor();
      else if (action === 'source-save') await saveSource();
      else if (action === 'sources-probe') await task('rules-write',async()=>{const result=await request('probeSources');if(Array.isArray(result?.rules))state.rules=result.rules;else await loadRules();if(state.mode==='settings')renderSettings();message('片源测试完成');});
      else if (action === 'rule-add') showRuleEditor();
      else if (action === 'dialog-close') closeDialog();
      else if (action === 'rule-save') await saveRule();
      else if (action === 'repository') await showRepository();
      else if (action === 'rules-update') await task('rules-update', async () => { const result = await request('ruleUpdateAll'); await loadRules(); renderSettings(); message(`已更新 ${result.updated||0} 条规则${result.failed?.length?`，${result.failed.length} 条暂时更新失败，可稍后重试`: '，其余已是最新版本'}`,!!result.failed?.length); });
    }
    on(root, 'click', event => {
      const featuredIndex=event.target.closest('[data-featured-index]');if(featuredIndex){event.preventDefault();featuredRotation?.goTo(Number(featuredIndex.dataset.featuredIndex));return;}
      const featuredDirection=event.target.closest('[data-featured-direction]');if(featuredDirection){event.preventDefault();if(featuredDirection.dataset.featuredDirection==='previous')featuredRotation?.previous();else featuredRotation?.next();return;}
      const category = event.target.closest('[data-category]');
      if (category) { if (suppressTabClick) { suppressTabClick = false; event.preventDefault(); return; } const name = category.dataset.category; state.query = ''; $('.anime-search input').value = ''; name === '主页' ? loadHome() : loadCatalog(name); return; }
      const action = event.target.closest('[data-action]'); if (action) { routeAction(action.dataset.action).catch(error => message(errorText(error), true)); return; }
      const card = event.target.closest('[data-item]'); if (card) { openDetail(card.dataset.item); return; }
      const history = event.target.closest('[data-history]'); if (history) { task('play',async()=>{await request('continue',{id:history.dataset.history});message('已继续上次观看');}); return; }
      const settingsTab = event.target.closest('[data-settings-tab]'); if (settingsTab) { state.settingsTab = settingsTab.dataset.settingsTab; renderSettings(); return; }
      const source = event.target.closest('[data-source]'); if (source) { chooseSource(source.dataset.source); return; }
      const episode = event.target.closest('[data-episode]'); if (episode) { playEpisode(episode.dataset.episode); return; }
      const sourceEdit=event.target.closest('[data-source-edit]');if(sourceEdit){showSourceEditor(sourceEdit.dataset.sourceEdit);return;}
      const sourceDelete=event.target.closest('[data-source-delete]');if(sourceDelete){mutateRule('sourceDelete',{id:sourceDelete.dataset.sourceDelete}).then(closeDialog);return;}
      const edit = event.target.closest('[data-rule-edit]'); if (edit) { showRuleEditor(edit.dataset.ruleEdit); return; }
      const move = event.target.closest('[data-rule-move]'); if (move) { const ids = state.rules.map(rule => String(rule.id || rule.name)), index = ids.indexOf(move.dataset.ruleMove), next = index + Number(move.dataset.direction); if (index >= 0 && next >= 0 && next < ids.length) { [ids[index], ids[next]] = [ids[next], ids[index]]; mutateRule('ruleReorder', { ids }); } return; }
      const remove = event.target.closest('[data-rule-delete]'); if (remove) { mutateRule('ruleDelete', { id: remove.dataset.ruleDelete }).then(closeDialog); return; }
      const install = event.target.closest('[data-rule-install]'); if (install) task('rules-write', async () => { install.disabled = true; try { await request('ruleInstall', { name: install.dataset.ruleInstall }); await loadRules(); install.textContent = '已安装'; if (state.mode === 'settings') renderSettings(); } finally { install.disabled = false; } });
    });
    on($('.anime-search'), 'submit', event => { event.preventDefault(); const query = $('.anime-search input').value.trim(); if (query) loadCatalog('搜索', query); else loadHome(); });
    on(root, 'input', event => { if (event.target.matches('[data-rule-query]')) { state.settingsQuery = event.target.value; const cursor = event.target.selectionStart; renderSettings(); const field = $('[data-rule-query]'); field.focus(); if (field.type !== 'search') field.setSelectionRange(cursor, cursor); } });
    on(root, 'change', event => {
      const sourceToggle=event.target.closest('[data-source-toggle]');if(sourceToggle){mutateRule('sourceToggle',{id:sourceToggle.dataset.sourceToggle,enabled:sourceToggle.checked});return;}
      const adFilter=event.target.closest('[data-movie-ad-filter]');if(adFilter){task('movie-settings',async()=>{const result=await request('settingsSave',{adFilter:adFilter.checked});state.settings={...state.settings,...(result?.settings||result)};message('播放设置已保存');});return;}
      const toggle = event.target.closest('[data-rule-toggle]'); if (toggle) { mutateRule('ruleToggle', { id: toggle.dataset.ruleToggle, enabled: toggle.checked }); return; }
      const network = event.target.closest('[data-network]'); if (network) task('network', async () => { const patch = { ...state.network, [network.dataset.network]: network.value }; try { const result = await request('networkSave', patch); state.network = { ...patch, ...(result?.network || {}) }; message('网络设置已保存'); } finally { if (state.mode === 'settings') renderSettings(); } });
    });
    on(root, 'error', event => { if (event.target.tagName === 'IMG') { event.target.hidden = true; event.target.parentElement.classList.add('anime-image-failed'); } }, true);
    on(root, 'load', event => { if (event.target.tagName === 'IMG') { event.target.hidden = false; event.target.parentElement.classList.remove('anime-image-failed'); } }, true);
    on(root, 'keydown', event => {
      const dot=event.target.closest('[data-featured-index]');if(dot&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const rotation=featuredRotation?.getState();if(!rotation?.items.length)return;const index=event.key==='Home'?0:event.key==='End'?rotation.items.length-1:rotation.index+(event.key==='ArrowRight'?1:-1);featuredRotation.goTo(index);featuredRoot.querySelector(`[data-featured-index="${featuredRotation.getState().index}"]`)?.focus();return;}
      const dialog = $('.anime-dialog'); if (!dialog) return;
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); }
      if (event.key === 'Tab') { const controls = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select')]; const first = controls[0], last = controls[controls.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    });
    const viewport = $('.anime-category-viewport');
    on(viewport, 'pointerdown', event => { if (event.button !== 0 || event.pointerType === 'touch') return; pan = { id: event.pointerId, x: event.clientX, scroll: viewport.scrollLeft, moved: false }; suppressTabClick = false; });
    on(viewport, 'pointermove', event => { if (!pan || event.pointerId !== pan.id || !(event.buttons & 1)) return; const delta = event.clientX - pan.x; if (Math.abs(delta) > 5) { pan.moved = true; if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId); viewport.scrollLeft = pan.scroll - delta; event.preventDefault(); } });
    const endPan = event => { if (pan && (!event || event.pointerId === pan.id)) { suppressTabClick = pan.moved; if (viewport.hasPointerCapture(pan.id)) viewport.releasePointerCapture(pan.id); pan = null; } };
    on(viewport, 'pointerup', endPan); on(viewport, 'pointercancel', endPan); on(viewport, 'lostpointercapture', () => { pan = null; });
    on(viewport, 'wheel', event => { const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY; if (viewport.scrollWidth > viewport.clientWidth) { const before = viewport.scrollLeft; viewport.scrollLeft += delta; if (viewport.scrollLeft !== before) event.preventDefault(); } }, { passive: false });
    if(scrollRoot) on(scrollRoot,'scroll',onCatalogScroll,{passive:true});
    if(typeof subscribeHistory==='function'){
      const unsubscribe=subscribeHistory(value=>{if(!state.disposed){historyEvents++;acceptHistory(value);}});
      if(typeof unsubscribe==='function')listeners.push(unsubscribe);
    }
    on(document,'visibilitychange',()=>{featuredRotation?.visibilityChanged();syncFeaturedPreload();});
    renderCategories();
    return {
      async activate() { if (state.disposed) return;state.active=true;covers?.activate();if(!state.home)await loadHome();else {const sequence=activeRequest;try{await refreshHistory();}catch(error){if(state.active&&sequence===activeRequest)message(errorText(error),true);}if(state.active&&!state.disposed&&sequence===activeRequest)render();} },
      deactivate() { state.active = false; ++activeRequest;sourceJob=null;state.busy.delete('sources');movieCarousel?.deactivate();featuredRotation?.deactivate();clearFeaturedPreload();covers?.deactivate();stopPagination();state.pageLoading=false;cancelRequests(); endPan(); closeDialog(); if (messageTimer) { clearTimeout(messageTimer); messageTimer = null; } root.querySelectorAll('video,audio').forEach(media => media.pause()); },
      async refresh() { if (state.active && !state.disposed) { state.bootstrap = null; await loadHome(); } },
      dispose() { if (state.disposed) return; this.deactivate(); state.disposed = true;featuredRotation?.dispose();featuredRotation=null;featuredRoot=null;movieCarousel?.dispose();covers?.dispose();movieCarousel=null;movieCarouselRoot=null;listeners.splice(0).forEach(remove => remove()); itemStore.clear();qualityResults.clear();qualityPending.clear(); root.replaceChildren(); root.classList.remove('anime-view','movies-view'); },
      getState() { return { active: state.active, mode: state.mode, category: state.category, rules: state.rules.length, history: state.history.length, historyRevision:state.historyRevision, catalog:state.catalog.length,nextOffset:state.nextOffset,hasMore:state.hasMore,pageLoading:state.pageLoading,featured: Math.min(5, state.home?.featured?.length || 0),...(movies?{carousel:movieCarousel?.getState()}:{rotation:featuredRotation?.getState(),featuredPreloads:featuredPreload?1:0}) }; }
    };
  }
  return { create, normalizeItem, normalizeItems, safeImage, DEFAULT_CATEGORIES, MOVIE_CATEGORIES };
});
