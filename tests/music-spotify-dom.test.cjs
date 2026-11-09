'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {snapshotScript,targetScript}=require('../src/music/spotify-dom.cjs');

test('playing row ignores the equalizer icon and extracts the full-size album image',()=>{
 const hash='6a7e6ceda5e779fbb6ec1ba8';
 const dom=new JSDOM(`<main><div data-testid="tracklist-row"><img src="https://open.spotifycdn.com/cdn/images/equaliser-green.svg"><img src="https://i.scdn.co/image/ab67616d00004851${hash}"><a href="/track/1234567890ABCDEFGHIJKL">Song</a><a href="/artist/ABCDEFGHIJKLMNOPQRSTUV">Artist</a><span>3:13</span></div></main>`,{url:'https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL',runScripts:'outside-only'});
 try{assert.equal(dom.window.eval(snapshotScript).songs[0].coverURL,'https://i.scdn.co/image/ab67616d0000b273'+hash);}finally{dom.window.close();}
});

test('home keeps primary recommendations, excludes subtitle links and prefers the largest declared artwork',()=>{
 const id='1234567890ABCDEFGHIJKL',related='ABCDEFGHIJKLMNOPQRSTUV';
 const dom=new JSDOM(`<aside><a href="/playlist/${id}">Small sidebar entry</a></aside><main><div data-encore-id="card"><img src="https://pickasso.spotifycdn.com/small.jpg" srcset="https://pickasso.spotifycdn.com/small.jpg 320w, https://pickasso.spotifycdn.com/large.jpg 640w"><a href="/playlist/${id}">Actual mix</a><div data-encore-id="cardSubtitle"><a href="/playlist/${related}">Related artist</a></div></div></main>`,{url:'https://open.spotify.com/',runScripts:'outside-only'});
 try{const value=dom.window.eval(snapshotScript);assert.equal(value.playlists.length,1);assert.equal(value.mainPlaylistCount,1);assert.equal(value.playlists[0].title,'Actual mix');assert.equal(value.playlists[0].coverURL,'https://pickasso.spotifycdn.com/large.jpg');}finally{dom.window.close();}
});

