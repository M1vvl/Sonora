'use strict';
// Read-only check of this application's own encrypted sessions. Credentials stay
// in the child process. Only bounded operation summaries leave the process.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');

async function run() {
  const {app, session, safeStorage} = require('electron');
  const source = path.join(app.getPath('appData'), 'Agent Pulse');
  const supplied = process.env.SONARA_PROBE_PROFILE;
  if (supplied && !path.resolve(supplied).startsWith(path.join(os.tmpdir(), 'sonara-provider-probe-'))) throw new Error('Invalid isolated profile');
  const profile = supplied || fs.mkdtempSync(path.join(os.tmpdir(), 'sonara-provider-probe-'));
  function copy(relative) {
    const input = path.join(source, relative), output = path.join(profile, relative);
    if (!fs.existsSync(input)) return;
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.copyFileSync(input, output);
  }
  if (!supplied) {
  copy('Local State');
  copy('music/music-qishui-auth.json');
  for (const provider of ['qq', 'kugou', 'qishui']) {
    for (const file of ['Cookies', 'Cookies-journal', 'Cookies-wal', 'Cookies-shm']) {
      copy(`Partitions/agent-pulse-${provider}-official/Network/${file}`);
    }
  }
  }
  app.setPath('userData', profile);
  await app.whenReady();
  const {createPlatformLogin} = require('../src/music/platform-login.cjs');
  const manager = createPlatformLogin({electron:{session,safeStorage},dataDir:path.join(profile,'music')});
  const results = [];
  const transport = require('../src/music/providers/http.cjs').createProviderHTTP({domains:['qq.com'],maxActive:2});
  const qq = require('../src/music/providers/index.cjs').createProviderAdapter({provider:'qq',getCookie:async()=>{
    const cookies=await session.fromPartition('persist:agent-pulse-qq-official').cookies.get({});
    if (!run.cookieChecked) {
      run.cookieChecked=true;
      console.log(JSON.stringify({cookieMetadata:cookies.filter(item=>/^(uin|qqmusic_uin|wxuin|qm_keyst|qqmusic_key|music_key|wxskey|login_type|wxopenid)$/.test(item.name)).map(item=>({name:item.name,domain:item.domain,length:item.value.length,expired:item.expirationDate?item.expirationDate*1000<Date.now():false}))}));
    }
    return cookies.map(value=>value.name+'='+value.value).join('; ');
  },requestText:async(url,opts,body)=>{
    const response=await transport.requestText(url,opts,body);
    const input=JSON.parse(body||'{}');
    if (input.req?.module==='music.search.SearchCgiService') {
      const data=JSON.parse(response)?.req?.data?.body;
      const songs=data?.item_song || data?.song?.list || [];
      console.log(JSON.stringify({mediaIdLengths:songs.slice(0,5).map(song=>String(song.file?.media_mid||song.strMediaMid||'').length)}));
    }
    if (/vkey/i.test(input.req_0?.module||'')) {
      const value=JSON.parse(response),data=value.req_0?.data;
      console.log(JSON.stringify({vkey:{rpc:input.req_0.module,code:value.code,methodCode:value.req_0?.code,keys:Object.keys(data||{}),
        retcode:data?.retcode,verifyType:data?.verify_type,deviceResult:data?.deviceResult,hasLoginKey:!!data?.login_key,
        sipHosts:(data?.sip||[]).map(value=>{try{return new URL(value).hostname;}catch{return 'invalid';}}),
        formats:(data?.midurlinfo||[]).map(value=>({prefix:String(value.filename||'').slice(0,4),hasURL:!!value.purl,result:value.result,code:value.code}))}}));
    }
    return response;
  }});
  const kgTransport = require('../src/music/providers/http.cjs').createProviderHTTP({domains:['kugou.com'],maxActive:2});
  const kg = require('../src/music/providers/index.cjs').createProviderAdapter({provider:'kugou',getCookie:async()=>{
    const cookies=await session.fromPartition('persist:agent-pulse-kugou-official').cookies.get({});
    return cookies.map(value=>value.name+'='+value.value).join('; ');
  },requestText:async(url,opts,body)=>{
    const response=await kgTransport.requestText(url,opts,body);
    if (/\/v5\/url|\/play\/songinfo|getSongInfo/.test(url)) {
      const value=JSON.parse(response),data=value.data||value;
      const facts=Object.fromEntries(Object.entries(data).filter(([key,value])=>/bit|rate|quality|size|format|ext|level/i.test(key)&&typeof value!=='object'&&String(value).length<40));
      console.log(JSON.stringify({kugouFormat:{keys:Object.keys(data),facts}}));
    }
    return response;
  }});
  const errorSummary = error => String(error?.message || 'failed')
    .replace(/https?:\/\/\S+/g, '[URL]')
    .replace(/(?:cookie|token|authst|vkey)\s*[:=]\s*\S+/gi, '[credential]')
    .slice(0,200);
  try {
    for (const provider of ['qq', 'kugou', 'qishui']) {
      const result = {provider};
      try {
        const request=payload=>provider==='qq'?qq.request(payload):provider==='kugou'?kg.request(payload):manager.request({provider,...payload});
        const verified = await request({action:'profile'});
        result.verified = verified.apiConnected === true;
        const query=process.env.SONARA_PROBE_QUERY||'Set for Life Trent Dabbs';
        const list = await request({action:'search',query,limit:5});
        result.searchCount = list.songs?.length || 0;
        const song = process.env.SONARA_PROBE_QUERY ? list.songs?.[0] : list.songs?.find(value => /set for life/i.test(value.title) && /trent dabbs/i.test(value.artist));
        result.matched = !!song;
        if (song) {
          result.qualities = [];
          for (const quality of ['standard','lossless']) {
            try {
              const play = await request({action:'play',id:song.id,song,quality});
              result.qualities.push({requested:quality,returned:play.quality,host:play.url?new URL(play.url).hostname:'',hasURL:!!play.url,trial:play.trial===true});
            } catch (error) {result.qualities.push({requested:quality,error:errorSummary(error)});}
          }
        }
      } catch (error) {result.error=errorSummary(error);}
      results.push(result);
    }
    console.log(JSON.stringify({results}));
  } finally {
    await manager.dispose();
    qq.dispose();transport.dispose();kg.dispose();kgTransport.dispose();
    for (const provider of ['qq','kugou','qishui']) {
      await session.fromPartition('persist:agent-pulse-'+provider+'-official').closeAllConnections();
    }
    app.quit();
    app.once('quit', () => {try {fs.rmSync(profile,{recursive:true,force:true});} catch {}});
  }
}

if (process.versions.electron) {
  run().catch(error => {console.error(String(error.message).slice(0,160));require('electron').app.exit(1);});
} else {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require('electron'),[__filename],{cwd:root,env,windowsHide:true,stdio:'inherit'});
  const timeout=setTimeout(()=>child.kill(),180000);
  child.on('exit',code=>{clearTimeout(timeout);process.exitCode=code||0;});
}
