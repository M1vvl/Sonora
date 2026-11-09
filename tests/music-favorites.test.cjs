'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const {confirmFavorite} = require('../src/music/providers/favorite-confirmation.cjs');
const {createProviderAdapter} = require('../src/music/providers/index.cjs');
const {createQQProvider} = require('../src/music/providers/qq.cjs');
const {createQishuiAdapter} = require('../src/music/providers/qishui.cjs');

test('favorite confirmation rejects incomplete states, confirms readback and toggles actual server state', async () => {
  let state = true, writes = 0;
  const value = await confirmFavorite({liked:true,toggle:true,read:async () => ({liked:state}),write:async desired => {writes++;state=desired;}});
  assert.equal(value,false);assert.equal(writes,1);
  await confirmFavorite({liked:false,read:async () => ({liked:state}),write:async () => {writes++;}});
  assert.equal(writes,1);
  await assert.rejects(confirmFavorite({liked:true,read:async () => ({}),write:async () => {writes++;}}),/完整收藏状态/);
  await assert.rejects(confirmFavorite({liked:true,read:async () => ({liked:false}),write:async () => {},wait:async () => {}}),error => error.code === 'LIKE_UNCONFIRMED');
  assert.equal(writes,1);
});

function qqFixture({rejectCode = 0} = {}) {
  let liked = false, writes = 0;
  const mid = '001AbCdEfGhI23';
  const api = createQQProvider({getCookie:async () => 'uin=123; qm_keyst=owned',requestText:async (value,options,body) => {
    let payload;
    if (options.responseType === 'buffer') {
      const bytes=Buffer.from(body,'base64'),key=Buffer.from([189,48,95,16,208,255,116,182,239,84,218,184,53,181,225,207]);
      const decipher=crypto.createDecipheriv('aes-128-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));
      payload=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString());
      assert.equal(new URL(value).hostname,'u6.y.qq.com');assert.equal(new URL(value).searchParams.get('encoding'),'ag-1');
      assert.equal(payload.req_0.param.dirId,201);assert.deepEqual(payload.req_0.param.v_songInfo,[{songId:700,songType:0}]);
      writes++;if (!rejectCode) liked=payload.req_0.method === 'AddSonglist';
      const response=Buffer.from(JSON.stringify({code:0,req_0:{code:rejectCode,data:{retCode:0}}}));
      const mask=[122,63,140,29,94,155,47,10,108,77,126,139,31,58,92,157,14,43,111,74,129];
      return response.map((byte,index) => byte ^ mask[index%mask.length]);
    }
    payload=JSON.parse(body);
    if (payload.req_0.method === 'IsSongFanByMid') return JSON.stringify({code:0,req_0:{code:0,data:{m_fan:{[mid]:liked}}}});
    if (payload.req_0.method === 'get_song_detail_yqq') return JSON.stringify({code:0,req_0:{code:0,data:{track_info:{mid,id:700,type:0}}}});
    throw new Error('Unexpected QQ request');
  }});
  return {api,id:'qq:'+mid,writes:() => writes};
}
test('QQ heart uses authenticated signed encrypted write, verified MID identity and actual readback', async () => {
  const f=qqFixture();assert.equal((await f.api.like({id:f.id,liked:true})).liked,true);
  assert.equal((await f.api.like({id:f.id,liked:true,toggle:true})).liked,false);
  assert.equal((await f.api.likeState({id:f.id})).liked,false);assert.equal(f.writes(),2);
});
test('QQ business rejection remains a failure even when nested retCode says zero', async () => {
  const f=qqFixture({rejectCode:80105});await assert.rejects(f.api.like({id:f.id,liked:true}),/80105/);assert.equal(f.writes(),1);
});

