'use strict';
// Anonymous live verification of the actual main/preload music bridge. Never
// loads an existing app profile, scans a personal account, or stores a QR/key.
const fs = require('node:fs');
const path = require('node:path');
const workspace = path.resolve(__dirname, '..');
function argument(name) {
  const exact = process.argv.indexOf('--' + name);
  return exact >= 0 ? process.argv[exact + 1] : process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
}
const root = path.resolve(argument('root') || process.env.PULSE_MUSIC_AUTH_ROOT || workspace);
const output = path.resolve(argument('output') || process.env.PULSE_MUSIC_AUTH_OUTPUT || path.join(workspace, 'artifacts', 'v' + require('../package.json').version + '-music-auth'));
const phase = process.argv.includes('--music-auth-child');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const file = path.join(output, 'music-auth-report.json');
function save(report) { fs.mkdirSync(output, {recursive: true}); fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); }
function safeFailure(error, stage) {
  // Network libraries may attach request configs. Copy only a bounded textual
  // explanation, remove URLs, and never serialize the original error object.
  const code = typeof error?.code === 'string' && /^[A-Z_0-9-]{1,50}$/.test(error.code) ? error.code : 'CHECK_FAILED';
  const message = String(error?.message || 'Music authentication diagnostic failed').replace(/https?:\/\/[^\s)]+/g, '[URL omitted]').replace(/(?:MUSIC_U|__csrf|codekey|unikey)\s*[:=]\s*[^\s;,]+/gi, '[credential omitted]').slice(0, 240);
  return {stage, code, message};
}
async function runner() {
  const {spawn} = require('node:child_process'), electron = require('electron');
  fs.mkdirSync(output, {recursive: true});
  const profile = fs.mkdtempSync(path.join(output, 'profile-'));
  const codexHome = path.join(profile, 'empty-codex'), claudeHome = path.join(profile, 'empty-claude');
  fs.mkdirSync(codexHome); fs.mkdirSync(claudeHome);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({interfaceTheme: 'electric-purple', islandEnabled: false, musicReactive: false, musicCover: false, islandEdge: 'off', launchAtLogin: false}));
  const env = {...process.env, PULSE_MUSIC_AUTH_ROOT: root, PULSE_MUSIC_AUTH_OUTPUT: output, PULSE_MUSIC_AUTH_PROFILE: profile, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome};
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(electron, [__filename, '--music-auth-child'], {cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stderrBytes = 0, stdoutBytes = 0, settled = false;
    child.stdout.on('data', data => { stdoutBytes += data.length; });
    child.stderr.on('data', data => { stderrBytes += data.length; });
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(Object.assign(new Error('Hidden Electron music authentication diagnostic timed out'), {code: 'TIMEOUT'})); }, 160000);
    child.once('error', error => finish(error));
    child.once('exit', (exitCode, signal) => finish(null, {pid: child.pid, exitCode, signal, stderrBytes, stdoutBytes}));
  });
  if (!fs.existsSync(file)) throw Object.assign(new Error('Electron exited before producing a music authentication report'), {code: 'MISSING_REPORT'});
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  report.child = result;
  report.checks.childExitedNormally = result.exitCode === 0 && result.signal === null;
  save(report);
  const passed = !report.failure && Object.values(report.checks).every(value => value === true);
  console.log(JSON.stringify({passed, checks: report.checks, ...(report.failure ? {failure: report.failure} : {}), output: file}));
  if (!passed) process.exitCode = 1;
}
async function child() {
  const electron = require('electron'), {app, BrowserWindow, session, safeStorage} = electron;
  const profile = process.env.PULSE_MUSIC_AUTH_PROFILE;
  if (!profile || !process.env.CODEX_HOME?.startsWith(profile + path.sep) || !process.env.CLAUDE_CONFIG_DIR?.startsWith(profile + path.sep)) throw new Error('Isolated diagnostic profile is required');
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  for (const name of ['show', 'showInactive', 'focus']) BrowserWindow.prototype[name] = function() {};
  const report = {checkedAt: new Date().toISOString(), root, profile, mode: 'real-main-real-preload-anonymous-QR', checks: {}, requests: [], normalQuit: false, sensitiveDataSaved: false};
  let stage = 'load-main';
  const check = (name, passed) => { report.checks[name] = Boolean(passed); if (!passed) throw Object.assign(new Error('Failed check: ' + name), {code: 'ASSERTION_FAILED'}); };
  app.once('will-quit', () => { report.normalQuit = true; report.checks.normalQuit = true; save(report); });
  if (root.endsWith('.asar')) {
    Object.defineProperty(app, 'isPackaged', {value: true});
    Object.defineProperty(process, 'resourcesPath', {value: path.dirname(root)});
  }
  try {
    require(path.join(root, 'src', 'main.cjs'));
    await app.whenReady();
    const until = async (predicate, timeout = 35000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) { const value = await predicate(); if (value) return value; await sleep(75); }
      throw Object.assign(new Error('Timed out waiting for the hidden dashboard and its real preload'), {code: 'TIMEOUT'});
    };
    const owner = await until(() => BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().endsWith('/ui/dashboard.html') && !win.webContents.isLoading()));
    const web = owner.webContents;
    const capture = async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try { return await web.capturePage(); }
        catch (error) { if (!String(error.message).includes('UnknownVizError') || attempt === 3) throw error; await sleep(75); }
      }
    };
    const untilPaint = async (predicate, timeout = 20000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const value = await predicate(); if (value) return value;
        // Hidden Chromium windows do not continuously produce compositor frames.
        // Request one explicitly, matching the isolated GPU card diagnostic.
        try { await web.capturePage(); } catch (error) { if (!String(error.message).includes('UnknownVizError')) throw error; }
        await sleep(75);
      }
      throw Object.assign(new Error('Timed out waiting for hidden renderer media'), {code: 'TIMEOUT'});
    };
    await until(() => web.executeJavaScript("typeof workspaceReady!=='undefined'&&workspaceReady&&typeof window.pulse?.musicRequest==='function'"));
    const api = (action, payload = {}) => web.executeJavaScript(`(async()=>{const result=await window.pulse.musicRequest(${JSON.stringify(action)},${JSON.stringify(payload)});if(result?.error)throw new Error(result.error);return result;})()`);
    stage = 'isolated-profile';
    check('isolatedProfile', app.getPath('userData') === profile);
    check('hiddenDashboard', !owner.isVisible());
    const snapshot = await web.executeJavaScript('window.pulse.getSnapshot()');
    check('emptySyntheticLogs', snapshot.sessions.length === 0);
    check('unchangedDiagnosticTheme', await web.executeJavaScript("document.documentElement.dataset.interfaceTheme==='electric-purple'"));
    // Observe only host + path, never headers, request bodies, response bodies,
    // cookies, QR image bytes, unikey or the generated login URI.
    const authSession = session.fromPartition('pulse-music-auth');
    const hosts = new Set();
    report.protocolImages = [];
    session.defaultSession.webRequest.onCompleted({urls: ['pulse-music-image://*/*']}, details => {
      if (report.protocolImages.length < 50) report.protocolImages.push({status: details.statusCode});
    });
    session.defaultSession.webRequest.onErrorOccurred({urls: ['pulse-music-image://*/*']}, details => {
      if (report.protocolImages.length < 50) report.protocolImages.push({error: details.error});
    });
    authSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      hosts.add(url.hostname);
      report.requestHosts = [...hosts].sort();
      if (['music.163.com', 'interface.music.163.com'].includes(url.hostname) && report.requests.length < 30) report.requests.push({host: url.hostname, path: url.pathname});
      callback({cancel: false});
    });
    stage = 'real-bootstrap';
    const bootstrap = await api('bootstrap');
    check('freshSignedOut', bootstrap.state === 'signedOut' && bootstrap.profile === null && bootstrap.selected === 'netease');
    check('bootstrapMakesNoAuthRequests', report.requests.length === 0);
    stage = 'real-qr-generation';
    const qr = await api('beginQR');
    check('realQRPNG', typeof qr.qrImage === 'string' && /^data:image\/png;base64,/.test(qr.qrImage) && qr.qrImage.length > 100);
    check('opaqueQRRequestId', typeof qr.requestId === 'string' && /^[a-f0-9]{36}$/.test(qr.requestId));
    const expirySeconds = Math.round((qr.expiresAt - Date.now()) / 1000);
    report.qr = {configuredLifetimeSeconds: 180, observedRemainingSeconds: expirySeconds};
    check('threeMinuteExpiry', expirySeconds >= 175 && expirySeconds <= 180);
    stage = 'real-qr-status';
    const checked = await api('checkQR', {requestId: qr.requestId});
    report.qr.status = checked.status;
    // The production adapter maps only official code 801 to waiting.
    report.qr.mappedOfficialCode = checked.status === 'waiting' ? 801 : null;
    check('official801Waiting', checked.status === 'waiting');
    check('officialRequestsOnly', report.requests.length === 2 && report.requests.every(value => value.host === 'interface.music.163.com') && report.requests.some(value => value.path === '/eapi/login/qrcode/unikey') && report.requests.some(value => value.path === '/eapi/login/qrcode/client/login'));
    stage = 'real-cancel';
    const canceled = await api('cancelQR', {requestId: qr.requestId});
    check('realCancel', canceled.cancelled === true || canceled.canceled === true);
    check('cancelledQRStaysExpired', (await api('checkQR', {requestId: qr.requestId})).status === 'expired');
    check('cancelDoesNotPollAgain', report.requests.length === 2);
    check('anonymousFlowStoresNoAccount', !fs.existsSync(path.join(profile, 'music', 'music-auth.json')));
    stage = 'real-dpapi';
    check('realOSEncryptionAvailable', safeStorage.isEncryptionAvailable());
    const {createAuthStore} = require(path.join(root, 'src', 'music', 'auth-store.cjs'));
    const fixtureDir = path.join(profile, 'dpapi-fixture');
    const store = createAuthStore({dataDir: fixtureDir, encryptString: value => safeStorage.encryptString(value), decryptString: value => safeStorage.decryptString(value), isEncryptionAvailable: () => safeStorage.isEncryptionAvailable()});
    const fixture = {MUSIC_U: 'agent-pulse-isolated-dpapi-fixture', __csrf: 'diagnostic-csrf-only'};
    check('realEncryptedAtomicSave', await store.save(fixture, {nickname: 'Isolated fixture', userId: 12345}));
    const text = fs.readFileSync(path.join(fixtureDir, 'music-auth.json'), 'utf8'), loaded = await store.load();
    check('realDPAPIRoundtrip', loaded?.cookie?.MUSIC_U === fixture.MUSIC_U && loaded?.cookie?.__csrf === fixture.__csrf && loaded?.profile?.nickname === 'Isolated fixture');
    check('noPlainFixtureOnDisk', !text.includes(fixture.MUSIC_U) && !text.includes(fixture.__csrf) && !text.includes('Isolated fixture'));
    await store.clear();
    check('fixtureCleared', !fs.existsSync(path.join(fixtureDir, 'music-auth.json')));
    stage = 'real-content-home';
    const home = await api('home');
    report.home = {mode: home.recommendationMode, label: home.recommendationLabel, songs: home.songs?.length || 0, cards: home.cards?.length || 0, playlists: home.playlists?.length || 0};
    check('publicDailyRecommendation', home.recommendationMode === 'public' && home.songs?.length > 0 && home.songs.length <= 30 && ['公开每日推荐', '公开新歌推荐'].includes(home.recommendationLabel));
    check('orderedDailyCards', home.cards?.length >= 5 && new Set(home.cards.map(value => value.id)).size === home.cards.length && JSON.stringify(home.cards.map(value=>value.id))===JSON.stringify(home.songs.map(value=>value.id)));
    check('eighteenIndependentHighPlaylists', home.playlists?.length === 18&&home.playlists.every(value=>value.playCount>0&&!/每日推荐|私人雷达|私人漫游|心动模式|相似歌曲/.test(value.title)));
    check('realHighPlaylistCounts',home.playlists.every(value=>Number.isSafeInteger(value.playCount)&&value.playCount>0));
    const stableHome=await api('home'),nextVisit=await api('home',{refreshPlaylists:true}),playlistIDs=value=>value.playlists.map(item=>item.id);
    check('hotPlaylistOrderStableWithinVisit',JSON.stringify(playlistIDs(stableHome))===JSON.stringify(playlistIDs(home)));
    check('hotPlaylistsChangeOnNextVisit',JSON.stringify(playlistIDs(nextVisit))!==JSON.stringify(playlistIDs(home))&&nextVisit.playlists.some(item=>!home.playlists.some(previous=>previous.id===item.id)));
    check('hotPlaylistRefreshRetainsDailySongs',JSON.stringify(nextVisit.songs)===JSON.stringify(home.songs));
    stage = 'real-search-comments-playlist';
    const search = await api('search', {query: '晴天'});
    check('realContentSearch', search.songs?.length > 0 && search.songs.length <= 30 && Array.isArray(search.playlists));
    report.search = {songs: search.songs.length, playlists: search.playlists.length};
    const playlist = await api('playlist', {id: home.playlists[0].id});
    check('realPlaylistSongs', playlist.songs?.length > 0 && playlist.songs.length <= 30);
    report.playlist = {songs: playlist.songs.length};
    stage = 'real-cover-cdn';
    const coverResponse = await authSession.fetch(home.cards[0].coverURL, {credentials: 'omit', redirect: 'error'});
    report.coverCDN = {status: coverResponse.status, type: coverResponse.headers.get('content-type'), declaredBytes: Number(coverResponse.headers.get('content-length')) || null};
    await coverResponse.body?.cancel();
    stage = 'real-music-ui';
    web.setBackgroundThrottling(false);
    // All native windows stay hidden. The isolated renderer's visibility flag
    // is made visible so production cards perform real image uploads/GPU work
    // instead of their intentional hidden-page resource-release path.
    await web.executeJavaScript("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.getElementById('nav-music').click();document.dispatchEvent(new Event('visibilitychange'));");
    report.hiddenRendererVisibilityOverride = true;
    await until(async () => {
      report.workspace = await web.executeJavaScript("typeof musicUI!=='undefined'&&musicUI?musicUI.getState().workspace:null");
      return report.workspace?.songs > 0 && report.workspace.songs <= 30 && !report.workspace.loading;
    }, 40000);
    await web.executeJavaScript("document.querySelector('#music-view audio').muted=true");
    try { await capture(); } catch (error) { if (!String(error.message).includes('UnknownVizError')) throw error; }
    stage = 'real-cover-image';
    await untilPaint(async () => {
      report.coverProbe = await web.executeJavaScript("(()=>{const img=document.querySelector('#music-view img.music-cover-fallback');return {controlled:!!img?.src.startsWith('pulse-music-image:'),complete:img?.complete,width:img?.naturalWidth,height:img?.naturalHeight}})()");
      return report.coverProbe.controlled && report.coverProbe.complete && report.coverProbe.width > 0;
    }, 30000);
    report.cover = await web.executeJavaScript("(()=>{const img=document.querySelector('#music-view img.music-cover-fallback');return {width:img.naturalWidth,height:img.naturalHeight}})()");
    check('realControlledCoverImage', report.cover.width > 0 && report.cover.height > 0);
    stage = 'real-webgl-cover';
    await untilPaint(() => web.executeJavaScript("(()=>{const cards=musicUI.getState().workspace.cards;return cards?.renderer==='webgl'&&cards.uploads>0&&cards.draws>0})()"), 20000);
    const surface = await web.executeJavaScript('musicUI.getState().workspace.cards');
    report.coverSurface = {renderer: surface.renderer, gpuContexts: surface.gpuContexts, uploads: surface.uploads, draws: surface.draws};
    report.workspace = await web.executeJavaScript('musicUI.getState().workspace');
    check('realWebGLCoverTexture', surface.renderer === 'webgl' && surface.gpuContexts === 1 && surface.uploads > 0 && surface.draws > 0);
    await untilPaint(()=>web.executeJavaScript("Array.from(document.querySelectorAll('.music-cards img')).length===5&&Array.from(document.querySelectorAll('.music-cards img')).every(img=>img.complete&&img.naturalWidth>0)"),20000);
    report.stackedCovers=await web.executeJavaScript("Array.from(document.querySelectorAll('.music-cards img')).map(img=>({width:img.naturalWidth,height:img.naturalHeight,display:getComputedStyle(img).display}))");
    check('allFiveStackedRealCovers',report.stackedCovers.length===5&&report.stackedCovers.every(img=>img.width>0&&img.height>0&&img.display!=='none'));
    await untilPaint(() => web.executeJavaScript("Array.from(document.querySelectorAll('#music-view img')).filter(img=>img.src.startsWith('pulse-music-image:')&&img.complete&&img.naturalWidth>0).length>=8"), 20000);
    report.loadedControlledCovers = await web.executeJavaScript("Array.from(document.querySelectorAll('#music-view img')).filter(img=>img.src.startsWith('pulse-music-image:')&&img.complete&&img.naturalWidth>0).length");
    check('moreThanFourConcurrentCovers', report.loadedControlledCovers >= 8);
    report.coverLayout = await web.executeJavaScript("Array.from(document.querySelectorAll('.music-playlist-cover img')).map(img=>({complete:img.complete,width:img.naturalWidth,hidden:img.hidden,display:getComputedStyle(img).display,visibility:getComputedStyle(img).visibility,rect:{width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height}}))");
    await capture(); await sleep(100); await capture(); await sleep(100);
    fs.writeFileSync(path.join(output, 'music-live-workspace.png'), (await capture()).toPNG());
    stage='real-discovery-covers-and-click';
    const recommendedIds=await web.executeJavaScript("JSON.stringify(Array.from(document.querySelectorAll('.music-playlist')).map(node=>node.dataset.musicPlaylist))");
    await until(()=>web.executeJavaScript("musicUI.getState().workspace.modePreviews.some(value=>value.mode==='similar'&&value.status==='ready')"),25000);
    check('dailyModeCoverComesFromFirstSong',await web.executeJavaScript(`(()=>{const image=document.querySelector('[data-music-discovery="daily"] .music-mode-art img'),raw=image?.getAttribute('src')||image?.getAttribute('data-cover-src');return !!raw&&new URL(raw).searchParams.get('url')===${JSON.stringify(home.songs[0].coverURL)}})()`));
    await web.executeJavaScript(`document.querySelector('[data-music-discovery="daily"]').click()`);
    await until(()=>web.executeJavaScript(`document.querySelector('.music-songs-heading').textContent===${JSON.stringify(home.recommendationLabel)}&&document.querySelector('.music-song-list [data-music-song]')?.dataset.musicSong===${JSON.stringify(home.songs[0].id)}`),20000);
    check('dailyClickUsesItsRealFirstSongAndCover',await web.executeJavaScript(`(()=>{const row=document.querySelector('.music-song-list [data-music-song]'),top=document.querySelector('[data-music-discovery="daily"] .music-mode-art img'),cover=row.querySelector('.music-song-cover img'),source=image=>image.getAttribute('src')||image.getAttribute('data-cover-src');return row.dataset.musicSong===${JSON.stringify(home.songs[0].id)}&&new URL(source(top)).searchParams.get('url')===new URL(source(cover)).searchParams.get('url')})()`));
    await web.executeJavaScript(`document.querySelector('[data-music-discovery="similar"]').click()`);
    await until(()=>web.executeJavaScript("document.querySelector('.music-songs-heading').textContent==='相似歌曲'&&document.querySelector('.music-song-list [data-music-song]')!==null"),20000);
    check('similarClickUsesItsRealFirstSongAndCover',await web.executeJavaScript(`(()=>{const preview=musicUI.getState().workspace.modePreviews.find(value=>value.mode==='similar'),row=document.querySelector('.music-song-list [data-music-song]'),top=document.querySelector('[data-music-discovery="similar"] .music-mode-art img'),cover=row.querySelector('.music-song-cover img'),source=image=>image.getAttribute('src')||image.getAttribute('data-cover-src');return row.dataset.musicSong===preview.songId&&new URL(source(top)).searchParams.get('url')===new URL(source(cover)).searchParams.get('url')})()`));
    check('liveDiscoveryKeepsIndependentPlaylists',await web.executeJavaScript(`JSON.stringify(Array.from(document.querySelectorAll('.music-playlist')).map(node=>node.dataset.musicPlaylist))===${JSON.stringify(recommendedIds)}`));
    await web.executeJavaScript("document.querySelector('.music-search-clear').click()");await until(()=>web.executeJavaScript(`document.querySelector('.music-songs-heading').textContent==='为你推荐歌曲'&&!!document.querySelector('[data-music-song="${home.songs[0].id}"]')`),20000);
    stage = 'real-authorized-play-plan';
    let selected = null, attempts = 0;
    for (const candidate of home.songs.slice(0, 3)) {
      attempts++;
      try {
        const result = await api('play', {id: candidate.id});
        if (result.playable === true && typeof result.audioURL === 'string' && result.audioURL.startsWith('pulse-music-audio://')) { selected = candidate; break; }
      } catch (error) { if (attempts === 3) throw error; }
    }
    if (!selected) throw Object.assign(new Error('First three daily candidates were unavailable to an anonymous listener'), {code: 'PLAYBACK_UNAVAILABLE'});
    report.audio = {songId: selected.id, authorizedPlanAttempts: attempts};
    const comments = await api('comments', {id: selected.id});
    report.comments = {count: comments.comments?.length || 0, total: Number(comments.total) || 0};
    check('realBoundedComments', Array.isArray(comments.comments) && comments.comments.length > 0 && comments.comments.length <= 20);
    const lyric=await api('lyrics',{id:selected.id});report.lyrics={lines:lyric.lines.length,instrumental:lyric.instrumental,unsynced:!!lyric.unsynced};
    check('realLyricsResponse',Array.isArray(lyric.lines)&&lyric.lines.length<=1200&&(lyric.lines.length>0||lyric.instrumental||!!lyric.unsynced));
    const playbackOptions=await api('playbackOptions');check('fiveRealQualityOptions',JSON.stringify(playbackOptions.qualityOptions.map(option=>option.id))===JSON.stringify(['jymaster','hires','lossless','exhigh','standard']));
    stage = 'real-muted-audio-decode';
    await web.executeJavaScript(`(()=>{const audio=document.querySelector('#music-view audio');audio.muted=true;const button=document.querySelector('.music-song-list [data-music-song="${selected.id}"]');if(!button)throw new Error('Daily song row missing');button.click()})()`, true);
    await until(() => web.executeJavaScript("(()=>{const audio=document.querySelector('#music-view audio');if(audio?.error)throw new Error('Controlled audio decoder failed with code '+audio.error.code);return audio?.muted===true&&audio.readyState>=2&&Number.isFinite(audio.duration)&&audio.duration>0&&audio.currentTime>.4})()"), 40000);
    const decoded = await web.executeJavaScript("(()=>{const audio=document.querySelector('#music-view audio');const result={muted:audio.muted,position:audio.currentTime,duration:audio.duration,controlled:audio.currentSrc.startsWith('pulse-music-audio:')};audio.pause();return result})()");
    report.audio = {...report.audio, ...decoded};
    check('realMutedAudioDecoded', decoded.muted && decoded.controlled && decoded.position > 0 && decoded.duration > 0);
    await until(()=>web.executeJavaScript("musicUI.getState().lyrics.lines>0&&document.querySelector('.music-lyrics-lines [aria-current=\"true\"]')!==null"),15000);
    check('realLyricsFollowAudio',await web.executeJavaScript("musicUI.getState().lyrics.songId===musicUI.getState().player.songId&&musicUI.getState().lyrics.position>0"));
    stage = 'real-history-progress';
    const recent = await until(async () => { const value = await api('home'); return value.recent?.find(song => song.id === selected.id && song.position > 0) || null; }, 10000);
    report.history = {songId: recent.id, position: recent.position};
    check('realPlaybackHistory', recent.id === selected.id && recent.position > 0);
    const listening=await api('listening');report.listening={todaySongs:listening.todaySongs,todaySeconds:listening.todaySeconds,streakDays:listening.streakDays};
    check('realListeningCountsOnlyPlayedSong',listening.todaySongs===1&&listening.todaySeconds>0&&listening.todaySeconds<10&&listening.streakDays===1);
    stage = 'stop-audio';
    check('realStopAudio', (await api('stopAudio')).stopped === true);
    await web.executeJavaScript("const audio=document.querySelector('#music-view audio');audio.pause();audio.removeAttribute('src');audio.load();musicUI.deactivate();");
    report.requestHosts = [...hosts].sort();
    check('allNativeWindowsRemainHidden', BrowserWindow.getAllWindows().every(win => !win.isVisible()));
    stage = 'normal-quit';
    report.checks.normalQuit = false; save(report); app.quit();
  } catch (error) {
    report.failure = safeFailure(error, stage); save(report); process.exitCode = 1; app.quit();
  }
}
if (phase) child().catch(error => { save({root, checks: {}, normalQuit: false, failure: safeFailure(error, 'child-startup'), sensitiveDataSaved: false}); console.error('Music authentication diagnostic could not start'); process.exitCode = 1; require('electron').app.quit(); });
else runner().catch(error => { const failure = safeFailure(error, 'runner'); save({root, checks: {}, normalQuit: false, failure, sensitiveDataSaved: false}); console.error(JSON.stringify({passed: false, failure, output: file})); process.exitCode = 1; });
