'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSpotifyBrowserPilot}=require('../src/music/spotify-browser-pilot.cjs');
const {JSDOM}=require('jsdom');
const {create:workspaceUI}=require('../ui/music/music-workspace.js');
function fixture(){const id='spotify:1234567890ABCDEFGHIJKL',song={id,title:'Pilot Song',artist:'Artist',source:'spotify',duration:200};let playing=false,position=0,closed=false;const bridge={async open(){},async minimize(){},async read(){return {playlists:[{id:'spotify:ABCDEFGHIJKLMNOPQRSTUV',title:'Pilot playlist'}],songs:[song],playing,position,song,loginRequired:false};},async playlist(){return this.read();},async play(){playing=true;position=1;return this.read();},async toggle(){playing=!playing;return this.read();},async dispose(){closed=true;}};const pilot=createSpotifyBrowserPilot({bridge});return {pilot,song,setPosition:value=>position=value,get closed(){return closed;}};}
test('native Sonara playlist UI sends play through the webpage adapter and receives real acknowledged pause/progress',async()=>{
 const f=fixture(),dom=new JSDOM('<div class="music-view"><form></form><section></section></div>',{url:'https://sonara.test',pretendToBeVisual:true});let played;
 const ui=workspaceUI({root:dom.window.document.querySelector('section'),searchRoot:dom.window.document.querySelector('form'),api:(action,value)=>f.pilot.request({action,...value}),onPlay:song=>{played=f.pilot.request({action:'play',id:song.id});}});
 try{await f.pilot.start({nickname:'Pilot user'});await ui.activate();assert.equal(ui.getState().webPlayer,false);assert.equal(ui.getState().songs,1);dom.window.document.querySelector('[data-music-song]').click();assert.equal((await played).remote,true);f.setPosition(8);assert.equal((await f.pilot.request({action:'playerState'})).position,8);assert.deepEqual(await f.pilot.request({action:'playerControl',control:'pause'}),{ok:true});assert.equal((await f.pilot.request({action:'playerState'})).playing,false);await assert.rejects(f.pilot.request({action:'like',liked:'invalid'}),/收藏状态/);}finally{ui.dispose();dom.window.close();await f.pilot.dispose();assert(f.closed);}
});
test('Spotify lyric lookup runs independently of the webpage playback command queue',async()=>{
 let release,playing=false;const song={id:'spotify:1234567890ABCDEFGHIJKL',title:'Song',artist:'Artist',duration:193,source:'spotify'};
 const bridge={async open(){},async minimize(){},async read(){return {playlists:[{id:'spotify:ABCDEFGHIJKLMNOPQRSTUV',title:'Mix'}],songs:[song],playing,position:0,song};},async playlist(){return this.read();},async toggle(){playing=!playing;},async dispose(){}};
 const pilot=createSpotifyBrowserPilot({bridge,lookupLyrics:target=>{assert.equal(target.id,song.id);return new Promise(resolve=>{release=resolve;});}});
 try{await pilot.start({nickname:'User'});const pending=pilot.request({action:'lyrics',id:song.id});await new Promise(setImmediate);const value=await pilot.request({action:'playerControl',control:'resume'});assert.equal(value.ok,true);release({lines:[{time:1,text:'Matched'}]});assert.equal((await pending).lines.length,1);}finally{await pilot.dispose();}
});
