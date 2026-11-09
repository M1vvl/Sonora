'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPlaybackState,normalize,MAX_BYTES}=require('../src/music/playback-state.cjs');
test('metadata resume survives a new store without persisting media, credentials or arbitrary URLs',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-resume-'));try{const song={id:'12',title:'歌曲',artist:'歌手',duration:200,coverURL:'https://p1.music.126.net/cover.jpg',audioURL:'https://m1.music.126.net/private.mp3',cookie:'secret',buffer:'PCM'};createPlaybackState(dir).save({song,queue:[song,song],position:68.5,mode:'shuffle',volume:.3,muted:true});const value=createPlaybackState(dir).get();assert.equal(value.position,68.5);assert.equal(value.queue.length,1);assert.equal(value.song.id,'12');assert.equal(value.mode,'shuffle');assert.equal(value.muted,true);const raw=fs.readFileSync(path.join(dir,'music-playback.json'),'utf8');assert.doesNotMatch(raw,/audioURL|private\.mp3|secret|cookie|PCM/);assert.deepEqual(fs.readdirSync(dir),['music-playback.json']);}finally{assert.equal(fs.realpathSync(path.dirname(dir)),fs.realpathSync(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});}
});
test('resume bounds queue count, metadata bytes, positions and display-only values',()=>{const queue=Array.from({length:1300},(_,n)=>({id:String(n+1),title:'名'.repeat(160),artist:'人'.repeat(160),album:'专'.repeat(160),duration:200}));const value=normalize({queue,song:queue[0],position:9999,volume:99,mode:'invalid'});assert(value.queue.length<=1000);assert(Buffer.byteLength(JSON.stringify(value))<=MAX_BYTES);assert.equal(value.position,200);assert.equal(value.volume,1);assert.equal(value.mode,'sequence');assert.equal(normalize({song:{id:'no',title:'bad'}}).song,null);});

test('Spotify resume retains its public page route while rejecting external URLs and unrelated provider fields',()=>{
 const song={id:'spotify:1234567890ABCDEFGHIJKL',title:'Song',artist:'Artist',duration:200,browserRoute:'/playlist/ABCDEFGHIJKLMNOPQRSTUV'};
 assert.equal(normalize({song,position:48}).song.browserRoute,song.browserRoute);
 for(const browserRoute of ['https://evil.test/','/settings','/search/query?token=secret'])assert.equal(normalize({song:{...song,browserRoute}}).song.browserRoute,undefined);
 assert.equal(normalize({song:{...song,id:'qq:track'}}).song.browserRoute,undefined);
});

test('invalid state shapes reset safely and cannot retain a position without a current song',()=>{for(const value of [null,false,'bad',42,[]])assert.deepEqual(normalize(value),normalize());assert.equal(normalize({song:null,queue:[],position:500}).position,0);});

test('a damaged or oversized metadata file falls back safely and is repaired by the next explicit save',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-resume-corrupt-')),file=path.join(dir,'music-playback.json');try{for(const input of ['{broken','null','[]',' '.repeat(MAX_BYTES+1)]){fs.writeFileSync(file,input);assert.deepEqual(createPlaybackState(dir).get(),normalize());}const state={song:{id:'123',title:'恢复',artist:'测试',duration:90},position:18.5};createPlaybackState(dir).save(state);assert.equal(createPlaybackState(dir).get().position,18.5);assert.deepEqual(fs.readdirSync(dir),['music-playback.json']);}finally{assert.equal(fs.realpathSync(path.dirname(dir)),fs.realpathSync(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});}
});
