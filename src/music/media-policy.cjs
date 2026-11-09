'use strict';

// Provider API results become opaque local streams. The same exact CDN rules
// apply to redirects. Renderer input never grants an arbitrary proxy host.
const IMAGE_HOSTS = new Set(['y.gtimg.cn','qpic.y.qq.com','q1.qlogo.cn','thirdqq.qlogo.cn','imge.kugou.com','imgessl.kugou.com','stdmusicidimg.kugou.com','i.scdn.co','profile-images.scdn.co','image-cdn-ak.spotifycdn.com','pickasso.spotifycdn.com']);
const AUDIO_HOSTS = new Set(['ws.stream.qqmusic.qq.com','isure.stream.qqmusic.qq.com','dl.stream.qqmusic.qq.com','aqqmusic.tc.qq.com']);
const KUGOU_AUDIO_HOST = /^(?:fs\d*|webfs\.(?:hw|ali|tx)|fs\.(?:hw|ali|tx)|fsandroid\.(?:hw|ali|tx))\.kugou\.com$/;
function secureURL(value, limit = 8192) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.href.length <= limit ? url : null;
  } catch { return null; }
}
function imageURL(value) {
  // Some official APIs still return an HTTP CDN address. Upgrade only an
  // allowed image host, then apply the same validation to every redirect.
  let address;
  try { address = new URL(value); } catch { return null; }
  if (address.protocol === 'http:') address.protocol = 'https:';
  const url = secureURL(address.href, 4096);
  return url && (/^(?:p\d+|p\d+c)\.music\.126\.net$/.test(url.hostname) || IMAGE_HOSTS.has(url.hostname) || /^(?:[a-z0-9-]+\.)+(?:douyinpic\.com|byteimg\.com)$/.test(url.hostname)) ? url : null;
}
function audioURL(value) {
  let address;
  try { address = new URL(value); } catch { return null; }
  // Kugou's tracker can return an HTTP link for its TLS-capable official CDN.
  // Upgrade that exact host before validation and never send audio over HTTP.
  if (address.protocol === 'http:' && KUGOU_AUDIO_HOST.test(address.hostname)) address.protocol = 'https:';
  const url = secureURL(address.href);
  if (!url) return null;
  return /^(?:[a-z0-9-]+\.)?(?:music\.126\.net|music\.163\.com)$/.test(url.hostname) ||
    AUDIO_HOSTS.has(url.hostname) || KUGOU_AUDIO_HOST.test(url.hostname) || /^(?:[a-z0-9-]+\.)+(?:douyinvod\.com|bytecdn\.cn|bytecdn\.com)$/.test(url.hostname) ? url : null;
}
module.exports = {imageURL, audioURL};
