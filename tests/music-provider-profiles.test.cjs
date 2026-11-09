'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createKugouCore} = require('../src/music/providers/kugou-core.cjs');
const {createQishuiAdapter} = require('../src/music/providers/qishui.cjs');

test('Kugou profile uses the validated account creator and decodes its avatar URL', async () => {
  const ownAvatar = 'https://imge.kugou.com/avatar/owned.jpg';
  const core = createKugouCore({requestText: async target => {
    if (new URL(target).pathname.includes('get_all_list')) return JSON.stringify({status:1,data:{info:{collect:[
      {listid:1,userid:999,nickname:'Other author',create_user_pic:'https://imge.kugou.com/avatar/other.jpg'},
      {listid:2,userid:123,nickname:'Owned account',create_user_pic:encodeURIComponent(ownAvatar)}
    ]}}});
    return JSON.stringify({status:1,data:{}});
  }});
  const value = await core.getKugouLoginInfo('userid=123; token=fixture-token');
  assert.equal(value.nickname, 'Owned account');
  assert.equal(value.avatar, ownAvatar);
  core.clearKugouSessionCaches();
});

test('Kugou collection cover and another creator cannot impersonate the current account', async () => {
  const core = createKugouCore({requestText: async target => {
    if (new URL(target).pathname.includes('get_all_list')) return JSON.stringify({status:1,data:{info:{collect:[
      {listid:1,userid:999,nickname:'Other author',create_user_pic:'https://imge.kugou.com/avatar/other.jpg'},
      {listid:2,userid:123,name:'Owned list',pic:'https://imge.kugou.com/playlist.jpg'}
    ]}}});
    return JSON.stringify({status:1,data:{}});
  }});
  const value = await core.getKugouLoginInfo('userid=123; token=fixture-token');
  assert.notEqual(value.nickname, 'Other author');
  assert.equal(value.avatar, '');
  core.clearKugouSessionCaches();
});

test('Qishui profile supports the official alternate user shape and preserves signed avatar URLs', async () => {
  const avatar = 'https://p26.douyinpic.com/avatar/owned.jpg?signature=fixture&expires=123';
  let feedCalls = 0;
  const adapter = createQishuiAdapter({
    network:{cookies:{get:async () => [{domain:'.qishui.com',name:'sessionid',value:'owned-fixture'}]}},
    requestText:async target => {
      const url = new URL(target);
      if (url.pathname === '/luna/pc/me') return JSON.stringify({data:{my_info:{},user_info:{id:'owned-user',nickname:'Owned account',avatar_medium:{url_list:[avatar]}}}});
      if (url.pathname === '/luna/feed/song-tab') {
        feedCalls++;
        return JSON.stringify({data:{tracks:[{id:'456',name:'Recommended song',duration_ms:180000}]}});
      }
      if (url.pathname === '/luna/pc/user/playlist') return JSON.stringify({data:{playlists:[{id:'123',name:'Owned playlist',track_count:1,type:'playlist'}]}});
      return JSON.stringify({status_code:0,data:{}});
    },
    factories:{createStore:() => ({read:() => ({}),save(){},clear(){}})}
  });
  try {
    const identity = await adapter.request({action:'profile'});
    assert.equal(identity.profile.nickname, 'Owned account');
    assert.equal(identity.profile.avatarURL, avatar);
    const home = await adapter.request({action:'home'});
    assert.equal(home.songs[0].id, 'qishui:456');
    assert.deepEqual(home.discoveryModes, ['daily']);
    assert(home.playlists.some(value => value.id === 'qishui:123'));
    const discovery = await adapter.request({action:'discovery',mode:'daily'});
    assert.equal(discovery.songs[0].id, home.songs[0].id);
    assert.equal(feedCalls, 1);
  } finally {await adapter.dispose();}
});