test('playlist sibling artwork belongs to its own Encore card and player-only polling skips catalog traversal',()=>{
 const dom=new JSDOM('<main><section><div><img src="https://image-cdn-ak.spotifycdn.com/cover.jpg"><div><a href="/playlist/ABCDEFGHIJKLMNOPQRSTUV">First mix</a></div></div><div><a href="/playlist/1234567890ABCDEFGHIJKL">Missing artwork</a></div></section></main>',{url:'https://open.spotify.com/',runScripts:'outside-only'});
 try{const value=dom.window.eval(snapshotScript);assert.equal(value.playlists[0].coverURL,'https://image-cdn-ak.spotifycdn.com/cover.jpg');assert.equal(value.playlists[1].coverURL,'');const query=dom.window.document.querySelectorAll.bind(dom.window.document);dom.window.document.querySelectorAll=selector=>{assert(!selector.includes('playlist')&&!selector.includes('tracklist'));return query(selector);};const player=dom.window.eval(require('../src/music/spotify-dom.cjs').playerSnapshotScript);assert.equal(player.song,null);assert.equal(player.playlists,undefined);}finally{dom.window.close();}
});
test('official rendered rows become native song metadata without inspecting credentials or hidden application state',()=>{
 const dom=new JSDOM(`<a href="/playlist/1234567890ABCDEFGHIJKL">My playlist</a><a href="/playlist/1234567890ABCDEFGHIJKL">duplicate</a><a href="https://evil.test/playlist/1234567890ABCDEFGHIJKL">foreign</a><div data-testid="tracklist-row"><img src="https://i.scdn.co/image/cover"><a href="/track/ABCDEFGHIJKLMNOPQRSTUV">Song</a><a href="/artist/1234567890ABCDEFGHIJKL">Artist</a><span>3:45</span></div><div data-testid="now-playing-widget"><a href="/track/ABCDEFGHIJKLMNOPQRSTUV">Song</a></div><button data-testid="control-button-playpause" aria-label="Pause"></button><div data-testid="playback-position">0:17</div><div data-testid="playback-duration">3:45</div>`,{url:'https://open.spotify.com/',runScripts:'outside-only'});
 try{const value=JSON.parse(JSON.stringify(dom.window.eval(snapshotScript)));assert.equal(value.playlists.length,1);assert.equal(value.songs[0].id,'spotify:ABCDEFGHIJKLMNOPQRSTUV');assert.equal(value.songs[0].duration,225);assert.equal(value.songs[0].artist,'Artist');assert.equal(value.playing,true);assert.equal(value.position,17);assert.equal(value.song.title,'Song');assert.doesNotMatch(snapshotScript,/localStorage|sessionStorage|document\.cookie|access_token|fetch\(/);}finally{dom.window.close();}
});
test('operations are fixed and reject untrusted identifiers; missing controls never report success',()=>{
 assert.throws(()=>targetScript('evaluate','anything'));assert.throws(()=>targetScript('track',"');fetch('evil')"));
 const dom=new JSDOM('<body></body>',{url:'https://open.spotify.com/',runScripts:'outside-only'});try{assert.equal(dom.window.eval(targetScript('toggle')),null);const value=dom.window.eval(snapshotScript);assert.equal(value.playing,null);assert.equal(value.song,null);}finally{dom.window.close();}
});
test('current Spotify URL-less rows use local playlist keys and the v2 player title without treating its music-note icon as a title',()=>{
 const dom=new JSDOM('<div role="row" aria-rowindex="2"><div data-testid="tracklist-row"><div role="gridcell" aria-colindex="2"><div data-encore-id="text" dir="auto">Actual Song</div><a href="/artist/1234567890ABCDEFGHIJKL">Actual Artist</a></div><div role="gridcell" aria-colindex="5"><div>3:13</div></div></div></div><div data-testid="now-playing-widget-v2"><svg data-testid="track"></svg><a data-testid="context-item-link" href="/album/ABCDEFGHIJKLMNOPQRSTUV">Actual Song</a></div>',{url:'https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL',runScripts:'outside-only'});
 try{const value=dom.window.eval(snapshotScript);assert.equal(value.songs[0].title,'Actual Song');assert.equal(value.songs[0].duration,193);assert.match(value.songs[0].id,/^spotify:[a-f0-9]{22}$/);assert.equal(value.songs[0].browserRow,2);assert.equal(value.song.title,'Actual Song');assert.equal(value.song.id,null);}finally{dom.window.close();}
});

test('Spotify search and personal library public rows map into the shared music catalog',()=>{
 const dom=new JSDOM('<main><div data-encore-id="listRow"><div data-testid="title"><a href="/track/ABCDEFGHIJKLMNOPQRSTUV">Night City</a></div><a href="/artist/1234567890ABCDEFGHIJKL">R E L</a><div data-testid="save-button"><button aria-checked="true"></button></div></div></main><div role="row"><p id="listrow-title-spotify:playlist:1234567890ABCDEFGHIJKL">My playlist</p><p data-encore-id="listRowSubtitle">歌单 • Listener</p></div>',{url:'https://open.spotify.com/search/Night%20City',runScripts:'outside-only'});
 try{const result=dom.window.eval(snapshotScript);assert.equal(result.songs[0].title,'Night City');assert.equal(result.songs[0].liked,true);assert.equal(result.library[0].title,'My playlist');assert.equal(result.library[0].creator,'Listener');}finally{dom.window.close();}
});

test('liking acts through the Liked Songs menu, with a separate readback of actual membership',()=>{
 const {operationScript}=require('../src/music/spotify-dom-actions.cjs');
 const dom=new JSDOM('<div role="row" aria-rowindex="2"><div data-testid="tracklist-row"><div role="gridcell" aria-colindex="2"><div data-encore-id="text" dir="auto">Song</div></div></div></div><div role="menu"><button role="menuitem">添加至“已点赞的歌曲”</button></div>',{url:'https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL',runScripts:'outside-only'});
 try{dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:200,height:30,x:0,y:0});const id=dom.window.eval(snapshotScript).songs[0].id;assert.equal(dom.window.eval(operationScript('likeState',{id})).liked,false);const menu=dom.window.document.querySelector('[role="menuitem"]');menu.onclick=()=>{menu.textContent='从“已点赞的歌曲”中删除';};dom.window.eval(operationScript('like',{id}));assert.equal(dom.window.eval(operationScript('likeState',{id})).liked,true);assert.throws(()=>operationScript('arbitrary-script'));}finally{dom.window.close();}
});
