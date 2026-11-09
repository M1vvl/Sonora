'use strict';

// Public-client PKCE. Tokens stay in the main process and are encrypted by the
// OS. The temporary callback listener binds only to the IPv4 loopback address.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const CLIENT_ID = '2e7fab56dd614db38eb4cb3dc263e90b';
const REDIRECT_URI = 'http://127.0.0.1:43821/spotify/callback';
const SCOPES = ['playlist-read-private','playlist-read-collaborative','playlist-modify-private','playlist-modify-public','user-library-read','user-library-modify','user-top-read','user-read-recently-played','user-read-playback-state','user-read-currently-playing','user-modify-playback-state'];

function createSpotifyOAuth({dataDir, safeStorage, fetchImpl, openExternal, onChange = () => {}, now = Date.now, clientId = CLIENT_ID, redirectURI = REDIRECT_URI} = {}) {
  const file = dataDir && path.join(dataDir, 'music-spotify-oauth.json');
  let credentials = null, loaded = false, loadJob = null, refreshJob = null, authorizeJob = null, pending = null, generation = 0, disposed = false, writes = Promise.resolve();
  const active = new Set(), waiting = [];
  function check(ticket = generation) {if (disposed || ticket !== generation) throw new Error('Spotify 授权操作已取消');}
  function pump() {while (!disposed && active.size < 2 && waiting.length) {const job = waiting.shift(); run(job).then(job.resolve,job.reject);}}
  async function run(job) {
    const controller = new AbortController(); active.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000); timer.unref?.();
    try {
      check(job.ticket);
      const response = await fetchImpl(job.url, {...job.init,signal:controller.signal,redirect:'error',cache:'no-store',credentials:'omit'});
      const reader = response.body?.getReader(), chunks = []; let size = 0;
      if (Number(response.headers?.get('content-length') || 0) > 1024*1024) {await response.body?.cancel(); throw new Error('Spotify 响应超过大小限制');}
      if (reader) try {while (true) {const {done,value} = await reader.read(); if(done)break; size += value.byteLength; if(size>1024*1024){await reader.cancel();throw new Error('Spotify 响应超过大小限制');} chunks.push(Buffer.from(value));}} finally {reader.releaseLock();}
      const raw = Buffer.concat(chunks).toString('utf8'); let value = {};
      try {value = raw ? JSON.parse(raw) : {};} catch {throw new Error('Spotify 返回了无效数据');}
      check(job.ticket);
      if (!response.ok) {
        const error = new Error(response.status===401?'Spotify 授权已失效，请重新连接':response.status===403?'Spotify 拒绝访问：请检查授权用户名单、Premium 资格和应用权限':response.status===429?'Spotify 请求额度暂时用尽，请稍后重试':response.status===404?'Spotify 未找到可用内容或播放设备':'Spotify 请求失败（HTTP '+response.status+'）');
        error.status = response.status;error.reason=value?.error?.reason||null;error.retryAfter=Math.max(0,Math.min(3600,Number(response.headers?.get('retry-after'))||0));throw error;
      }
      return value;
    } finally {clearTimeout(timer);active.delete(controller);pump();}
  }
  function transport(url, init = {}) {
    const parsed = new URL(url);
    if (parsed.protocol!=='https:' || !['accounts.spotify.com','api.spotify.com'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port) return Promise.reject(new Error('无效的 Spotify 请求'));
    if (waiting.length>=12) return Promise.reject(new Error('Spotify 请求繁忙，请稍后重试'));
    return new Promise((resolve,reject)=>{waiting.push({url:parsed.href,init,resolve,reject,ticket:generation});pump();});
  }
  async function load() {
    if(loaded)return; if(loadJob)return loadJob;
    const ticket=generation;
    loadJob=(async()=>{let handle;try {
      if(file&&safeStorage?.isEncryptionAvailable()){
        handle=await fs.open(file,'r');const bytes=Buffer.alloc(32769),{bytesRead}=await handle.read(bytes,0,bytes.length,0);
        if(bytesRead>32768)throw new Error('Oversize OAuth store');
        const envelope=JSON.parse(bytes.subarray(0,bytesRead).toString());
        if(envelope.version!==1||!String(envelope.encrypted||'').match(/^[A-Za-z0-9+/]+=*$/))throw new Error('Invalid store');
        const value=JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64')));
        if(value.clientId===clientId&&typeof value.refresh_token==='string'&&value.refresh_token.length<8192){check(ticket);credentials={refresh_token:value.refresh_token,access_token:'',expiresAt:0};}
      }
    }catch{/* A damaged store is never treated as a valid login. */}finally{await handle?.close();if(ticket===generation)loaded=true;}})().finally(()=>{loadJob=null;});return loadJob;
  }
  function persist(value,ticket) {
    const job=writes.then(async()=>{
      check(ticket);if(!file||!safeStorage?.isEncryptionAvailable())throw new Error('系统加密存储不可用，无法安全保存 Spotify 授权');
      const encrypted=safeStorage.encryptString(JSON.stringify({clientId,refresh_token:value.refresh_token})).toString('base64');
      await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
      try{await fs.writeFile(temp,JSON.stringify({version:1,encrypted}),{flag:'wx',mode:0o600});check(ticket);await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}
    });writes=job.catch(()=>{});return job;
  }
  async function acceptToken(value,ticket) {
    check(ticket);if(typeof value.access_token!=='string'||!value.access_token||value.access_token.length>8192)throw new Error('Spotify 未返回有效授权');
    const refresh_token=value.refresh_token||credentials?.refresh_token;
    if(typeof refresh_token!=='string'||!refresh_token||refresh_token.length>8192)throw new Error('Spotify 未返回续期授权');
    const next={access_token:value.access_token,refresh_token,expiresAt:now()+Math.max(30,Math.min(7200,Number(value.expires_in)||3600))*1000};
    await persist(next,ticket);check(ticket);credentials=next;
  }
  async function token() {
    check();await load();check();
    if(credentials?.access_token&&credentials.expiresAt>now()+30000)return credentials.access_token;
    if(!credentials?.refresh_token)throw new Error('请在账号面板授权连接 Spotify');
    if(!refreshJob){const ticket=generation;const job=(async()=>{try{const value=await transport('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:credentials.refresh_token,client_id:clientId}).toString()});await acceptToken(value,ticket);return credentials.access_token;}catch(error){if(ticket===generation&&[400,401].includes(error.status)){credentials=null;onChange();}throw error;}})().finally(()=>{if(refreshJob===job)refreshJob=null;});refreshJob=job;}
    return refreshJob;
  }
  async function api(endpoint,{method='GET',body}={}) {
    if(typeof endpoint!=='string'||!endpoint.startsWith('/')||endpoint.startsWith('//'))throw new Error('无效的 Spotify API');
    const ticket=generation,access=await token();check(ticket);
    const send=access=>transport('https://api.spotify.com/v1'+endpoint,{method,headers:{Authorization:'Bearer '+access,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    try{return await send(access);}catch(error){check(ticket);if(error.status!==401||!credentials?.refresh_token)throw error;credentials.access_token='';credentials.expiresAt=0;return send(await token());}
  }
  function stopPending(force=false) {if(!pending)return;clearTimeout(pending.timer);pending.server.close();if(force)pending.server.closeAllConnections?.();pending=null;}
  async function beginAuthorize() {
    check();if(pending)return {provider:'spotify',authorizing:true,redirectURI};
    cancel();const ticket=generation,state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
    const callback=new URL(redirectURI);
    if(callback.hostname!=='127.0.0.1'||callback.protocol!=='http:')throw new Error('无效的 Spotify 本地回调');
    const server=http.createServer(async(req,res)=>{
      const headers={'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Connection':'close'};
      let url;try{url=new URL(req.url,callback.origin);}catch{res.writeHead(400,headers);res.end('Invalid request');return;}
      if(req.method!=='GET'||req.headers.host!==callback.host||url.pathname!==callback.pathname||url.searchParams.get('state')!==state||!pending||pending.ticket!==ticket){res.writeHead(400,headers);res.end('Invalid authorization callback');return;}
      const code=url.searchParams.get('code');
      if(url.searchParams.has('error')||!code||code.length>8192){res.writeHead(400,headers);res.end('Spotify authorization was cancelled.');stopPending();onChange('Spotify 授权未完成，请重试');return;}
      // Consume this state before the network exchange so callbacks cannot be replayed.
      stopPending();
      try{
        const value=await transport('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectURI,client_id:clientId,code_verifier:verifier}).toString()});
        await acceptToken(value,ticket);cancel();loaded=true;res.writeHead(200,headers);res.end('Sonara: Spotify authorization completed. You can return to Sonara.');onChange();
      }catch(error){if(!res.destroyed){res.writeHead(400,headers);res.end('Sonara: authorization could not complete. Please return to Sonara and retry.');}if(!disposed)onChange(error.message);}
    });
    server.maxConnections=4;server.headersTimeout=5000;server.requestTimeout=10000;server.unref();
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(callback.port),'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});}).catch(()=>{server.close();throw new Error('Spotify 回调端口被占用，请稍后重试');});
    try{check(ticket);}catch(error){server.close();throw error;}const timer=setTimeout(()=>{stopPending(true);if(!disposed)onChange('Spotify 授权已超时，请重试');},180000);timer.unref?.();pending={server,timer,ticket};
    const url=new URL('https://accounts.spotify.com/authorize');url.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirectURI,state,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),scope:SCOPES.join(' ')}).toString();
    try{await openExternal(url.href);}catch{stopPending();throw new Error('无法打开 Spotify 官方授权页面');}
    return {provider:'spotify',authorizing:true,redirectURI};
  }
  function authorize(){if(!authorizeJob)authorizeJob=beginAuthorize().finally(()=>{authorizeJob=null;});return authorizeJob;}
  async function hasSession(){await load();return !!credentials?.refresh_token;}
  function cancel(){generation++;stopPending(true);for(const job of waiting.splice(0))job.reject(new Error('Spotify 操作已取消'));for(const controller of active)controller.abort();refreshJob=null;}
  async function logout(){cancel();const ticket=generation;credentials=null;loaded=true;await writes;if(ticket!==generation)return;if(file)await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw new Error('无法清除 Spotify 本地授权');});}
  return {api,authorize,hasSession,logout,cancel,async dispose(){disposed=true;cancel();await writes;credentials=null;},getStatus:()=>({authorizing:!!pending,redirectURI,clientId,active:active.size,queued:waiting.length})};
}
module.exports={createSpotifyOAuth,CLIENT_ID,REDIRECT_URI,SCOPES};
