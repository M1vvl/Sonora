'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { normalizeRequest } = require('./protocol.cjs');

function createEchTransport({ dllPath, fetchImpl = globalThis.fetch, workerFactory = (file, options) => new Worker(file, options), maxConcurrent = 4, idleMs = 60000 } = {}) {
  let worker = null, ready = false, disposed = false, sequence = 0, idle = null, version = null, closePromise = null, resolveClose = null;
  const pending = new Map(), waiting = []; let active = 0, verifiedRequests=0;
  function clearIdle() { if (idle) clearTimeout(idle); idle = null; }
  function scheduleIdle() {
    clearIdle();
    if (!pending.size && worker && !disposed) {
      idle = setTimeout(() => closeWorker(), idleMs); idle.unref?.();
    }
  }
  function finish(id, error, result) {
    const item = pending.get(id); if (!item) return;
    pending.delete(id); clearTimeout(item.timer); item.signal?.removeEventListener('abort', item.abort);
    if (item.started) active--; else { const index = waiting.indexOf(id); if (index !== -1) waiting.splice(index, 1); }
    error ? item.reject(error) : item.resolve(result);
    dispatch(); scheduleIdle();
  }
  function failAll(error) { for (const id of [...pending.keys()]) finish(id, error); }
  function dispatch() {
    if (!ready || disposed || closePromise) return;
    while (active < maxConcurrent && waiting.length) {
      const id = waiting.shift(), item = pending.get(id); if (!item) continue;
      item.started = true; active++;
      worker.postMessage({ type: 'fetch', id, request: item.request });
    }
  }
  function start() {
    if (worker) return;
    if (!dllPath || !path.isAbsolute(dllPath)) throw Error('An absolute Kazumi ECH DLL path is required');
    clearIdle(); ready = false;
    const current = workerFactory(path.join(__dirname, 'worker.cjs'), { workerData: { dllPath } }); worker = current;
    current.on('message', message => {
      if (current !== worker) return;
      if (message.type === 'ready') { ready = true; version = String(message.version).slice(0, 200); dispatch(); }
      else if (message.type === 'result') finish(message.id, null, message.result);
      else if (message.type === 'error') finish(message.id, Object.assign(Error(message.error?.message || 'ECH request failed'), { name: message.error?.name || 'Error' }));
      else if (message.type === 'disposed') { ready = false; }
    });
    current.on('error', error => { if (current === worker) { ready = false; failAll(error); } });
    current.on('exit', code => {
      if (current !== worker) return;
      worker = null; ready = false;
      failAll(Error(`ECH worker stopped (${code})`));
      resolveClose?.(); resolveClose = null; closePromise = null;
    });
  }
  function closeWorker() {
    clearIdle();
    if (!worker) return Promise.resolve();
    if (closePromise) return closePromise;
    ready = false;
    closePromise = new Promise(resolve => { resolveClose = resolve; });
    // Cancellation/deregistration must finish before the worker exits. Force
    // terminating it with live native callbacks could crash the host process.
    worker.postMessage({ type: 'dispose' });
    return closePromise;
  }
  async function fetch(input, options = {}) {
    if (disposed) throw Error('ECH transport is disposed');
    if (!options.ech) {
      if (typeof fetchImpl !== 'function') throw Error('Plain HTTP transport unavailable');
      const { ech, ...plain } = options; return fetchImpl(input, plain);
    }
    if (options.signal?.aborted) throw Object.assign(Error('ECH request aborted'), { name: 'AbortError' });
    const request = normalizeRequest(input, options);
    if (pending.size >= 64) throw Error('ECH request queue is full');
    if (closePromise) await closePromise;
    if (disposed) throw Error('ECH transport is disposed');
    start(); clearIdle();
    const result = await new Promise((resolve, reject) => {
      const id = ++sequence, item = { resolve, reject, signal: options.signal, started: false, request };
      item.abort = () => {
        if (item.started) worker?.postMessage({ type: 'cancel', id });
        finish(id, Object.assign(Error('ECH request aborted'), { name: 'AbortError' }));
      };
      item.timer = setTimeout(() => {
        if (item.started) worker?.postMessage({ type: 'cancel', id });
        finish(id, Error('ECH request deadline exceeded'));
      }, request.timeoutMs + 3000);
      pending.set(id, item); waiting.push(id); item.signal?.addEventListener('abort', item.abort, { once: true });
      if (item.signal?.aborted) item.abort(); else dispatch();
    });
    if (!result.echAccepted) throw Error('ECH acceptance was not verified');
    verifiedRequests++;
    const response = new Response(options.method === 'HEAD' || [204, 205, 304].includes(result.status) ? null : result.body,
      { status: result.status, statusText: result.statusText, headers: result.headers });
    Object.defineProperties(response, { url: { value: result.url }, redirected: { value: result.redirected }, echAccepted: { value: true }, echRetries: { value: result.echRetries } });
    return response;
  }
  return { fetch, status: () => ({ active: pending.size, running: Boolean(worker), ready, version, verifiedRequests }),
    async dispose() { if (disposed) return closePromise; disposed = true; failAll(Error('ECH transport disposed')); return closeWorker(); } };
}

module.exports = { createEchTransport };
