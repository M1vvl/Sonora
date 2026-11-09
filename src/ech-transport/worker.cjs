'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { createNativeBackend } = require('./native.cjs');
const { readRoute, redirectRequest } = require('./protocol.cjs');
const backend = createNativeBackend(workerData.dllPath), jobs = new Map();
let cachedRoute = null, routePending = null, closing = false;

async function route() {
  if (cachedRoute && cachedRoute.expires > Date.now()) return cachedRoute;
  if (routePending) return routePending;
  routePending = (async () => {
    const response = await backend.fetchNative({ url: 'https://dns.alidns.com/resolve?name=crypto.cloudflare.com&type=65',
      headers: 'accept: application/dns-json\r\naccept-encoding: gzip', timeoutMs: 15000, connectTimeoutMs: 8000, maxResponseBytes: 1024 * 1024 });
    if (response.status !== 200) throw Error(`ECH DoH HTTP ${response.status}`);
    const result = readRoute(JSON.parse(response.body.toString('utf8')));
    cachedRoute = { ...result, expires: Date.now() + result.ttl * 1000 };
    return cachedRoute;
  })();
  try { return await routePending; } finally { routePending = null; }
}

async function send(request, signal) {
  for (let redirect = 0; ; redirect++) {
    signal.throwIfAborted();
    const current = await route(); signal.throwIfAborted();
    let response = null, failure;
    for (let index = 0; index < current.addresses.length; index++) {
      try {
        response = await backend.fetchNative({ ...request, config: current.config, address: current.addresses[index] }, signal);
        break;
      } catch (error) {
        failure = error;
        if (signal.aborted || !['GET', 'HEAD'].includes(request.method)) throw error;
      }
    }
    if (!response) throw failure || Error('No ECH destination available');
    const location = response.headers.find(([key]) => key === 'location')?.[1];
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return { ...response, url: request.url, redirected: redirect > 0 };
    if (request.redirect === 'manual') return { ...response, url: request.url, redirected: redirect > 0 };
    if (request.redirect === 'error') throw Error('ECH redirect refused by request policy');
    if (redirect >= 8) throw Error('Too many ECH redirects');
    request = redirectRequest(request, response, location);
  }
}

parentPort.on('message', message => {
  if (message.type === 'cancel') { jobs.get(message.id)?.abort(); return; }
  if (message.type === 'dispose') {
    if (closing) return;
    closing = true; for (const job of jobs.values()) job.abort();
    backend.dispose().finally(() => { parentPort.postMessage({ type: 'disposed' }); parentPort.close(); });
    return;
  }
  if (message.type !== 'fetch' || closing) return;
  const controller = new AbortController(); jobs.set(message.id, controller);
  send(message.request, controller.signal).then(result => {
    if (!closing) parentPort.postMessage({ type: 'result', id: message.id, result });
  }, error => {
    if (!closing) parentPort.postMessage({ type: 'error', id: message.id, error: { name: error.name, message: String(error.message).slice(0, 2000) } });
  }).finally(() => jobs.delete(message.id));
});
parentPort.postMessage({ type: 'ready', version: backend.version });
