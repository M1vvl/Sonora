// Built-in Emily resources and app-scoped memory controls.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createMemory} = require('./memory.cjs');
const MIME = {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json'};
function createVisualBackend({electron, dataDir, getHostWindow, factories = {}} = {}) {
  let disposed = false;
  const root = path.resolve(__dirname, '../../assets/music/source-presets');
  const memory = (factories.createMemory || createMemory)({app: electron.app, dataDir, getHostWindow});
  async function handle(request) {
    if (disposed) return new Response(null, {status: 410});
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, {status: 405});
    try {
      const target = new URL(request.url);
      if (target.protocol !== 'pulse-visual-media:' || target.hostname !== 'builtin') return new Response(null, {status: 403});
      const relative = decodeURIComponent(target.pathname.slice(1));
      if (!relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').includes('..')) return new Response(null, {status: 403});
      const resource = await fs.promises.realpath(path.resolve(root, relative));
      if (!resource.startsWith(root + path.sep)) return new Response(null, {status: 403});
      const mime = MIME[path.extname(resource)];
      const stat = await fs.promises.stat(resource);
      if (!mime || !stat.isFile() || stat.size > 4 * 1024 * 1024) return new Response(null, {status: 404});
      const headers = {
        'Content-Type': mime,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src pulse-visual-media:; style-src 'unsafe-inline'; img-src pulse-music-image: data: blob:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'",
        'Permissions-Policy': 'camera=(),microphone=(),display-capture=()'
      };
      return new Response(request.method === 'HEAD' ? null : await fs.promises.readFile(resource), {headers});
    } catch {return new Response(null, {status: 404});}
  }
  return {
    request(action, payload = {}) {
      if (disposed) throw new Error('视觉资源已关闭');
      if (action === 'memoryStatus') return memory.status();
      if (action === 'memoryPreferences') return memory.save(payload.preferences || {});
      if (action === 'memoryTrim') return memory.trim();
      throw new Error('无效的视觉资源操作');
    },
    handle,
    getStatus: () => ({loaded: true, memory: memory.getState()}),
    async dispose() {if (disposed) return; disposed = true; memory.dispose();}
  };
}
module.exports = {createVisualBackend};
