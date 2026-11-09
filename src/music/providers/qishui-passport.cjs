/* GPL-3.0-only. Passport flow adapted from MineRadio qishui-auth-v6.js.
 * The official SDK runs only in an owned sandboxed WebContentsView. It has no
 * preload, Node access, music bridge or access to another program's session. */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const QRCode = require('qrcode');
const API = 'https://api.qishui.com';
const BDMS = 'https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36';
const ASSETS = new Map([['security_host.html','text/html'],['security_seed.html','text/html'],['bdms.js','text/javascript'],['sdk-glue.js','text/javascript'],['react.js','text/javascript'],['react-dom.js','text/javascript']]);
const ASSET_ROOT = path.resolve(__dirname, '../../../assets/music/provider-sdk/qishui');
const VERIFY_HOSTS = ['qishui.com','zijieapi.com','bytedance.com','bytedance.net','snssdk.com','bytecdn.cn','byteimg.com','douyin.com'];
const hasSession = value => /(?:^|;\s*)(?:sessionid|sessionid_ss|sid_guard|sid_tt)=[^;\s]+/i.test(String(value || ''));

function createQishuiPassport({electron, network, getHostWindow = () => null, getConfig, updateConfig, onStatus = () => {}}) {
  let view = null, owner = null, server = null, base = '', initializing = null, disposed = false;
  let browserInfo = null, msToken = '', signedURL = '', generation = 0, bounds = null;
  const responseHeaders = new Map();
  function identity() {
    const config = getConfig(), patch = {};
    if (!/^\d{16}$/.test(config.deviceId || '')) patch.deviceId = String(crypto.randomInt(1e7, 9e7)) + String(crypto.randomInt(1e7, 9e7));
    if (!/^\d{15}$/.test(config.installId || '')) patch.installId = String(crypto.randomInt(1e6, 9e6)) + String(crypto.randomInt(1e7, 9e7));
    if (!config.verifyPortraitId) patch.verifyPortraitId = crypto.randomUUID() + '.login';
    if (!config.computerName) patch.computerName = os.hostname() || 'Windows-PC';
    if (Object.keys(patch).length) updateConfig(patch);
    return getConfig();
  }
  async function startAssets() {
    if (server) return;
    const assetToken = crypto.randomBytes(24).toString('hex');
    server = http.createServer((request, response) => {
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        const prefix = '/' + assetToken + '/';
        const name = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
        if (!['GET','HEAD'].includes(request.method) || !ASSETS.has(name)) {response.writeHead(404).end(); return;}
        response.writeHead(200, {'Content-Type': ASSETS.get(name) + '; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'});
        if (request.method === 'HEAD') response.end();
        else fs.createReadStream(path.join(ASSET_ROOT, name)).on('error', () => response.destroy()).pipe(response);
      } catch {response.writeHead(404).end();}
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    server.unref();
    base = `http://127.0.0.1:${server.address().port}/${assetToken}/`;
  }
  function hooks() {
    network.webRequest.onBeforeRequest({urls:[BDMS]}, (_details, callback) => callback({redirectURL: base + 'bdms.js'}));
    network.webRequest.onBeforeSendHeaders({urls:[API + '/*','https://verify.zijieapi.com/*','https://auth.zijieapi.com/*']}, (details, callback) => {
      if (details.webContentsId === view?.webContents.id) {
        const headers = details.requestHeaders || {};
        const preflight = Object.entries(headers).find(([name]) => name.toLowerCase() === 'access-control-request-headers')?.[1];
        const origin = Object.entries(headers).find(([name]) => name.toLowerCase() === 'origin')?.[1];
        responseHeaders.set(details.id, {origin:String(origin || ''),names:String(preflight || Object.keys(headers).join(', '))});
        while (responseHeaders.size > 64) responseHeaders.delete(responseHeaders.keys().next().value);
        if (details.url.startsWith(API + '/passport/') && details.method !== 'OPTIONS') signedURL = details.url;
      }
      callback({requestHeaders:details.requestHeaders});
    });
    network.webRequest.onHeadersReceived({urls:[API + '/*','https://verify.zijieapi.com/*','https://auth.zijieapi.com/*']}, (details, callback) => {
      const headers = {...details.responseHeaders};
      const tracked=responseHeaders.get(details.id);
      if (details.webContentsId === view?.webContents.id && tracked?.origin === new URL(base).origin) {
        for (const name of Object.keys(headers)) if (name.toLowerCase().startsWith('access-control-')) delete headers[name];
        headers['Access-Control-Allow-Origin'] = [new URL(base).origin];
        headers['Access-Control-Allow-Credentials'] = ['true'];
        headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
        headers['Access-Control-Allow-Headers'] = [tracked.names || 'content-type'];
        headers['Access-Control-Expose-Headers'] = ['x-tt-logid'];
      }
      responseHeaders.delete(details.id);
      callback({responseHeaders:headers});
    });
  }
  function run(source) {
    if (disposed || !view || view.webContents.isDestroyed()) return Promise.reject(new Error('汽水登录已关闭'));
    return view.webContents.executeJavaScript(source, true);
  }
  async function initialize() {
    if (disposed) throw new Error('汽水登录已关闭');
    if (browserInfo && view && !view.webContents.isDestroyed()) return;
    if (initializing) return initializing;
    initializing = (async () => {
      await electron.app.whenReady();
      identity();
      await startAssets();
      if (disposed) throw new Error('汽水登录已关闭');
      view = new electron.WebContentsView({webPreferences:{session:network, contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true, backgroundThrottling:false, preload:undefined}});
      hooks();
      view.webContents.setUserAgent(UA);
      view.webContents.setWindowOpenHandler(() => ({action:'deny'}));
      view.webContents.on('will-navigate', (event, url) => {if (!url.startsWith(base)) event.preventDefault();});
      view.webContents.on('will-attach-webview', event => event.preventDefault());
      view.webContents.on('before-input-event', (event, input) => {if (input.type === 'keyDown' && input.key === 'Escape') {event.preventDefault(); cancel();}});
      await view.webContents.loadURL(base + 'security_seed.html');
      msToken = /^[A-Za-z0-9_-]{118}==$/.test(getConfig().msToken || '') ? getConfig().msToken : crypto.randomBytes(88).toString('base64url') + '==';
      await run(`localStorage.setItem('xmst',${JSON.stringify(msToken)});localStorage.setItem('xmsty',${JSON.stringify(msToken)});true`);
      await view.webContents.loadURL(base + 'security_host.html');
      const until = Date.now() + 20000;
      while (Date.now() < until && !disposed) {
        if (await run('Boolean(window.bdms && window._sdkGlueVersionMap && window._sdkGlueVersionMap.bdmsVersion)')) {
          browserInfo = await run('window.__qishuiBrowserInfo()');
          updateConfig({msToken});
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('汽水官方安全组件加载超时，请稍后重试');
    })().catch(async error => {await releaseRuntime(); throw error;}).finally(() => {initializing = null;});
    return initializing;
  }
  async function request(method, pathname, extra = {}, values) {
    await initialize();
    const config = identity(), url = new URL(pathname, API), trace = crypto.randomBytes(4).toString('hex');
    const params = {passport_jssdk_version:'2.4.13',passport_jssdk_type:'normal',is_from_ttaccountsdk:'1',aid:'386088',language:'zh',account_sdk_source:'web',p_js_v:'2.4.13',p_js_t:'pro',p_zt:'3.3.5',p_ver:'1.0.29',request_host:'app%3A%2F%2Fresources',p_bd:'1.0.0.41',biz_trace_id:trace,is_new_login:'1',is_from_iesaccountsaas:'1',device_id:config.deviceId,install_id:config.installId,did:config.deviceId,iid:config.installId,device_platform:'PC',version_code:'3.5.2',account_sdk_source_info:browserInfo.encrypted,msToken,...extra};
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const headers = {'Accept':'application/json, text/javascript','x-tt-passport-verify-portrait':config.verifyPortraitId,'x-tt-passport-trace-id':trace,'x-tt-trace-id':`00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`};
    const body = values ? new URLSearchParams(Object.entries(values).map(([key,value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])).toString() : null;
    if (body !== null) {headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['x-ss-stub'] = crypto.createHash('md5').update(body).digest('hex').toUpperCase();}
    const result = await run(`window.__qishuiRequest(${JSON.stringify({method,url:url.href,headers,body,timeout:20000})})`);
    if (!result || result.status < 200 || result.status >= 400 || String(result.body || '').length > 262144) throw new Error('汽水登录接口暂不可用');
    const signed = new URL(signedURL || API), envelope = JSON.parse(result.body || '{}');
    if ((signed.searchParams.get('a_bogus') || '').length !== 44 || signed.searchParams.get('msToken') !== msToken) throw new Error('汽水官方安全签名未就绪');
    return envelope;
  }
  function detach() {
    if (owner && !owner.isDestroyed() && view) owner.contentView.removeChildView(view);
    owner = null;
  }
  function setBounds(value) {
    const rect = value?.bounds || value;
    if (!rect || !['x','y','width','height'].every(key => Number.isFinite(rect[key]))) return;
    bounds = {...rect};
    if (owner && view) {
      const [width,height] = owner.getContentSize();
      const x = Math.max(0,Math.min(width,Math.round(rect.x))), y = Math.max(0,Math.min(height,Math.round(rect.y)));
      view.setBounds({x,y,width:Math.max(1,Math.min(width-x,Math.round(rect.width))),height:Math.max(1,Math.min(height-y,Math.round(rect.height)))});
    }
  }
  async function secondVerify(decision) {
    const config = identity(), host = getHostWindow();
    if (!host || host.isDestroyed() || !bounds) throw new Error('请保持汽水账号面板打开以完成官方安全验证');
    if (decision.url) {
      const url = new URL(decision.url, API);
      if (url.protocol !== 'https:' || !VERIFY_HOSTS.some(name => url.hostname === name || url.hostname.endsWith('.' + name))) throw new Error('汽水未返回受信任的官方验证组件');
    }
    owner = host;
    host.contentView.addChildView(view);
    setBounds(bounds);
    view.webContents.focus();
    onStatus({provider:'qishui',status:'verifying',mfa:true});
    try {
      const result = await run(`window.__qishuiSecondVerify(${JSON.stringify({...decision,verify_portrait_id:decision.verify_portrait_id || config.verifyPortraitId})},${JSON.stringify({generalParams:{device_id:config.deviceId,install_id:config.installId,did:config.deviceId,iid:config.installId,device_platform:'PC',version_code:'3.5.2'}})})`);
      if (!result?.status) throw new Error('汽水安全验证未完成，请重新扫码');
    } finally {detach();}
  }
  async function createQr(value = {}) {
    const ticket = ++generation;
    setBounds(value);
    const envelope = await request('GET','/passport/web/get_qrcode/',{next:API,need_logo:'false',need_short_url:'false'}), data = envelope.data || {};
    if (envelope.message !== 'success' || Number(data.error_code) !== 0 || !data.token || !data.qrcode_index_url) throw new Error('汽水暂时无法生成登录二维码');
    const token = new URL(data.qrcode_index_url).searchParams.get('token');
    if (!token) throw new Error('汽水二维码信息不完整');
    const url = new URL('https://bff-pc.qishui.com/light/invoke/scan_login');
    url.searchParams.set('token', token); url.searchParams.set('os','Windows'); url.searchParams.set('computer_name',identity().computerName);
    if (disposed || ticket !== generation) throw new Error('汽水二维码已更新');
    return {token:String(data.token),qrImage:await QRCode.toDataURL(url.href.replace(/\+/g,'%20'),{errorCorrectionLevel:'M',margin:2,width:320}),expiresAt:Date.now()+180000,generation:ticket};
  }
  async function checkQr(token, ticket) {
    const body = {need_logo:'false',need_short_url:'false',is_frontier:'true',token,is_new_login:'1',next:API};
    let envelope = await request('POST','/passport/web/check_qrconnect/',{},body), data = envelope.data || {};
    if (Number(data.error_code) === 2046) {
      const decision = {...envelope,...data}; delete decision.data;
      await secondVerify(decision);
      let biz = decision.biz_params || {};
      if (typeof biz === 'string') {try {biz = JSON.parse(biz);} catch {biz = Object.fromEntries(new URLSearchParams(biz));}}
      envelope = await request('POST','/passport/web/check_qrconnect/',{isResend:'true'},{...body,...biz});
      data = envelope.data || {};
    }
    if (disposed || ticket !== generation) return {status:'expired'};
    if (Number(data.error_code) === 0 && (String(data.status) === '3' || data.status === 'confirmed' || data.session_cookie)) {
      const cookies = await network.cookies.get({});
      const values = Object.fromEntries(cookies.filter(item => /(^|\.)qishui\.com$/.test(String(item.domain || '').replace(/^\./,''))).map(item => [item.name,item.value]));
      for (const part of String(data.session_cookie || '').split(';')) {const at = part.indexOf('='); if (at > 0) values[part.slice(0,at).trim()] = part.slice(at+1).trim();}
      const cookie = Object.entries(values).map(([key,value]) => key+'='+value).join('; ');
      if (!hasSession(cookie)) throw new Error('汽水尚未返回可验证的登录会话');
      updateConfig({cookie,msToken});
      await network.flushStorageData?.();
      return {status:'confirmed'};
    }
    return {status:Number(data.error_code) === 2 ? 'expired' : Number(data.error_code) === 7 ? 'rate_limited' : String(data.status) === '2' ? 'scanned' : 'waiting',retryAfterMs:Number(data.error_code) === 7 ? 60000 : 1800};
  }
  function cancel() {generation++; run('window.__qishuiCancelSecondVerify?.();true').catch(() => {}); detach();}
  async function releaseRuntime() {
    detach();
    if (view && !view.webContents.isDestroyed()) view.webContents.close({waitForBeforeUnload:false});
    view = null; browserInfo = null; signedURL = ''; responseHeaders.clear();
    network.webRequest.onBeforeRequest(null); network.webRequest.onBeforeSendHeaders(null); network.webRequest.onHeadersReceived(null);
    if (server) {server.closeAllConnections?.(); const old = server; server = null; await new Promise(resolve => {try {old.close(resolve);} catch {resolve();}});}
  }
  async function dispose() {
    if (disposed) return;
    cancel();disposed=true;
    // Closing a loading SDK view rejects its pending navigation. Let that
    // initialization settle before removing session hooks or the asset server.
    if(view&&!view.webContents.isDestroyed())view.webContents.close({waitForBeforeUnload:false});
    if(initializing)await initializing.catch(()=>{});
    await releaseRuntime();
  }
  return {createQr,checkQr,setBounds,cancel,dispose};
}
module.exports = {createQishuiPassport,hasSession};
