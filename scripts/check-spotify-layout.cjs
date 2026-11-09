'use strict';
// Real Chromium/CSS regression for missing Spotify covers. Synthetic metadata,
// isolated profile, no account, mouse operation or external catalog requests.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/v0.3.36-runtime/layout');
if(!process.versions.electron){
 fs.mkdirSync(out,{recursive:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=require('node:child_process').spawn(require('electron'),[__filename],{cwd:root,env,windowsHide:true,stdio:'inherit'});
 const timer=setTimeout(()=>child.kill(),30000);child.on('exit',code=>{clearTimeout(timer);process.exitCode=code??1;});
}else run().catch(error=>{console.error(error);require('electron').app.exit(1);});
async function run(){
 const {app,BrowserWindow}=require('electron');app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();await app.whenReady();
 const href=file=>'file:///'+path.join(root,'ui',file).replaceAll('\\','/');
 const html='<!doctype html><meta charset="UTF-8">'+['music/music.css','music/cards.css'].map(file=>'<link rel="stylesheet" href="'+href(file)+'">').join('')+'<style>*{box-sizing:border-box}body{margin:0;background:#002fa7;color:white}#mount{height:820px;width:1140px;padding:20px;--surface:#102b60;--surface-raised:#183670;--text:#fff;--muted:#b8c8dc;--border:#657da0;--border-strong:#8198b9;--bg:#002fa7}</style><div id="mount" class="music-view"><div class="music-topbar"><form></form></div><div class="music-body"><section></section><div class="music-player-host"></div></div></div>'+['cover-loading.js','horizontal-scroll.js','music/music-workspace.js'].map(file=>'<script src="'+href(file)+'"></script>').join('');
 const page=path.join(out,'fixture.html');fs.writeFileSync(page,html);
 const window=new BrowserWindow({show:false,width:1180,height:850,webPreferences:{contextIsolation:true,sandbox:true}});
 try{
  await window.loadFile(page);
  const result=await window.webContents.executeJavaScript(`(async()=>{
   const song={id:'spotify:1234567890ABCDEFGHIJKL',title:'Missing-cover song',artist:'Artist',source:'spotify'};
   const workspace=PulseMusicWorkspace.create({root:document.querySelector('section'),searchRoot:document.querySelector('form'),api:async action=>action==='home'?{provider:'spotify',songs:[song],playlists:[{id:'spotify:ABCDEFGHIJKLMNOPQRSTUV',title:'Missing-cover playlist'}],cards:[song],discoveryModes:[]}:{},onPlay:value=>window.clicked=value.id});
   await workspace.activate();await new Promise(resolve=>setTimeout(resolve,150));
   const art=document.querySelector('.music-song-cover'),placeholder=art.querySelector('.music-cover-fallback');
   const a=art.getBoundingClientRect(),p=placeholder.getBoundingClientRect();
   const row=document.querySelector('[data-music-song]'),r=row.getBoundingClientRect();
   const hit=document.elementFromPoint(r.right-12,r.top+r.height/2);row.click();
   const checks={missingArtworkContained:p.width<=a.width+1&&p.height<=a.height+1&&p.left>=a.left-1&&p.top>=a.top-1,playlistVisible:document.querySelector('.music-playlist').getBoundingClientRect().width>100,songClickable:!!hit?.closest('[data-music-song]')&&window.clicked===song.id,headingVisible:document.querySelector('.music-section-heading').getBoundingClientRect().height>10};
   workspace.dispose();return {checks,rect:{width:p.width,height:p.height}};
  })()`);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  if(Object.values(result.checks).some(value=>!value))throw new Error('Spotify layout regression');
 }finally{window.destroy();app.quit();}
}
