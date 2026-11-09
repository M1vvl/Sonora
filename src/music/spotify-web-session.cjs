'use strict';

// Read only the account's public display fields inside Sonara's Spotify
// partition. Web authentication stays separate from the application OAuth API.
const PROFILE_URL = 'https://www.spotify.com/api/account-settings/v1/profile';
const MAX_BODY = 65536;
const displayText = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 100) : '';
const FALLBACK_NAME = 'Spotify 账号';

function displayName(value) {
  const name = displayText(value);
  if (!name || /^[a-z0-9]{20,64}$/i.test(name) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(name)) return '';
  if (/^Spotify\s*(?:[-–|]|Web Player)/i.test(name)) return '';
  if (/^(?:Spotify(?: 账号)?|Profile|Your profile|User profile|Account|Open user menu|用户资料|个人资料|打开用户菜单|账号)$/i.test(name)) return '';
  return name;
}

function avatarURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048) return '';
    if (!['spotify.com', 'scdn.co', 'spotifycdn.com'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return '';
    return url.href;
  } catch {return '';}
}

function profileFromResponse(value) {
  const profile = value?.profile || value?.data?.profile || value?.data || value;
  const userId = displayText(profile?.username || profile?.id || profile?.account_id);
  if (!userId) return null;
  return {
    provider: 'spotify', userId,
    nickname: [profile.displayName, profile.display_name, profile.name].map(displayName).find(Boolean) || FALLBACK_NAME,
    avatarURL: avatarURL(profile.imageUrl || profile.image_url || profile.avatarUrl || profile.avatar_url || profile.avatar || profile.images?.[0]?.url),
    verification: 'web', vip: false
  };
}

// Public profile metadata is a fallback for the account-settings response,
// which can legitimately contain only an opaque username. It never proves
// authentication by itself and is requested only for an already verified ID.
function publicProfileFromHTML(html, account) {
  const fields = new Map();
  const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named = {'&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>'};
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
  for (const tag of String(html).slice(0, MAX_BODY).match(/<meta\b[^>]{0,4096}>/gi) || []) {
    const attrs = new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3])]));
    const key = attrs.get('property') || attrs.get('name');
    if (key === 'og:title' || key === 'og:image') fields.set(key, attrs.get('content') || '');
  }
  const name = displayName((fields.get('og:title') || '').replace(/\s+(?:on|\|)\s+Spotify\s*$/i, ''));
  const avatar = avatarURL(fields.get('og:image'));
  return {...account, nickname: name || account.nickname, avatarURL: avatar || account.avatarURL};
}

async function responseText(response, {partial = false} = {}) {
  if (!response?.ok) {await response?.body?.cancel?.().catch(() => {});return '';}
  if (!partial && Number(response.headers.get('content-length') || 0) > MAX_BODY) {await response.body?.cancel?.().catch(() => {});return '';}
  const reader = response.body?.getReader();if (!reader) return '';
  const chunks = [];let total = 0;
  while (true) {
    const {done, value} = await reader.read();if (done) break;
    const left = MAX_BODY - total;
    chunks.push(Buffer.from(value.subarray(0, left)));total += value.byteLength;
    if (total >= MAX_BODY) {await reader.cancel();if (!partial) return '';break;}
  }
  return Buffer.concat(chunks).toString('utf8');
}

function spotifyProfileScript() {
  return `(()=>{
    const widget=document.querySelector('[data-testid="user-widget-link"],[data-testid="user-widget-avatar"]');
    if(!widget)return null;
    const box=widget.getBoundingClientRect();if(!box.width||!box.height)return null;
    const image=widget.matches('img')?widget:widget.querySelector('img');
    const link=widget.closest('a[href^="/user/"]')||widget.querySelector('a[href^="/user/"]')||document.querySelector('[role="menu"] a[href^="/user/"]');
    const id=link?.getAttribute('href')?.split('/')[2]?.split(/[?#]/)[0]||'';
    const generic=/^(?:Spotify(?: 账号)?|Profile|Your profile|User profile|Account|Open user menu|用户资料|个人资料|打开用户菜单|账号)$/i;
    const names=[widget.getAttribute('title'),widget.getAttribute('aria-label'),image?.getAttribute('alt'),widget.querySelector('[data-testid="user-widget-name"]')?.textContent];
    const name=names.map(value=>String(value||'').trim()).find(value=>value&&!generic.test(value)&&! /^[a-z0-9]{20,64}$/i.test(value))||'';
    const artwork=image?.currentSrc||image?.getAttribute('src')||image?.getAttribute('srcset')?.trim().split(/[ ,]/)[0]||'';
    const painted=widget.querySelector('[style*="background-image"]')||widget;
    const background=painted.style?.backgroundImage||'';
    const cover=artwork||/^url\\(["']?(.+?)["']?\\)$/.exec(background)?.[1]||'';
    if(!id&&!cover)return null;
    return {userId:id,nickname:name,avatarURL:cover};
  })()`;
}

function mergeProfile(account, visible) {
  if (!visible) return account;
  if (!account || visible.userId && visible.userId !== account.userId) return visible;
  return {...account,
    nickname: displayName(visible.nickname) || account.nickname,
    avatarURL: visible.avatarURL || account.avatarURL};
}

async function visibleProfile(views) {
  for (const web of views.slice(-3).reverse()) {
    try {
      if (web.isDestroyed()) continue;
      const url = new URL(web.getURL());
      if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.username || url.password || url.port) continue;
      let timer;
      const value = await Promise.race([
        Promise.resolve().then(() => web.executeJavaScript(spotifyProfileScript())),
        new Promise(resolve => {timer = setTimeout(() => resolve(null), 1200);})
      ]).finally(() => clearTimeout(timer));
      if (!value || typeof value !== 'object') continue;
      const avatar = avatarURL(value.avatarURL), userId = displayText(value.userId);
      if (!userId && !avatar) continue;
      return {provider: 'spotify', userId, nickname: displayName(value.nickname) || FALLBACK_NAME,
        avatarURL: avatar, verification: 'web', vip: false};
    } catch {}
  }
  return null;
}

async function verifySpotifyWebSession({network, views = []} = {}) {
  const visible = await visibleProfile(views);
  if (visible?.userId && visible.nickname !== FALLBACK_NAME && visible.avatarURL) return visible;
  if (typeof network?.fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);timer.unref?.();
    try {
      const response = await network.fetch(PROFILE_URL, {credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal});
      const profile = profileFromResponse(JSON.parse(await responseText(response) || 'null'));
      if (profile) {
        let combined = mergeProfile(profile, visible);
        if (combined.nickname === FALLBACK_NAME || !combined.avatarURL) {
          try {
            const page = await network.fetch(`https://open.spotify.com/user/${encodeURIComponent(combined.userId)}`, {credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal});
            combined = publicProfileFromHTML(await responseText(page, {partial: true}), combined);
          } catch {}
        }
        return combined;
      }
    } catch {} finally {clearTimeout(timer);}
  }
  return visible;
}

module.exports = {verifySpotifyWebSession, profileFromResponse, spotifyProfileScript};
