"use strict";
const https = require("node:https");

// Bounded metadata transport. It never downloads complete songs or accepts a
// renderer URL. Each provider supplies fixed API hosts to this factory.
function createProviderHTTP({ domains, maxActive = 2, maxQueue = 12 } = {}) {
  const pending = [],
    active = new Set();
  let disposed = false;
  function allowed(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        domains.some(
          (domain) =>
            url.hostname === domain || url.hostname.endsWith("." + domain),
        )
        ? url
        : null;
    } catch {
      return null;
    }
  }
  function pump() {
    while (!disposed && active.size < maxActive && pending.length) {
      const task = pending.shift();
      try {
        start(task);
      } catch (error) {
        task.reject(error);
      }
    }
  }
  function start(task) {
    const { url, options, body, resolve, reject } = task;
    let finished = false,
      timer;
    const done = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      active.delete(request);
      error ? reject(error) : resolve(value);
      pump();
    };
    const request = https.request(
      url,
      {
        method: options.method || "GET",
        headers: {
          ...options.headers,
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          if (finished) return;
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            request.destroy(new Error("平台响应超过大小限制"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          response.statusCode >= 200 && response.statusCode < 300
            ? done(null, options.responseType === 'buffer' ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf8"))
            : done(new Error("平台请求失败 HTTP " + response.statusCode)),
        );
        response.on("error", (error) => done(error));
        response.on("aborted", () => done(new Error("平台响应已中断")));
      },
    );
    active.add(request);
    request.once("error", (error) => done(error));
    timer = setTimeout(
      () => request.destroy(new Error("平台请求超时")),
      Math.max(250, Math.min(10000, Number(options.timeoutMs) || 8000)),
    );
    timer.unref?.();
    if (body) request.write(body);
    request.end();
  }
  return {
    requestText(value, options = {}, body) {
      const url = allowed(value);
      if (disposed) return Promise.reject(new Error("平台请求已关闭"));
      if (!url || (body && Buffer.byteLength(body) > 65536))
        return Promise.reject(new Error("无效的平台请求"));
      if (pending.length >= maxQueue)
        return Promise.reject(new Error("平台请求过多，请稍后再试"));
      return new Promise((resolve, reject) => {
        pending.push({ url, options, body, resolve, reject });
        pump();
      });
    },
    cancel() {
      for (const task of pending.splice(0))
        task.reject(new Error("平台请求已取消"));
      for (const request of [...active])
        request.destroy(new Error("平台请求已取消"));
    },
    dispose() {
      disposed = true;
      this.cancel();
    },
    getStatus: () => ({
      active: active.size,
      queued: pending.length,
      disposed,
    }),
  };
}
module.exports = { createProviderHTTP };
