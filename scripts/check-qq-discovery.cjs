"use strict";
// Read-only checks of public official QQ metadata. No account or audio data.
const { createProviderHTTP } = require("../src/music/providers/http.cjs");
const { mapPlaylist, mapSong } = require("../src/music/providers/qq.cjs");

async function check() {
  const network = createProviderHTTP({ domains: ["qq.com"], maxActive: 2 });
  const headers = { Referer: "https://y.qq.com/", "Content-Type": "application/json" };
  const specs = [
    { name: "QQ 编辑推荐歌单", module: "playlist.HotRecommendServer", method: "get_hot_recommend", param: { async: 1, cmd: 2 } },
    ...[[26, "热歌精选"], [27, "新歌首发"], [4, "流行指数"], [62, "飙升精选"], [28, "网络热歌"]].map(([topid, name]) => ({
      name, module: "musicToplist.ToplistInfoServer", method: "GetDetail", param: { topid, num: 30, offset: 0 },
    })),
  ];
  try {
    const checks = await Promise.all(specs.map(async spec => {
      try {
        const body = JSON.stringify({ comm: { ct: 24, cv: 0 }, req_0: { module: spec.module, method: spec.method, param: spec.param } });
        const value = JSON.parse(await network.requestText("https://u.y.qq.com/cgi-bin/musicu.fcg", { method: "POST", headers }, body));
        const rows = spec.module === "playlist.HotRecommendServer"
          ? (value.req_0?.data?.v_hot || []).map(mapPlaylist).filter(Boolean)
          : (value.req_0?.data?.songInfoList || []).map(mapSong).filter(Boolean);
        const covers = rows.filter(row => row.coverURL).length;
        return { name: spec.name, code: value.req_0?.code, count: rows.length, covers, ok: value.code === 0 && value.req_0?.code === 0 && rows.length > 0 && covers === rows.length };
      } catch (error) {
        return { name: spec.name, ok: false, error: error.message };
      }
    }));
    console.log(JSON.stringify({ source: "u.y.qq.com", checkedAt: new Date().toISOString(), checks }, null, 2));
    if (checks.some(result => !result.ok)) process.exitCode = 1;
  } finally {
    network.dispose();
  }
}
check().catch(error => { console.error(error.message); process.exitCode = 1; });
