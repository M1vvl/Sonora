'use strict';

// ech_http 0.2.3's six exported C functions and the versioned Dart_CObject
// layout are documented by ech_http.h and Dart's public native API header.
// Windows x64: union starts at8, array length8/pointer16, typed length16/data24.
function decodeEvent(koffi, message, copy) {
  const read = (pointer, offset, type) => koffi.decode(pointer, offset, type);
  if (!message || read(message, 0, 'int32_t') !== 6 || Number(read(message, 8, 'intptr_t')) !== 5) throw Error('Invalid native ECH message');
  const list = read(message, 16, 'void *');
  if (!list) throw Error('Missing native ECH fields');
  const fields = Array.from({ length: 5 }, (_, index) => read(list, index * 8, 'void *'));
  const numbers = fields.slice(0, 4).map(pointer => {
    if (!pointer || read(pointer, 0, 'int32_t') !== 2) throw Error('Invalid native ECH integer');
    return read(pointer, 8, 'int32_t');
  });
  const typed = fields[4];
  if (!typed || read(typed, 0, 'int32_t') !== 7 || read(typed, 8, 'int32_t') !== 2) throw Error('Invalid native ECH byte payload');
  const length = Number(read(typed, 16, 'intptr_t')), pointer = read(typed, 24, 'void *');
  if (!Number.isSafeInteger(length) || length < 0 || length > 256 * 1024 || (length && !pointer)) throw Error('Native ECH event exceeds delivery bound');
  const payload = Buffer.alloc(length);
  // Copy before returning to the native thread; its message and data pointers
  // are temporary. No external ArrayBuffer is created inside Electron's cage.
  if (length) copy(payload, pointer, length);
  return { type: numbers[0], code: numbers[1], echAccepted: numbers[2] !== 0, echRetries: numbers[3], payload };
}

function createNativeBackend(dllPath) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Kazumi ECH backend requires Windows x64');
  const koffi = require('koffi'), dll = koffi.load(dllPath), kernel = koffi.load('kernel32.dll');
  const optionsType = koffi.struct('AgentPulseEhOptions', {
    url: 'str', method: 'str', headers: 'str', proxy: 'str', ech_config: 'str', connect_ip: 'str', ca_pem: 'str',
    body: 'void *', body_length: 'size_t', timeout_ms: 'int64_t', connect_timeout_ms: 'int64_t', max_response_bytes: 'int64_t', auto_uncompress: 'bool'
  });
  if (koffi.sizeof(optionsType) !== 104 || koffi.offsetof(optionsType, 'auto_uncompress') !== 96) throw Error('Native ECH ABI layout mismatch');
  const callbackType = koffi.proto('bool AgentPulseEhPost(int64_t port, void *message)');
  const api = {
    version: dll.func('const char *eh_version()'), create: dll.func('void *eh_client_create()'),
    destroy: dll.func('void eh_client_destroy(void *client)'),
    start: dll.func('eh_request_start', 'void *', ['void *', koffi.pointer(optionsType), koffi.pointer(callbackType), 'int64_t']),
    acknowledge: dll.func('void eh_request_acknowledge(void *request, size_t bytes)'),
    cancel: dll.func('void eh_request_destroy(void *request)'),
    copy: kernel.func('void __stdcall RtlMoveMemory(_Out_ void *destination, void *source, size_t length)')
  };
  const client = api.create();
  if (!client) throw Error('Unable to initialize Kazumi ECH backend');
  const requests = new Map(); let nextPort = 0, closed = false;
  const asyncCall = (fn, ...args) => new Promise((resolve, reject) => fn.async(...args, (error, value) => error ? reject(error) : resolve(value)));
  const callback = koffi.register((port, message) => {
    const request = requests.get(Number(port));
    if (!request || request.finished) return false;
    try {
      const event = decodeEvent(koffi, message, api.copy);
      setImmediate(() => request.consume(event));
      return true;
    } catch (error) { setImmediate(() => request.finish(error)); return false; }
  }, koffi.pointer(callbackType));

  function fetchNative(options, signal) {
    if (closed) return Promise.reject(Error('ECH backend is closed'));
    return new Promise((resolve, reject) => {
      const port = ++nextPort, chunks = []; let bytes = 0, response = null, pointer = null, acknowledgements = Promise.resolve();
      const request = { finished: false, finishing: null, finish(error) {
        if (request.finishing) return request.finishing;
        request.finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        request.finishing = (async () => {
          try { await acknowledgements; } catch (failure) { error ||= failure; }
          try { if (pointer) await asyncCall(api.cancel, pointer); } catch (failure) { error ||= failure; }
          requests.delete(port);
          if (error) reject(error);
          else if (!response) reject(Error('ECH response ended without headers'));
          else resolve({ ...response, body: Buffer.concat(chunks, bytes) });
        })();
        return request.finishing;
      }, consume(event) {
        if (request.finished) return;
        try {
          if (event.type === 1) {
            const { parseHeaders } = require('./protocol.cjs');
            response = { ...parseHeaders(event.payload), echAccepted: event.echAccepted, echRetries: event.echRetries };
            if (options.config && !response.echAccepted) { request.finish(Error('Server did not accept ECH; plaintext fallback is disabled')); return; }
          } else if (event.type === 2) {
            bytes += event.payload.length;
            if (bytes > options.maxResponseBytes) { request.finish(Error('ECH response exceeds size limit')); return; }
            chunks.push(event.payload);
            // The callback holds native state.mutex. Acknowledge only after it
            // returns, and asynchronously so another callback cannot deadlock.
            acknowledgements = acknowledgements.then(() => asyncCall(api.acknowledge, pointer, event.payload.length));
            acknowledgements.catch(error => request.finish(error));
          } else if (event.type === 3) request.finish(null);
          else if (event.type === 4) request.finish(Error(`ECH ${event.code}: ${event.payload.toString('utf8').slice(0, 1000)}`));
          else request.finish(Error('Unknown native ECH event'));
        } catch (error) { request.finish(error); }
      } };
      const abort = () => request.finish(Object.assign(Error('ECH request aborted'), { name: 'AbortError' }));
      const timer = setTimeout(() => request.finish(Error('ECH native request timed out')), options.timeoutMs + 1500);
      requests.set(port, request);
      try {
        const body = options.body || Buffer.alloc(0);
        pointer = api.start(client, { url: options.url, method: options.method || 'GET', headers: options.headers || '', proxy: '',
          ech_config: options.config || '', connect_ip: options.address || '', ca_pem: '', body: body.length ? body : null, body_length: body.length,
          timeout_ms: options.timeoutMs, connect_timeout_ms: options.connectTimeoutMs, max_response_bytes: options.maxResponseBytes, auto_uncompress: true }, callback, port);
        if (!pointer) throw Error('Unable to start native ECH request');
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      } catch (error) { request.finish(error); }
    });
  }
  return { fetchNative, version: api.version(), async dispose() {
    if (closed) return; closed = true;
    await Promise.all([...requests.values()].map(request => request.finish(Error('ECH backend disposed'))));
    await asyncCall(api.destroy, client);
    koffi.unregister(callback);
    // Do not unload the DLL: cancelled detached workers retain their state
    // until network I/O finishes, even though they can no longer post events.
  } };
}

module.exports = { decodeEvent, createNativeBackend };
