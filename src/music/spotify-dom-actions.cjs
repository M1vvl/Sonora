'use strict';

function operate(action, payload, readSnapshot) {
  if (location.origin !== 'https://open.spotify.com') throw new Error('请完成 Spotify 官方登录');
  const visible = node => !!node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
  const text = node => (node?.innerText || node?.textContent || '').trim().slice(0, 180);
  const rows = [...document.querySelectorAll('[data-testid="tracklist-row"]')];
  const song = readSnapshot().songs.find(item => item.id === payload.id);
  let offset = 0;
  const row = song && (song.browserRow ? rows.find(node => (Number(node.closest('[aria-rowindex]')?.getAttribute('aria-rowindex')) || ++offset) === song.browserRow) : [...document.querySelectorAll('main a[href*="/track/"]')].find(node=>new URL(node.href).pathname==='/track/'+payload.id.slice(8))?.closest('[data-encore-id="listRow"]'));
  const menus = [...document.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"],[role="option"],[role="dialog"] button,[data-radix-popper-content-wrapper] button')].filter(visible);
  if (action === 'menus') {
    return menus.map(node => ({text:text(node),label:node.getAttribute('aria-label') || '',checked:node.getAttribute('aria-checked'),role:node.getAttribute('role'),depth:node.closest('[data-depth]')?.getAttribute('data-depth')}));
  }
  if (action === 'dismiss') {
    const target = document.querySelector('main h1') || document.querySelector('[data-testid="topbar"]') || document.body;
    target.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,pointerType:'mouse'}));
    target.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
    target.click();
    return {submitted:true};
  }
  if (action === 'notices') {
    return [...document.querySelectorAll('[role="alert"],[data-testid*="toast"],[role="status"]')].filter(visible).map(text).filter(Boolean);
  }
  if (action === 'navigation') {
    return {path:location.pathname,mainText:(document.querySelector('main')?.innerText||'').slice(0,1200),libraryMarkup:document.querySelector('[id^="listrow-title-spotify:playlist:"]')?.closest('[role="row"]')?.outerHTML.slice(0,14000),emptyPlaylist:!!document.querySelector('[data-testid="playlist-inline-curation-results"]'),searchCards:[...document.querySelectorAll('main [data-testid="title"]')].slice(0,2).map(node=>node.parentElement.parentElement.outerHTML.slice(0,12000)),inputs:[...document.querySelectorAll('input')].map(node=>({placeholder:node.placeholder,testid:node.dataset.testid,role:node.getAttribute('role')}))};
  }
  if (action === 'likeState') {
    if (!row) throw new Error('歌曲行已更新，请重新打开歌单');
    if (menus.some(node => /添加至.?已点赞的歌曲|Add to (?:your )?Liked Songs/i.test(text(node)))) return {liked:false};
    if (menus.some(node => /从.?已点赞的歌曲.?中?(?:移除|删除)|Remove from (?:your )?Liked Songs/i.test(text(node)))) return {liked:true};
    const button = [...row.querySelectorAll('button[aria-checked]')].find(node => /点赞|Liked|Save|保存|移除|Remove|Add/i.test(node.getAttribute('aria-label') || ''));
    if (!button) {
      if (menus.some(node => /添加至.?已点赞的歌曲|Add to (?:your )?Liked Songs/i.test(text(node)))) return {liked:false};
      if (menus.some(node => /从.?已点赞的歌曲.?中?(?:移除|删除)|Remove from (?:your )?Liked Songs/i.test(text(node)))) return {liked:true};
      throw new Error('网页尚未提供这首歌的收藏状态');
    }
    const checked = button.getAttribute('aria-checked');
    if (!['true','false'].includes(checked)) throw new Error('网页尚未确认收藏状态');
    return {liked:checked === 'true'};
  }
  let node;
  if (action === 'like') {
    node = menus.find(item => /添加至.?已点赞的歌曲|从.?已点赞的歌曲.?中?(?:移除|删除)|(?:Add to|Remove from) (?:your )?Liked Songs/i.test(text(item)));
    if (!node) node = [...(row?.querySelectorAll('button[aria-checked="false"]') || [])].find(item => /点赞|Liked/i.test(item.getAttribute('aria-label') || ''));
  } else if (action === 'more') {
    node = row?.querySelector('[data-testid="more-button"]');
    if (node?.getAttribute('aria-expanded') === 'true') return {submitted:true};
  } else if (action === 'menu') {
    node = menus.find(item => text(item) === payload.text || item.getAttribute('aria-label') === payload.text);
  } else if (action === 'addMenu') {
    node = menus.find(item => /^(?:加入歌单|添加到播放列表|添加至歌单|添加到歌单|添加至播放列表|Add to playlist)$/i.test(text(item)));
  } else if (action === 'seek' || action === 'volume') {
    const selector = action === 'seek' ? '[data-testid="playback-progressbar"]' : '[data-testid="volume-bar"]';
    node = document.querySelector(selector + ' input[type="range"]');
    if (!node) {
      const bar = document.querySelector(selector + ' [data-testid="progress-bar"]') || document.querySelector(selector);
      if (!visible(bar)) throw new Error('网页未提供可调整的进度或音量');
      const rect = bar.getBoundingClientRect();
      const fraction = action === 'volume' ? payload.value : payload.value / Math.max(1, readSnapshot().duration);
      return {pointer:{x:rect.x + Math.max(0,Math.min(1,fraction)) * rect.width,y:rect.y + rect.height/2}};
    }
    const minimum = Number(node.min) || 0;
    const maximum = Number(node.max) || 1;
    const fraction = action === 'volume' ? payload.value : payload.value / Math.max(1, readSnapshot().duration);
    const value = minimum + Math.min(1, Math.max(0, fraction)) * (maximum - minimum);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(node, String(value));
    node.dispatchEvent(new Event('input', {bubbles:true}));
    node.dispatchEvent(new Event('change', {bubbles:true}));
    return {submitted:true};
  }
  if (!node) throw new Error('Spotify 官方网页未显示对应操作');
  if (action === 'addMenu') {
    const rect = node.getBoundingClientRect();
    return {hover:{x:rect.x+rect.width/2,y:rect.y+rect.height/2}};
  }
  node.click();
  return {submitted:true};
}

function operationScript(action, payload = {}) {
  if (!['menus','dismiss','navigation','notices','likeState','like','more','menu','addMenu','seek','volume'].includes(action)) throw new Error('无效网页操作');
  const {snapshotFunction} = require('./spotify-dom.cjs');
  const publicPayload = {id:String(payload.id || '').slice(0, 96),text:String(payload.text || '').slice(0, 180),value:Number(payload.value) || 0};
  return '(' + operate.toString() + ')(' + JSON.stringify(action) + ',' + JSON.stringify(publicPayload) + ',' + snapshotFunction.toString() + ')';
}
module.exports = {operationScript};
