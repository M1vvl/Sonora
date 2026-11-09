'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {verifySpotifyWebSession,profileFromResponse,spotifyProfileScript}=require('../src/music/spotify-web-session.cjs');

test('Spotify authenticated profile exposes only public display fields',async()=>{
  const requests=[];
  const profile=await verifySpotifyWebSession({network:{fetch:async(url,options)=>{
    requests.push({url,options});
    return Response.json({username:'owned-user',displayName:'Listener',imageUrl:'https://i.scdn.co/image/avatar',email:'private@example.test',token:'secret'});
  }}});
  assert.equal(profile.nickname,'Listener');assert.equal(profile.verification,'web');
  assert.equal(profile.avatarURL,'https://i.scdn.co/image/avatar');
  assert.doesNotMatch(JSON.stringify(profile),/private|secret/);
  assert.equal(requests[0].options.credentials,'include');assert.equal(requests[0].options.redirect,'error');
  assert.equal(profileFromResponse({success:true}),null);
  assert.equal(profileFromResponse({username:'user',imageUrl:'https://spotify.com.evil.test/a'}).avatarURL,'');
});

test('anonymous/error responses and untrusted frames never become authenticated accounts',async()=>{
  const profile=await verifySpotifyWebSession({network:{fetch:async()=>Response.json({error:'not logged in'},{status:401})},views:[{
    isDestroyed:()=>false,getURL:()=> 'https://accounts.google.com/',executeJavaScript:()=>{throw new Error('must not read identity provider');}
  }]});
  assert.equal(profile,null);
});

test('public Spotify account widget verifies the logged-in view without reading storage',async()=>{
  const dom=new JSDOM('<button data-testid="user-widget-link" title="Listener"><img alt="Listener" src="https://i.scdn.co/image/avatar"></button><div role="menu"><a href="/user/owned-user">Profile</a></div>',{runScripts:'outside-only'});
  try{
    dom.window.document.querySelector('button').getBoundingClientRect=()=>({width:32,height:32});
    const script=spotifyProfileScript();assert.doesNotMatch(script,/cookie|localStorage|sessionStorage|accessToken/);
    const profile=await verifySpotifyWebSession({views:[{isDestroyed:()=>false,getURL:()=> 'https://open.spotify.com/',executeJavaScript:code=>Promise.resolve(dom.window.eval(code))}]});
    assert.equal(profile.nickname,'Listener');assert.equal(profile.userId,'owned-user');
  }finally{dom.window.close();}
});

test('opaque account usernames never become nicknames and public aliases are supported',()=>{
  const opaque='316tfcu46djjuihydv755gg';
  assert.equal(profileFromResponse({username:opaque}).nickname,'Spotify 账号');
  assert.equal(profileFromResponse({username:opaque,displayName:opaque,display_name:'真实昵称',avatar_url:'https://i.scdn.co/image/real'}).nickname,'真实昵称');
  assert.equal(profileFromResponse({username:'listener',display_name:'listener'}).nickname,'listener');
  assert.equal(profileFromResponse({username:opaque,display_name:'真实昵称',avatar_url:'https://i.scdn.co/image/real'}).avatarURL,'https://i.scdn.co/image/real');
});

test('account id response is enriched with the owned visible widget and not an unrelated public user link',async()=>{
  const dom=new JSDOM('<button data-testid="user-widget-link" aria-label="真正的昵称"><img alt="个人资料" srcset="https://i.scdn.co/image/real 1x, https://i.scdn.co/image/large 2x"></button><a href="/user/unrelated-curator">Other user</a>',{runScripts:'outside-only'});
  try{
    dom.window.document.querySelector('button').getBoundingClientRect=()=>({width:32,height:32});
    const requests=[];
    const profile=await verifySpotifyWebSession({network:{fetch:async url=>{requests.push(url);return Response.json({username:'316tfcu46djjuihydv755gg'});}},views:[{
      isDestroyed:()=>false,getURL:()=> 'https://open.spotify.com/',executeJavaScript:code=>Promise.resolve(dom.window.eval(code))
    }]});
    assert.equal(profile.userId,'316tfcu46djjuihydv755gg');assert.equal(profile.nickname,'真正的昵称');assert.equal(profile.avatarURL,'https://i.scdn.co/image/real');
    assert.equal(requests.length,1);
  }finally{dom.window.close();}
});

test('official public profile head is a bounded fallback for a verified opaque account',async()=>{
  const requests=[];
  const profile=await verifySpotifyWebSession({network:{fetch:async(url,options)=>{
    requests.push({url,options});
    if(requests.length===1)return Response.json({username:'316tfcu46djjuihydv755gg'});
    return new Response('<html><head><meta content="真实 &amp; 昵称 on Spotify" property="og:title"><meta property="og:image" content="https://i.scdn.co/image/real"></head><body>'+ 'x'.repeat(90000));
  }}});
  assert.equal(profile.nickname,'真实 & 昵称');assert.equal(profile.avatarURL,'https://i.scdn.co/image/real');
  assert.equal(requests[1].url,'https://open.spotify.com/user/316tfcu46djjuihydv755gg');
  assert.equal(requests[1].options.signal,requests[0].options.signal);
  assert.equal(requests[1].options.credentials,'include');assert.equal(requests[1].options.redirect,'error');
});

test('failed public profile enrichment retains verified account without displaying id',async()=>{
  let requests=0;
  const profile=await verifySpotifyWebSession({network:{fetch:async()=>++requests===1?Response.json({id:'316tfcu46djjuihydv755gg'}):new Response('unavailable',{status:403})}});
  assert.equal(profile.userId,'316tfcu46djjuihydv755gg');assert.equal(profile.nickname,'Spotify 账号');
  assert.equal(profile.avatarURL,'');assert.equal(requests,2);
});

test('unverified requests never trigger public user enrichment and credentials cannot leave official host',async()=>{
  let requests=0,executed=0;
  const profile=await verifySpotifyWebSession({network:{fetch:async()=>{requests++;return Response.json({error:'anonymous'});}},views:[{
    isDestroyed:()=>false,getURL:()=> 'https://open.spotify.com.evil.test/',executeJavaScript:()=>{executed++;}
  },{isDestroyed:()=>false,getURL:()=> 'https://spoof@open.spotify.com/',executeJavaScript:()=>{executed++;}}]});
  assert.equal(profile,null);assert.equal(requests,1);assert.equal(executed,0);
});
