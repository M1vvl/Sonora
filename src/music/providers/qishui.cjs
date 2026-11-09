/* GPL-3.0-only source adaptation; provenance in provider-sdk/qishui/SOURCE.json. */
'use strict';
const crypto = require('node:crypto');
const {createProviderHTTP} = require('./http.cjs');
const {parseLyrics} = require('../lyrics.cjs');
const {createQishuiCore} = require('./qishui-core.cjs');
const {createQishuiStore} = require('./qishui-store.cjs');
const {createQishuiPassport,hasSession} = require('./qishui-passport.cjs');
const text = (value,max = 160) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
const unprefix = value => text(value,100).replace(/^qishui:/,'');
function song(value) {
  const id = unprefix(value?.providerSongId || value?.providerId || value?.id);
  if (!/^[A-Za-z0-9_-]{1,90}$/.test(id) || !text(value?.name || value?.title)) return null;
  return {id:'qishui:'+id,providerId:id,provider:'qishui',source:'qishui',title:text(value.name || value.title),artist:text(value.artist) || '未知歌手',album:text(value.album),duration:Math.max(0,Math.min(86400,Number(value.duration) || 0)),coverURL:text(value.cover || value.coverURL,2048)};
}
function playlist(value) {
  const id = unprefix(value?.id);
  return /^[A-Za-z0-9_-]{1,90}$/.test(id) ? {id:'qishui:'+id,provider:'qishui',source:'qishui',title:text(value.name || value.title) || '汽水歌单',coverURL:text(value.cover || value.coverURL,2048),trackCount:Math.max(0,Number(value.trackCount) || 0),owned:value.owned === true,subscribed:value.subscribed === true} : null;
}
function createQishuiAdapter({electron,network,getHostWindow,onStatus = () => {},dataDir,requestText:injectedTransport,factories = {}} = {}) {
  const transport = injectedTransport ? null : createProviderHTTP({domains:['qishui.com','volcengine.com','douyin.com'],maxActive:2,maxQueue:12});
  const store = (factories.createStore || createQishuiStore)({dataDir,safeStorage:electron?.safeStorage});
  const core = createQishuiCore({requestText:injectedTransport || transport.requestText});
  const favorites = require('./qishui-favorites.cjs').createQishuiFavorites({core});
  let passport = null,disposed = false,generation = 0,qrGeneration = 0,verifiedProfile = null,qr = null,poll = null,closing = Promise.resolve();
  async function auth(ticket = qrGeneration) {
    await closing;
    if(disposed||ticket!==qrGeneration)throw new Error('汽水登录操作已取消');
    if (!passport) passport = (factories.createPassport || createQishuiPassport)({electron,network,getHostWindow,getConfig:store.read,updateConfig:patch => store.save(patch),onStatus});
    return passport;
  }
  async function cookie() {
    const values = await network?.cookies.get({}) || [];
    const owned = values.filter(item => /(^|\.)qishui\.com$/.test(String(item.domain || '').replace(/^\./,''))).map(item => item.name+'='+item.value).join('; ');
    return hasSession(owned) ? owned : store.read().cookie || '';
  }
  async function profile() {
    const ticket=generation;
    core.clearQishuiStatusCache();
    const value = await core.handleQishuiStatus(await cookie());
    if(disposed||ticket!==generation)throw new Error('汽水账号验证已取消');
    if (value.loggedIn !== true || value.sessionValidated !== true || !value.userId) {
      if (value.reauthRequired) expired();
      throw Object.assign(new Error(value.reauthRequired ? '汽水登录状态已过期，请重新扫码' : '汽水暂时未能验证账号，请稍后刷新'),
        value.reauthRequired ? {code:'SESSION_EXPIRED'} : {});
    }
    verifiedProfile = {provider:'qishui',userId:text(value.userId,90),nickname:text(value.nickname) || '汽水用户',avatarURL:text(value.avatar,2048),vip:value.membershipKnown === true && value.isVip === true,vipLabel:value.membershipKnown === true && value.isVip === true ? text(value.vipLabel,20) || 'VIP' : '',membershipKnown:value.membershipKnown === true,verification:'verified'};
    return {provider:'qishui',loggedIn:true,apiConnected:true,profile:{...verifiedProfile}};
  }
  function expired() {
    verifiedProfile = null;
    onStatus({provider:'qishui',profile:null,apiConnected:false,sessionSaved:true,reauthRequired:true});
  }
  async function qrCreate(value = {}) {
    if (disposed) throw new Error('汽水账号模块已关闭');
    const ticket = ++qrGeneration;
    qr = null; poll = null;
    const engine=await auth(ticket),created = await engine.createQr(value);
    if (disposed || ticket !== qrGeneration) throw new Error('汽水二维码已更新');
    qr = {...created,requestId:crypto.randomBytes(20).toString('hex'),confirmed:false};
    return {provider:'qishui',requestId:qr.requestId,qrImage:qr.qrImage,expiresAt:qr.expiresAt,status:'waiting',message:'请使用抖音 App 扫码并确认登录'};
  }
  async function qrCheck({requestId} = {}) {
    if (disposed || !qr || requestId !== qr.requestId || Date.now() > qr.expiresAt) return {provider:'qishui',status:'expired'};
    if (poll) return poll;
    const ticket = qrGeneration, current = qr;
    const job = (async () => {
      const engine=await auth(ticket),state = current.confirmed ? {status:'confirmed'} : await engine.checkQr(current.token,current.generation);
      if (disposed || ticket !== qrGeneration || qr !== current) return {provider:'qishui',status:'expired'};
      if (state.status !== 'confirmed') return {provider:'qishui',...state};
      if (!current.confirmed) {
        // A newly confirmed account replaces the previous API identity. Merely
        // closing its QR surface must not cancel music prepared under it.
        current.confirmed = true;generation++;transport?.cancel();core.clearQishuiRuntimeCaches();
      }
      const result = await profile();
      if (disposed || ticket !== qrGeneration || qr !== current) return {provider:'qishui',status:'expired'};
      onStatus({...result,status:'confirmed'});
      return {...result,status:'confirmed'};
    })();
    poll = job;
    try {return await job;} finally {if (poll === job) poll = null;}
  }
  async function request(payload = {}) {
    if (disposed) throw new Error('汽水账号模块已关闭');
    const ticket = generation, id = unprefix(payload.id), credential = await cookie();
    let result;
    if (payload.action === 'profile') result = await profile();
    else if (payload.action === 'like') result = await favorites.like(payload,credential,{isCurrent:() => !disposed && ticket === generation});
    else if (payload.action === 'home') {
      const [feedResult, libraryResult] = await Promise.allSettled([
        core.fetchQishuiFeedSongs(30, credential),
        core.handleQishuiUserPlaylists(credential)
      ]);
      const feed = feedResult.status === 'fulfilled' ? feedResult.value : {};
      const library = libraryResult.status === 'fulfilled' ? libraryResult.value : {};
      const songs = (feed.songs || []).map(song).filter(Boolean).slice(0, 30);
      const playlists = (library.playlists || []).map(playlist).filter(Boolean).slice(0, 100);
      if (!songs.length && !playlists.length && feedResult.status === 'rejected') throw feedResult.reason;
      result = {provider:'qishui',songs,cards:songs,playlists,discoveryModes:songs.length && !feed.fallback ? ['daily'] : [],discoveryLabels:{daily:'为你推荐'},recommendationMode:feed.fallback ? 'library' : 'personal',recommendationLabel:feed.fallback ? '汽水音乐 · 我的歌单' : '汽水音乐 · 为你推荐'};
    } else if (payload.action === 'discovery') {
      if (payload.mode !== 'daily') throw new Error('汽水暂未提供此音乐发现方式');
      const feed = await core.fetchQishuiFeedSongs(30, credential);
      result = {provider:'qishui',songs:(feed.songs || []).map(song).filter(Boolean).slice(0,30),label:feed.fallback ? '账号歌曲' : '为你推荐'};
    }
    else if (payload.action === 'playbackOptions') {
      if (!id) return {provider:'qishui',apiConnected:!!verifiedProfile,requiresLogin:true,qualityOptions:[]};
      if (!/^[A-Za-z0-9_-]{1,90}$/.test(id)) throw new Error('无效的汽水音乐条目');
      const value = await core.handleQishuiSongUrl({id}, credential);
      if (value.reauthRequired) {
        expired();
        throw Object.assign(new Error('汽水登录状态已过期，请重新扫码'), {code:'SESSION_EXPIRED'});
      }
      if (!value.playable) throw new Error(value.message || '汽水未返回此歌曲可用的音质');
      result = {provider:'qishui',apiConnected:true,requiresLogin:true,qualityOptions:(value.qualityOptions || []).slice(0,16)};
    }
    else if (payload.action === 'playlists') {
      const value = await core.handleQishuiUserPlaylists(credential);
      if (!value.loggedIn) throw new Error('请先扫码登录汽水音乐');
      result = {provider:'qishui',apiConnected:value.libraryReady === true,playlists:(value.playlists || []).slice(0,100).map(playlist).filter(Boolean),hasMore:false};
    } else if (payload.action === 'search') {
      const query = text(payload.keywords || payload.query || payload.q,120);
      if (!query) return {provider:'qishui',songs:[],hasMore:false};
      const offset = Math.max(0,Math.min(10000,Number(payload.offset) || 0)), limit = Math.max(1,Math.min(50,Number(payload.limit) || 30));
      const value = await core.handleQishuiPcSearch(query,limit,credential,offset);
      result = {...value,songs:(value.songs || []).map(song).filter(Boolean)};
    } else {
      if (!/^[A-Za-z0-9_-]{1,90}$/.test(id)) throw new Error('无效的汽水音乐条目');
      if (payload.action === 'playlist') {
        const offset = Math.max(0,Math.min(10000,Number(payload.offset) || 0)), limit = Math.max(1,Math.min(50,Number(payload.limit) || 50));
        const value = await core.handleQishuiPlaylistTracks(id,{offset,limit},credential);
        if (value.error && !value.tracks?.length) throw new Error('汽水歌单暂时不可用');
        result = {provider:'qishui',songs:(value.tracks || []).slice(0,limit).map(song).filter(Boolean),total:Number(value.total) || 0,offset,nextOffset:value.nextOffset ?? offset+(value.tracks?.length || 0),hasMore:value.hasMore === true};
      } else if (payload.action === 'lyrics') {
        const value = await core.handleQishuiLyric(id,credential);
        result = parseLyrics({lrc:{lyric:value.lyric || ''},tlyric:{lyric:value.tlyric || ''},yrc:{lyric:value.yrc || ''},ytlrc:{lyric:value.ytlrc || ''}});
      } else if (payload.action === 'play') {
        const value = await core.handleQishuiSongUrl({id,quality:text(payload.quality,40)},credential);
        if (!value.playable || !value.url) {
          if (value.reauthRequired) expired();
          throw Object.assign(new Error(value.reauthRequired ? '汽水登录状态已过期，请重新扫码' : value.message || '当前汽水账号未返回可播放的授权音源'),
            value.reauthRequired ? {code:'SESSION_EXPIRED'} : {});
        }
        // The authorization stays in the main process and is consumed by the
        // bounded sample decoder. It must never enter the renderer response.
        const address = new URL(value.url), authorization = new URLSearchParams(address.hash.slice(1)).get('auth') || '';
        address.hash = '';
        result = {provider:'qishui',source:'qishui',song:{...payload.song,id:'qishui:'+id,provider:'qishui',source:'qishui',providerId:id},url:address.href,encrypted:value.encrypted === true,authorization,quality:text(value.quality,40) || 'unknown',qualityLabel:text(value.qualityLabel || value.quality) || '平台授权音质',requestedQuality:text(payload.quality,40),qualityOptions:(value.qualityOptions || []).slice(0,16),trial:value.trial === true,duration:Math.max(0,Number(value.duration)||0)};
      } else throw new Error('不支持的汽水音乐操作');
    }
    if (disposed || ticket !== generation) throw new Error('汽水音乐操作已取消');
    return result;
  }
  function closeQr() {
    qrGeneration++;qr = null;poll = null;
    const previous=passport;passport=null;
    if(previous){previous.cancel();closing=closing.catch(()=>{}).then(()=>previous.dispose());}
    return closing;
  }
  function cancel() {
    generation++;
    const closingQr=closeQr();
    transport?.cancel();core.clearQishuiRuntimeCaches();
    return closingQr;
  }
  return {request,qrCreate,qrCheck,hasSession:async()=>hasSession(await cookie()),setBounds:value => passport?.setBounds(value),closeQr,cancel,getProfile:() => verifiedProfile,
    async logout() {await cancel();verifiedProfile = null;store.clear();await network?.clearStorageData?.({storages:['cookies','localstorage','indexdb','cachestorage','serviceworkers']});await network?.flushStorageData?.();},
    async dispose() {if (disposed) return closing;const pending=cancel();disposed = true;await pending;transport?.dispose();verifiedProfile = null;}
  };
}
module.exports = {createQishuiAdapter,song,playlist};
