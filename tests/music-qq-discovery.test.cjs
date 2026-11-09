"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createQQProvider, mapPlaylist } = require("../src/music/providers/qq.cjs");

const mid = "001AbCdEfGhI23";
const track = { mid, name: "QQ chart song", singer: [{ name: "QQ artist" }], album: { mid: "002AbCdEfGhI23" }, interval: 200 };
function fixture(overrides = {}) {
  const calls = [];
  const client = createQQProvider({
    getCookie: async () => overrides.cookie || "uin=o12345; qm_keyst=private-fixture-ticket",
    requestText: async (url, options, body) => {
      const payload = body ? JSON.parse(body) : null;
      calls.push({ url, payload });
      if (overrides.request) {
        const result = await overrides.request(url, payload);
        if (result !== undefined) return JSON.stringify(result);
      }
      if (payload?.req_0?.module === "playlist.HotRecommendServer")
        return JSON.stringify({ code: 0, req_0: { code: 0, data: { v_hot: [{ content_id: 8075336924, title: "QQ 编辑推荐", cover: "http://qpic.y.qq.com/music_cover/fixture/300", listen_num: 90000 }] } } });
      if (payload?.req_0?.module === "musicToplist.ToplistInfoServer")
        return JSON.stringify({ code: 0, req_0: { code: 0, data: { songInfoList: [track] } } });
      if (url.includes("fcg_get_profile_homepage"))
        return JSON.stringify({ code: 0, data: { creator: { nick: "Verified QQ" } } });
      if (payload?.req_0?.module === "music.srfDissInfo.DissInfo")
        return JSON.stringify({ code: 0, req_0: { code: 0, data: { songlist: [track], total_song_num: 8 } } });
      throw new Error("Unexpected QQ fixture request");
    },
  });
  return { client, calls };
}

test("QQ home reads official recommendations and charts instead of taking the first personal playlist", async () => {
  const { client, calls } = fixture();
  const home = await client.home();
  assert.equal(home.playlists[0].id, "qq:8075336924");
  assert.equal(home.playlists[0].coverURL, "https://qpic.y.qq.com/music_cover/fixture/300");
  assert.equal(home.songs[0].id, "qq:" + mid);
  assert.equal(home.cards[0].id, home.songs[0].id);
  assert.equal(home.discoveryModes.length, 5);
  assert.equal(home.discoveryLabels.radar, "新歌首发");
  assert.equal(home.recommendationMode, "public");
  assert.equal(calls.length, 2);
  assert(!JSON.stringify(home).includes("private-fixture-ticket"));
});

test("QQ recommendation feed failure uses the official public directory and preserves chart songs", async () => {
  const { client } = fixture({ request(url, payload) {
    if (payload?.req_0?.module === "playlist.HotRecommendServer") return { code: 0, req_0: { code: 500003 } };
    if (url.includes("fcg_get_diss_by_tag")) return { code: 0, data: { list: [{ dissid: "1234567890", dissname: "官方公共歌单", imgurl: "https://qpic.y.qq.com/music_cover/public/300" }] } };
  } });
  const home = await client.home();
  assert.equal(home.playlists[0].id, "qq:1234567890");
  assert.equal(home.songs[0].id, "qq:" + mid);
});

test("QQ discovery modes use distinct real chart identities and reject unsupported algorithms", async () => {
  const { client, calls } = fixture();
  for (const mode of ["daily", "radar", "fm", "heart", "similar"]) {
    const page = await client.discovery({ mode });
    assert.equal(page.provider, "qq");
    assert.equal(page.songs[0].id, "qq:" + mid);
    assert(page.label.startsWith("QQ 音乐"));
  }
  assert.deepEqual(calls.map(call => call.payload.req_0.param.topid), [26, 27, 4, 62, 28]);
  await assert.rejects(client.discovery({ mode: "imaginary" }), /尚未接通/);
});

test("verified QQ account supplies a safe official avatar and its liked playlist cover", async () => {
  const { client } = fixture({ request(url) {
    if (url.includes("user_created_diss")) return { code: 0, data: { disslist: [{ dirid: 201, dissid: 0, diss_name: "我喜欢" }, { dissid: "18", diss_name: "QZone背景音乐" }] } };
    if (url.includes("profile_order_asset")) return { code: 0, data: { cdlist: [] } };
  } });
  const profile = await client.profile();
  assert.equal(profile.profile.avatarURL, "https://q1.qlogo.cn/g?b=qq&nk=12345&s=100");
  const library = await client.playlists();
  assert.equal(library.playlists.length, 1);
  assert.equal(library.playlists[0].id, "qq:liked");
  assert.equal(library.playlists[0].trackCount, 8);
  assert.match(library.playlists[0].coverURL, /^https:\/\/y\.gtimg\.cn\//);
  assert.equal(mapPlaylist({ content_id: "5", title: "Unsafe image", cover: "https://attacker.invalid/picture" }).coverURL, "");
});

test("QQ Music WeChat identities never borrow an unrelated QQ number avatar", async () => {
  const { client } = fixture({ cookie: "uin=o12345; wxuin=o98765; login_type=2; wxopenid=wechat-fixture; qm_keyst=private-fixture-ticket" });
  const value = await client.profile();
  assert.equal(value.profile.userId, "98765");
  assert.equal(value.profile.avatarURL, "");
});
