'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createProviderAdapter,kugouSong}=require('../src/music/providers/index.cjs');
const {credentials,createQQProvider}=require('../src/music/providers/qq.cjs');
const mid='001AbCdEfGhI23',media='002AbCdEfGhI23',hash='abcdef0123456789abcdef0123456789';
function qqFixture(){
  const calls=[];let finish=null;
  const api=createProviderAdapter({provider:'qq',getCookie:async()=> 'uin=o12345; qm_keyst=private-ticket',requestText:async(value,options,body)=>{
    calls.push({value,options,body});const url=new URL(value);
    if(url.pathname.includes('profile_homepage'))return JSON.stringify({code:0,data:{creator:{nick:'Owned account',headpic:'https://y.gtimg.cn/avatar.jpg'}}});
    if(url.pathname.includes('user_created_diss'))return JSON.stringify({code:0,data:{disslist:[{dissid:'17',diss_name:'My playlist',song_cnt:1}]}});
    if(url.pathname.includes('profile_order_asset'))return JSON.stringify({code:0,data:{cdlist:[]}});
    if(url.pathname.includes('getcdinfo'))return JSON.stringify({code:0,cdlist:[{songnum:1,songlist:[{mid,name:'Song',singer:[{name:'Artist'}],album:{mid:media,name:'Album'},interval:180,file:{media_mid:media}}]}]});
    const payload=JSON.parse(body||'{}');
    if(payload.req_0?.module==='music.srfDissInfo.DissInfo')return JSON.stringify({code:0,req_0:{code:0,data:{songlist:[],total_song_num:0}}});
    if(payload.req?.module==='music.search.SearchCgiService')return JSON.stringify({code:0,req:{code:0,data:{body:{item_song:[{mid,name:'Song',singer:[{name:'Artist'}],interval:180,file:{media_mid:media}}]}}}});
    if(payload.req_0?.module==='vkey.GetVkeyServer')return JSON.stringify({code:0,req_0:{code:0,data:{sip:['https://ws.stream.qqmusic.qq.com/'],midurlinfo:[{filename:'M800'+media+'.mp3',purl:'M800'+media+'.mp3?vkey=owned-authorized-url'}]}}});
    if(payload.lyric)return JSON.stringify({code:0,lyric:{code:0,data:{lyric:Buffer.from('[00:01]Hello').toString('base64')}}});
    if(finish)return finish();throw new Error('Unmocked request '+url.pathname);
  }});
  return {api,calls};
}
test('QQ account -> own playlists -> songs -> authorized stream share prefixed identities and real delivered quality',async()=>{
  const f=qqFixture();try{
    const profile=await f.api.request({action:'profile'});assert.equal(profile.profile.nickname,'Owned account');assert(profile.apiConnected);assert(!JSON.stringify(profile).includes('private-ticket'));
    const options=await f.api.request({action:'playbackOptions'});assert.equal(options.qualityOptions.length,4);assert.equal(options.apiConnected,true);
    const searched=await f.api.request({action:'search',query:'Song Artist',limit:20});assert.equal(searched.songs[0].id,'qq:'+mid);assert(searched.songs.length<=30);
    const library=await f.api.request({action:'playlists'});assert.deepEqual(library.playlists.map(value=>value.id),['qq:liked','qq:17']);
    const page=await f.api.request({action:'playlist',id:'qq:17'});assert.equal(page.songs[0].id,'qq:'+mid);assert.equal(page.songs[0].duration,180);assert.equal(page.songs[0].mediaMid,media);
    const played=await f.api.request({action:'play',id:'qq:'+mid,quality:'hires'});assert.equal(played.quality,'exhigh');assert.equal(played.requestedQuality,'hires');assert.match(played.url,/ws\.stream\.qqmusic\.qq\.com/);assert.deepEqual(played.qualityOptions.map(value=>value.id),['exhigh']);
    const lyric=await f.api.request({action:'lyrics',id:'qq:'+mid});assert.equal(lyric.lines[0].text,'Hello');
    assert(f.calls.every(value=>value.options.headers.Cookie==='uin=o12345; qm_keyst=private-ticket'));
    await assert.rejects(f.api.request({action:'play',id:'qq:../../bad'}),/无效/);
  }finally{f.api.dispose();}
});
test('QQ resolver tries current signed RPC and media/song identities, while quality menus survive switching down',async()=>{
  const calls=[];
  const api=createQQProvider({getCookie:async()=> 'uin=123; qm_keyst=owned',requestText:async(url,_options,body)=>{
    const input=JSON.parse(body);calls.push({url,input});
    if(input.req_0.module==='vkey.GetVkeyServer')return JSON.stringify({code:0,req_0:{code:0,data:{midurlinfo:[{result:104003}]}}});
    return JSON.stringify({code:0,req_0:{code:0,data:{midurlinfo:[
      {filename:'F000'+media+'.flac',purl:'F000'+media+'.flac?vkey=authorized'},
      {filename:'C400'+mid+'.m4a',purl:'C400'+mid+'.m4a?vkey=authorized'}]}}});
  }});
  const payload={id:'qq:'+mid,song:{title:'Song',mediaMid:media},quality:'standard'},played=await api.play(payload);
  assert.equal(played.quality,'standard');assert.equal(played.qualityLabel,'AAC/M4A');assert.deepEqual(played.qualityOptions.map(value=>value.id),['lossless','standard']);
  assert.match(calls[1].url,/musics\.fcg\?sign=/);assert.equal(calls[1].input.req_0.module,'music.vkey.GetEVkey');
  assert(calls[0].input.req_0.param.filename.includes('C400'+mid+'.m4a'));assert(calls[0].input.req_0.param.filename.includes('F000'+media+'.flac'));
  const options=await api.playbackOptions(payload);assert.deepEqual(options.qualityOptions.map(value=>value.id),['lossless','standard']);assert(!JSON.stringify(options).includes('authorized'));
  assert.equal(options.qualityOptions.find(value=>value.id==='standard').label,'AAC/M4A');
});
test('QQ empty official result preserves actual rejection code rather than fabricating a stream',async()=>{
  const api=createQQProvider({getCookie:async()=> 'uin=123; qm_keyst=owned',requestText:async()=>JSON.stringify({code:0,req_0:{code:0,data:{midurlinfo:[{result:104003}]}}})});
  await assert.rejects(api.play({id:'qq:'+mid,song:{title:'Song',mediaMid:media}}),error=>error.code==='QQ_PLAYBACK_NOT_AUTHORIZED'&&/104003/.test(error.message));
  const options=await api.playbackOptions({id:'qq:'+mid,song:{title:'Song',mediaMid:media}});
  assert.deepEqual(options.qualityOptions,[]);
  assert.equal(options.unavailableCode,'QQ_PLAYBACK_NOT_AUTHORIZED');
  assert.match(options.unavailableMessage,/104003/);
});
test('QQ authorization refusal survives an empty signed fallback',async()=>{
  const api=createQQProvider({getCookie:async()=> 'uin=123; qm_keyst=owned',requestText:async(_url,_options,body)=>{
    const input=JSON.parse(body);
    return JSON.stringify({code:0,req_0:{code:0,data:{midurlinfo:input.req_0.module==='vkey.GetVkeyServer'?[{result:104003}]:[]}}});
  }});
  const options=await api.playbackOptions({id:'qq:'+mid,song:{title:'Song',mediaMid:media}});
  assert.deepEqual(options.qualityOptions,[]);
  assert.equal(options.unavailableCode,'QQ_PLAYBACK_NOT_AUTHORIZED');
});
test('QQ quality probe preserves unrelated resolver failures',async()=>{
  const api=createQQProvider({getCookie:async()=> 'uin=123; qm_keyst=owned',requestText:async()=>{throw new Error('transport failed');}});
  await assert.rejects(api.playbackOptions({id:'qq:'+mid,song:{title:'Song',mediaMid:media}}),/transport failed/);
});
test('Kugou camelCase official bitrate and extension describe delivered MP3 instead of requested lossless',async()=>{
  const api=createProviderAdapter({provider:'kugou',getCookie:async()=> 'userid=123; token=owned; nickname=Fixture',requestText:async(value)=>{
    if(new URL(value).pathname.includes('/v5/url'))return JSON.stringify({status:1,url:'https://fsandroid.tx.kugou.com/fixture.mp3',bitRate:128000,extName:'mp3'});
    return JSON.stringify({status:1,data:{vip_type:0}});
  }});
  try{const result=await api.request({action:'play',id:'kugou:'+hash,song:{title:'Song'},quality:'lossless'});assert.equal(result.quality,'standard');assert.equal(result.bitrate,128000);assert.deepEqual(result.qualityOptions.map(value=>value.id),['standard']);}finally{api.dispose();}
});
test('Kugou exposes source-supported master quality only to verified SVIP and labels the delivered format',async()=>{
  let requested='',master=true;
  const api=createProviderAdapter({provider:'kugou',getCookie:async()=> 'userid=123; token=owned; nickname=Fixture',requestText:async(value)=>{
    const url=new URL(value);
    if(url.pathname.includes('/v5/url')){
      requested=url.searchParams.get('quality');
      return JSON.stringify({status:1,data:master
        ? {url:'https://fsandroid.tx.kugou.com/master.flac',quality:'viper_tape',extName:'flac',bitRate:1900000}
        : {url:'https://fsandroid.tx.kugou.com/standard.mp3',extName:'mp3',bitRate:128000}});
    }
    return JSON.stringify({status:1,data:{vip_type:1,svip_type:1}});
  }});
  try{
    const options=await api.request({action:'playbackOptions'});
    assert.equal(options.qualityOptions[0].id,'jymaster');
    const result=await api.request({action:'play',id:'kugou:'+hash,song:{title:'Song'},quality:'jymaster'});
    assert.equal(requested,'viper_tape');
    assert.equal(result.quality,'jymaster');
    assert.equal(result.qualityLabel,'蝰蛇母带');
    master=false;
    const downgraded=await api.request({action:'play',id:'kugou:'+hash,song:{title:'Song'},quality:'hires'});
    assert.equal(requested,'hires');
    assert.equal(downgraded.quality,'standard');
    assert.equal(downgraded.degraded,true);
  }finally{api.dispose();}
});
test('a late platform request cannot verify an account after logout/cancel and unsupported API adapters report actual setup requirements',async()=>{
  let finish;
  const api=createProviderAdapter({provider:'qq',getCookie:async()=> 'uin=123; qm_keyst=owned',requestText:()=>new Promise(resolve=>finish=resolve)});
  const job=api.request({action:'profile'});await new Promise(resolve=>setImmediate(resolve));api.cancel();finish(JSON.stringify({code:0,data:{creator:{nick:'Late'}}}));await assert.rejects(job,/取消/);assert.equal(api.getProfile(),null);api.dispose();
  assert.throws(()=>createProviderAdapter({provider:'spotify'}),/Client ID/);assert.throws(()=>createProviderAdapter({provider:'unknown'}),/不支持/);assert.throws(()=>createProviderAdapter({provider:'qishui'}),/SDK/);
  assert.equal(credentials('wxopenid=wx; wxuin=o456; uin=o123; qm_keyst=key').uin,'456');
});
test('ported Kugou core reads server-validated account library and one bounded page without exposing its cookie',async()=>{
  const requests=[];
  const api=createProviderAdapter({provider:'kugou',getCookie:async()=> 'userid=123; token=owned-private-key; nickname=Fixture',requestText:async(value,options,body)=>{
    const url=new URL(value);requests.push({url,options,body});
    if(url.pathname.includes('song_search'))return JSON.stringify({status:1,data:{lists:[{FileHash:hash,SongName:'A song',Duration:180,SingerName:'Artist',AlbumID:7}]}});
    if(url.pathname.includes('get_all_list'))return JSON.stringify({status:1,data:{info:{self:[{listid:5,name:'My songs',count:1,userid:123,nickname:'Fixture'}]}}});
    if(url.pathname.includes('get_list_all_file'))return JSON.stringify({status:1,data:{count:1,info:[{hash,name:'A song',Duration:180,SingerName:'Artist',album_id:7,mixsongid:8}]}});
    if(url.pathname.includes('/v5/url'))return JSON.stringify({status:1,data:{url:'https://fsios.kugou.com/fixture.mp3',bitrate:128000}});
    return JSON.stringify({status:1,data:{vip_type:0}});
  }});
  try{
    const profile=await api.request({action:'profile'});assert(profile.apiConnected);assert.equal(profile.profile.nickname,'Fixture');assert(!JSON.stringify(profile).includes('private-key'));
    const searched=await api.request({action:'search',query:'A song Artist',limit:20});assert.equal(searched.songs[0].id,'kugou:'+hash);assert(searched.songs.length<=20);
    const library=await api.request({action:'playlists'});assert.equal(library.playlists[0].id,'kugou:5');
    const page=await api.request({action:'playlist',id:'kugou:5',limit:50});assert.equal(page.songs[0].id,'kugou:'+hash);assert.equal(page.songs[0].albumId,'7');assert(page.songs.length<=50);
    const played=await api.request({action:'play',id:page.songs[0].id,quality:'standard'});assert.equal(played.quality,'standard');assert.equal(played.trial,false);assert.match(played.url,/kugou\.com/);
    assert(requests.some(value=>value.url.pathname.includes('get_list_all_file')&&JSON.parse(value.body).pagesize<=50));
    assert.equal(kugouSong({id:'https://attacker.invalid',name:'Bad'}),null);
  }finally{api.dispose();}
});
