'use strict';

// The Spotify page virtualizes its rows. Read visible metadata while advancing
// the actual viewport, and require a stable bottom before calling a list whole.
async function collectSpotify({navigate,read,scroll,reset,wait,check=()=>{}},route,options={}){
  let value=await navigate(route,options),unchanged=0,complete=false;
  const full=options.complete===true,steps=full?1600:16;
  if(full&&reset){await reset(route);await wait(180);check();value=await read();}
  const playlists=new Map((value.playlists||[]).map(item=>[item.id,item]));
  const songs=new Map((value.songs||[]).map(item=>[item.id,item]));
  for(let attempt=0;attempt<steps;attempt++){
    check();const before=playlists.size+songs.size,viewport=await scroll(route);await wait(250);check();value=await read();
    for(const item of route==='/collection/playlists'?value.library||[]:value.playlists||[])playlists.set(item.id,item);
    for(const item of value.songs||[])songs.set(item.id,item);
    if(songs.size>10000||playlists.size>1000)throw new Error('Spotify 歌单超过在线目录上限，请分成较小的歌单播放');
    unchanged=before===playlists.size+songs.size?unchanged+1:0;
    if(unchanged>=3&&(!full||viewport?.atBottom===true)){complete=true;break;}
    if(!full&&(unchanged>=3||songs.size>=500||playlists.size>=500))break;
  }
  if(full&&!complete)throw new Error(`Spotify 只读取到 ${songs.size} 首，网页尚未完整载入歌单，请重试`);
  return {...value,playlists:[...playlists.values()].slice(0,full?1000:500),songs:[...songs.values()].slice(0,full?10000:500),collectionComplete:complete};
}
module.exports={collectSpotify};