test('Kugou empty favorite library, authenticated add and file-ID removal all pass through the shared adapter', async () => {
  const hash='abcdef0123456789abcdef0123456789';let liked=false;const writes=[];
  const api=createProviderAdapter({provider:'kugou',getCookie:async () => 'userid=123; token=owned',requestText:async (value,options,body) => {
    const url=new URL(value),input=JSON.parse(body);
    if (url.pathname.endsWith('get_all_list')) return JSON.stringify({status:1,data:{info:[{listid:2,name:'我喜欢',count:liked?1:0}]}});
    if (url.pathname.endsWith('get_list_all_file')) return JSON.stringify({status:1,data:{count:liked?1:0,info:liked?[{hash,name:'Artist - Song',fileid:91,timelen:180000}]:null}});
    writes.push(input);assert.equal(options.headers['x-router'],'cloudlist.service.kugou.com');
    if (url.pathname.endsWith('add_song')) {assert.equal(input.data[0].hash,hash);assert.equal(input.data[0].timelen,180000);liked=true;}
    else if (url.pathname.endsWith('delete_songs')) {assert.equal(input.data[0].fileid,91);liked=false;}
    else throw new Error('Unexpected Kugou request');
    return JSON.stringify({status:1});
  }});
  try {
    const id='kugou:'+hash;
    assert.equal((await api.request({action:'like',id,liked:true,song:{title:'Song',duration:180}})).liked,true);
    assert.equal((await api.request({action:'like',id,liked:true,toggle:true})).liked,false);assert.equal(writes.length,2);
  } finally {api.dispose();}
});
test('a truncated favorite library cannot be treated as an unliked song', async () => {
  let writes=0;
  const favorites=require('../src/music/providers/kugou-favorites.cjs').createKugouFavorites({getCookie:async () => 'owned',core:{
    extractKugouAuth:() => ({playbackReady:true}),handleKugouUserPlaylists:async () => ({libraryReady:true,playlists:[{name:'我喜欢',listId:'2'}]}),
    handleKugouPlaylistTracks:async () => ({tracks:[{hash:'other'}],hasMore:true}),kugouH5GatewayRequest:async () => {writes++;},
  }});
  await assert.rejects(favorites.like({id:'kugou:abcdef0123456789abcdef0123456789',liked:true}),/尚未确认/);assert.equal(writes,0);
});

test('Qishui heart reaches PC collection routes and clears cached library before confirming both changes', async () => {
  let liked=false;const writes=[];
  const api=createQishuiAdapter({requestText:async (value,options,body) => {
    const url=new URL(value);
    if (options?.method === 'POST') {
      assert.match(url.pathname,/^\/luna\/pc\/me\/collection\/media(?:\/delete)?$/);
      assert.deepEqual(JSON.parse(body),{media:[{type:'track',id:'777'}],scene:''});
      liked=!url.pathname.endsWith('/delete');writes.push(url.pathname);return JSON.stringify({status_code:0});
    }
    if (url.pathname.endsWith('/me')) return JSON.stringify({data:{my_info:{id:'user',nickname:'Owned'}}});
    if (url.pathname.endsWith('/user/playlist')) return JSON.stringify({data:{playlists:[{id:'liked-list',name:'我喜欢的音乐',track_count:liked?1:0,type:'playlist'}]}});
    if (url.pathname.endsWith('/playlist/detail')) return JSON.stringify({data:{playlist:{id:'liked-list',name:'我喜欢的音乐',track_count:liked?1:0},tracks:liked?[{id:'777',name:'Song',duration_ms:180000}]:[],has_more:false}});
    return JSON.stringify({data:{tracks:[],has_more:false}});
  },factories:{createStore:() => ({read:() => ({cookie:'sessionid=owned'})})}});
  try {
    assert.equal((await api.request({action:'like',id:'qishui:777',liked:true})).liked,true);
    assert.equal((await api.request({action:'like',id:'qishui:777',liked:true,toggle:true})).liked,false);assert.equal(writes.length,2);
  } finally {await api.dispose();}
});
test('Qishui account cancellation during a read prevents any later write', async () => {
  let current=true,release,writes=0;
  const favorites=require('../src/music/providers/qishui-favorites.cjs').createQishuiFavorites({core:{
    invalidateQishuiLibraryCaches(){},fetchQishuiWebLibrary:() => new Promise(resolve => {release=() => resolve({likedTracks:[],likedCard:{id:'liked'}});}),
    fetchQishuiWebPlaylistTracks:async () => ({tracks:[],hasMore:false}),qishuiPcPostJson:async () => {writes++;},
  }});
  const pending=favorites.like({id:'qishui:777',liked:true},'owned',{isCurrent:() => current});
  current=false;release();await assert.rejects(pending,/已取消/);assert.equal(writes,0);
});
