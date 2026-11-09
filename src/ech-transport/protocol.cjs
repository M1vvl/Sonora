'use strict';

const HOSTS = new Set(['api.bgm.tv', 'next.bgm.tv', 'lain.bgm.tv', 'gh-proxy.org', 'crypto.cloudflare.com']);
const ADDRESSES = Object.freeze(['172.67.134.140', '104.21.6.61', '172.67.73.67']);
const MAX_RESPONSE = 12 * 1024 * 1024;
const MAX_REQUEST = 1024 * 1024;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function validateUrl(input, requireEch = true) {
  const url = new URL(String(input));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Expected an HTTP(S) URL without credentials');
  if (requireEch && (url.protocol !== 'https:' || (url.port && url.port !== '443') || !HOSTS.has(url.hostname.toLowerCase()))) throw Error('ECH is limited to Kazumi HTTPS hosts on port 443');
  return url;
}

function normalizeHeaders(input) {
  const headers = new Headers(input || {}), lines = [];
  for (const [name, value] of headers) {
    if (!TOKEN.test(name) || /[\r\n\0]/.test(value)) throw Error('Invalid HTTP header');
    if (!['content-length', 'transfer-encoding', 'host'].includes(name.toLowerCase())) lines.push(value ? `${name}: ${value}` : `${name};`);
  }
  if (!headers.has('accept-encoding')) lines.push('accept-encoding: gzip');
  const block = lines.join('\r\n');
  if (Buffer.byteLength(block) > 64 * 1024) throw Error('HTTP headers exceed 64 KiB');
  return block;
}

function normalizeRequest(input, options = {}) {
  const url = validateUrl(input), method = String(options.method || 'GET').toUpperCase();
  if (!TOKEN.test(method)) throw Error('Invalid HTTP method');
  let body;
  if (options.body == null) body = Buffer.alloc(0);
  else if (typeof options.body === 'string') body = Buffer.from(options.body);
  else if (options.body instanceof ArrayBuffer) body = Buffer.from(options.body);
  else if (ArrayBuffer.isView(options.body)) body = Buffer.from(options.body.buffer, options.body.byteOffset, options.body.byteLength);
  else throw Error('ECH request body must be a string or byte buffer');
  if (body.length > MAX_REQUEST) throw Error('ECH upload exceeds 1 MiB');
  if (['GET', 'HEAD'].includes(method) && body.length) throw Error('GET/HEAD requests cannot have a body');
  const timeoutMs = options.timeoutMs == null ? 30000 : Number(options.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw Error('ECH timeout must be 100–60000 ms');
  return { url: url.href, method, headers: normalizeHeaders(options.headers), body, timeoutMs,
    connectTimeoutMs: Math.min(timeoutMs, 10000), maxResponseBytes: MAX_RESPONSE,
    redirect: options.redirect === 'manual' ? 'manual' : options.redirect === 'error' ? 'error' : 'follow' };
}

function parseHeaders(block) {
  const lines = Buffer.from(block).toString('latin1').split(/\r?\n/), status = lines.shift() || '';
  const match = /^HTTP\/\S+\s+(\d{3})(?:\s+(.*))?$/.exec(status);
  if (!match) throw Error('Native HTTP status line is invalid');
  const headers = [];
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return { status: Number(match[1]), statusText: match[2] || '', headers };
}

function readRoute(answer) {
  if (!answer || answer.Status !== 0 || !Array.isArray(answer.Answer)) throw Error('ECH DoH lookup failed');
  for (const record of answer.Answer) {
    if (record.type !== 65 || typeof record.data !== 'string') continue;
    const match = /(?:^|\s)ech="?([A-Za-z0-9+/=]+)/.exec(record.data);
    if (match) return { config: match[1], addresses: [...ADDRESSES], ttl: Math.max(0, Math.min(300, Number(record.TTL) || 0)) };
  }
  throw Error('No ECHConfigList published for crypto.cloudflare.com');
}

function redirectRequest(request, response, next) {
  const old = validateUrl(request.url), url = validateUrl(new URL(next, old));
  const headers = request.headers.split('\r\n').filter(Boolean).filter(line => {
    const name = line.slice(0, line.indexOf(':')).toLowerCase();
    return old.origin === url.origin || !['authorization', 'cookie', 'proxy-authorization', 'host'].includes(name);
  });
  let method = request.method, body = request.body;
  if ((response.status === 303 && method !== 'HEAD') || ([301, 302].includes(response.status) && method === 'POST')) {
    method = 'GET'; body = Buffer.alloc(0);
    for (let i = headers.length - 1; i >= 0; i--) if (/^(content-type|content-length|transfer-encoding):/i.test(headers[i])) headers.splice(i, 1);
  }
  return { ...request, url: url.href, method, body, headers: headers.join('\r\n') };
}

module.exports = { HOSTS, ADDRESSES, MAX_RESPONSE, MAX_REQUEST, validateUrl, normalizeHeaders, normalizeRequest, parseHeaders, readRoute, redirectRequest };
