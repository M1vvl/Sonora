'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const {createSpotifyOAuth}=require('../src/music/spotify-oauth.cjs');
const {createSpotifyAdapter}=require('../src/music/providers/spotify.cjs');
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value.split('').reverse().join('')),decryptString:value=>value.toString().split('').reverse().join('')};
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sonara-spotify-test-'));
  const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const redirectURI='http://127.0.0.1:'+port+'/spotify/callback',calls=[],opened=[],changes=[];let stamp=0;
  const options={dataDir:directory,safeStorage,redirectURI,now:()=>stamp,openExternal:async url=>opened.push(url),onChange:value=>changes.push(value),fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(url.endsWith('/api/token')?{access_token:'access-private',refresh_token:'refresh-private',expires_in:3600}:{id:'owner'}),{status:200});}};
  const oauth=createSpotifyOAuth(options);t.after(async()=>{await oauth.dispose();assert(directory.startsWith(path.join(os.tmpdir(),'sonara-spotify-test-')));await fs.rm(directory,{recursive:true,force:true});});return {oauth,options,directory,calls,opened,changes,redirectURI,setTime:value=>{stamp=value;}};
}
test('PKCE consumes only a matching loopback state, stores only encrypted refresh credentials, and shares refresh',async t=>{
  const f=await fixture(t);await Promise.all([f.oauth.authorize(),f.oauth.authorize()]);assert.equal(f.opened.length,1);
  const authorization=new URL(f.opened[0]);assert.equal(authorization.hostname,'accounts.spotify.com');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');assert(!authorization.searchParams.has('client_secret'));
  const bad=await fetch(f.redirectURI+'?state=wrong&code=fixture');assert.equal(bad.status,400);await bad.text();assert.equal(f.calls.length,0);
  const good=await fetch(f.redirectURI+'?state='+authorization.searchParams.get('state')+'&code=fixture');assert.equal(good.status,200);await good.text();assert.equal(f.oauth.getStatus().authorizing,false);
  const form=new URLSearchParams(f.calls[0].init.body);assert.equal(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'),authorization.searchParams.get('code_challenge'));assert.equal(form.get('redirect_uri'),f.redirectURI);
  const saved=await fs.readFile(path.join(f.directory,'music-spotify-oauth.json'),'utf8');assert(!saved.includes('refresh-private'));assert(!saved.includes('access-private'));assert(!JSON.stringify(f.oauth.getStatus()).includes('private'));
  f.setTime(3600000);await Promise.all([f.oauth.api('/me'),f.oauth.api('/me')]);assert.equal(f.calls.filter(row=>row.url.endsWith('/api/token')).length,2);assert(f.calls.filter(row=>row.url.endsWith('/me')).every(row=>row.init.headers.Authorization==='Bearer access-private'));
  await f.oauth.logout();assert.equal(await f.oauth.hasSession(),false);await assert.rejects(f.oauth.api('/me'),/授权连接/);
});
test('cancelling Spotify authorization releases the listener and never persists a login',async t=>{const f=await fixture(t);await f.oauth.authorize();f.oauth.cancel();assert.equal(f.oauth.getStatus().authorizing,false);assert.equal(await f.oauth.hasSession(),false);await f.oauth.authorize();assert.equal(f.opened.length,2);});
const id='1234567890ABCDEFGHIJKL',raw={id,name:'Fixture',type:'track',artists:[{name:'Artist'}],duration_ms:180000,album:{name:'Album',images:[{url:'https://i.scdn.co/image/fixture'}]}};
test('Spotify library and verified likes remain bound to Spotify and use current library endpoints',async t=>{
  const calls=[];let liked=false;
  const oauth={api:async(endpoint,options={})=>{calls.push({endpoint,options});if(endpoint==='/me')return {id:'owner',display_name:'Owner'};if(endpoint.startsWith('/me/playlists'))return {items:[{id,name:'Owned',owner:{id:'owner'},items:{total:1}}]};if(endpoint.startsWith('/me/tracks'))return {items:[{track:raw}],total:1};if(endpoint.startsWith('/me/library?')){liked=options.method==='PUT';return {};}if(endpoint.startsWith('/me/library/contains'))return [liked];throw new Error('Unexpected '+endpoint);},hasSession:async()=>true,cancel(){},dispose:async()=>{}};
  const adapter=createSpotifyAdapter({oauth});t.after(()=>adapter.dispose());const profile=await adapter.request({action:'profile'});assert.equal(profile.apiConnected,true);
  const library=await adapter.request({action:'playlists'});assert.equal(library.playlists[0].id,'spotify:liked');assert.equal(library.playlists[1].owned,true);
  const songs=await adapter.request({action:'playlist',id:'spotify:liked'});assert.equal(songs.songs[0].id,'spotify:'+id);assert.equal(songs.songs[0].liked,true);
  const result=await adapter.request({action:'like',id:'spotify:'+id,liked:true});assert.deepEqual(result,{id:'spotify:'+id,provider:'spotify',liked:true});assert(calls.some(row=>row.endpoint.startsWith('/me/library?')&&row.options.method==='PUT'));assert(!JSON.stringify(result).includes('token'));
  await assert.rejects(adapter.request({action:'like',id:'spotify:'+id,source:'qq',liked:true}),/不匹配/);
});
test('Spotify never reports a successful favorite when server verification disagrees',async()=>{const adapter=createSpotifyAdapter({oauth:{api:async()=>[false],dispose:async()=>{},cancel(){}}});try{await assert.rejects(adapter.request({action:'like',id:'spotify:'+id,liked:true}),/未确认/);}finally{await adapter.dispose();}});
test('Spotify Connect selects only an unrestricted computer and never exposes an audio or auth URL',async()=>{
  const calls=[],adapter=createSpotifyAdapter({oauth:{api:async(endpoint,options)=>{calls.push({endpoint,options});return endpoint==='/me/player/devices'?{devices:[{id:'phone',type:'Smartphone',is_active:true},{id:'pc',type:'Computer',name:'This PC'}]}:{};},dispose:async()=>{},cancel(){}}});
  try{const value=await adapter.request({action:'play',id:'spotify:'+id,song:{id:'spotify:'+id,title:'Fixture',artist:'Artist',duration:180},position:12});assert.equal(value.remote,true);assert.equal(value.audioURL,undefined);assert(calls.some(row=>row.endpoint==='/me/player/play?device_id=pc'&&row.options.body.position_ms===12000));await adapter.request({action:'stopPlayback'});assert(calls.some(row=>row.endpoint==='/me/player/pause?device_id=pc'));}finally{await adapter.dispose();}
});
