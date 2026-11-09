"use strict";
// Protocol and field mappings adapted from MineRadio server.js (GPL-3.0-only).
// No external credential file, unlock service, or paid-rights bypass is used.
const crypto = require("node:crypto");
const QUALITY_OPTIONS = Object.freeze(
  [
    {
      id: "hires",
      label: "Hi-Res FLAC",
      shortLabel: "Hi-Res",
      prefix: "RS01",
      ext: ".flac",
    },
    {
      id: "lossless",
      label: "无损 FLAC",
      shortLabel: "SQ",
      prefix: "F000",
      ext: ".flac",
    },
    {
      id: "exhigh",
      label: "320k MP3",
      shortLabel: "HQ",
      prefix: "M800",
      ext: ".mp3",
    },
    {
      id: "standard",
      label: "128k MP3",
      shortLabel: "标准",
      prefix: "M500",
      ext: ".mp3",
    },
  ].map(Object.freeze),
);
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const text = (value, max = 160) =>
  String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, max);
const songId = (value) =>
  /^[A-Za-z0-9]{8,24}$/.test(String(value)) ? String(value) : null;
const DISCOVERY = Object.freeze({
  daily: { topId: 26, label: "热歌精选" },
  radar: { topId: 27, label: "新歌首发" },
  fm: { topId: 4, label: "流行指数" },
  heart: { topId: 62, label: "飙升精选" },
  similar: { topId: 28, label: "网络热歌" },
});
function image(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    return require("../media-policy.cjs").imageURL(url.href)?.href || "";
  } catch {
    return "";
  }
}
function credentials(cookie) {
  const values = Object.fromEntries(
    String(cookie || "")
      .split(";")
      .map((part) => {
        const at = part.indexOf("=");
        return at < 0
          ? []
          : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
      })
      .filter((pair) => pair.length === 2),
  );
  const wechat = values.wxopenid || values.login_type === "2";
  const uin = String(
    wechat
      ? values.wxuin || values.uin || values.p_uin
      : values.uin || values.qqmusic_uin || values.wxuin || values.p_uin || "",
  )
    .replace(/\D/g, "")
    .replace(/^0+/, "");
  return {
    uin,
    loginType: wechat ? "wechat" : "qq",
    key:
      values.qm_keyst ||
      values.qqmusic_key ||
      values.music_key ||
      values.wxskey ||
      "",
  };
}
function mapSong(raw) {
  const track = raw?.track_info || raw?.songInfo || raw || {},
    mid = songId(track.mid || track.songmid),
    album = track.album || {};
  if (!mid || !text(track.name || track.songname)) return null;
  const albumMid = songId(album.mid || track.albummid),
    mediaMid = songId(
      track.file?.media_mid || track.strMediaMid || track.media_mid,
    );
  return {
    id: "qq:" + mid,
    providerId: mid,
    provider: "qq",
    source: "qq",
    title: text(track.name || track.songname),
    artist:
      text(
        (track.singer || track.singers || [])
          .slice(0, 8)
          .map((value) => text(value.name, 80))
          .join(" / "),
      ) || "未知歌手",
    album: text(album.name || track.albumname),
    duration: Math.min(86400, Math.max(0, Number(track.interval) || 0)),
    ...(albumMid
      ? {
          coverURL:
            "https://y.gtimg.cn/music/photo_new/T002R300x300M000" +
            albumMid +
            ".jpg",
        }
      : {}),
    ...(mediaMid ? { mediaMid } : {}),
  };
}
function mapPlaylist(value) {
  const id = String(
    value?.dissid || value?.content_id || value?.tid || value?.dirid || value?.id || "",
  );
  if (
    !/^\d{1,20}$/.test(id) ||
    !text(value.diss_name || value.dissname || value.name || value.title)
  )
    return null;
  return {
    id: "qq:" + id,
    title: text(value.diss_name || value.dissname || value.name || value.title),
    source: "qq",
    provider: "qq",
    coverURL: image(
      value.diss_cover || value.logo || value.picurl || value.imgurl || value.cover,
    ),
    playCount: Math.max(
      0, Number(value.listen_num || value.listennum || value.visitnum) || 0,
    ),
    trackCount: Math.max(
      0,
      Number(value.song_cnt || value.songnum || value.total_song_num) || 0,
    ),
  };
}
function qqSearchSign(text) {
  const hash = crypto.createHash("sha1").update(text).digest("hex");
  const part1 = [23, 14, 6, 36, 16, 40, 7, 19]
    .map((index) => hash[index])
    .join("");
  const part2 = [16, 1, 32, 12, 19, 27, 8, 5]
    .map((index) => hash[index])
    .join("");
  const scramble = [
    89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133,
    143, 161, 121, 179,
  ];
  const bytes = scramble.map(
    (value, index) =>
      value ^ parseInt(hash.slice(index * 2, index * 2 + 2), 16),
  );
  const middle = Buffer.from(bytes)
    .toString("base64")
    .replace(/[\\/+=]/g, "");
  return `zzc${part1}${middle}${part2}`.toLowerCase();
}

function createQQProvider({ requestText, getCookie } = {}) {
  let likedPreview = null;
  async function context() {
    const cookie = await getCookie(),
      auth = credentials(cookie);
    if (!auth.uin || !auth.key)
      throw new Error("请先在官方页面完成 QQ 音乐扫码授权");
    return { cookie, ...auth };
  }
  function parse(raw) {
    return JSON.parse(
      String(raw).replace(/^\s*callback\(([\s\S]*)\);?\s*$/, "$1"),
    );
  }
  async function get(endpoint, params, auth) {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(params))
      if (value !== undefined) url.searchParams.set(key, String(value));
    return parse(
      await requestText(url.href, {
        headers: {
          Referer: "https://y.qq.com/",
          "User-Agent": USER_AGENT,
          Cookie: auth.cookie,
        },
      }),
    );
  }
  async function music(payload, auth, {signed = false} = {}) {
    const body = JSON.stringify(payload);
    return parse(
      await requestText(
        signed ? "https://u.y.qq.com/cgi-bin/musics.fcg?sign=" + qqSearchSign(body) : "https://u.y.qq.com/cgi-bin/musicu.fcg",
        {
          method: "POST",
          headers: {
            Referer: "https://y.qq.com/",
            "User-Agent": USER_AGENT,
            Cookie: auth.cookie,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        body,
      ),
    );
  }
  async function favoriteRequest({id,liked,toggle = false} = {}, readOnly = false) {
    const mid = songId(String(id || '').replace(/^qq:/,''));
    if (!mid) throw new Error('无效的 QQ 歌曲');
    const auth = await context();
    const pairs = Object.fromEntries(auth.cookie.split(';').map(pair => {
      const at = pair.indexOf('=');return [pair.slice(0,at).trim(),pair.slice(at+1).trim()];
    }));
    const token = value => {
      let hash = 5381;
      for (const char of value) hash = (hash + (hash << 5) + char.charCodeAt(0)) | 0;
      return hash & 0x7fffffff;
    };
    const comm = {ct:24,cv:4747474,uin:auth.uin,authst:auth.key,platform:'yqq.json',
      g_tk:token(pairs.skey || pairs.qqmusic_key || pairs.qm_keyst || ''),
      g_tk_new_20200303:token(pairs.qqmusic_key || pairs.p_skey || pairs.skey || pairs.p_lskey || pairs.lskey || pairs.qm_keyst || ''),
      inCharset:'utf-8',outCharset:'utf-8',notice:0,needNewCode:1};
    async function call(module,method,param,write = false) {
      const payload = {comm,req_0:{module,method,param}};
      const response = write
        ? await require('./qq-favorite-transport.cjs').writeFavorite(requestText,payload,{Cookie:auth.cookie,Referer:'https://y.qq.com/','User-Agent':USER_AGENT})
        : await music(payload,auth);
      const block = response?.req_0, data = block?.data;
      const codes = [response?.code,block?.code,data?.code ?? 0,data?.subcode ?? 0,...(write ? [data?.retCode] : [])];
      if (!data || codes.some(code => code === undefined || Number(code) !== 0)) {
        const code = codes.find(code => code === undefined || Number(code) !== 0);
        throw new Error('QQ 音乐未确认收藏操作（'+(code ?? '响应不完整')+'），请刷新后重试');
      }
      return data;
    }
    const read = async () => {
      const value = await call('music.musicasset.SongFavRead','IsSongFanByMid',{v_songMid:[mid]});
      return {liked:value.m_fan?.[mid]};
    };
    if (readOnly) {
      const state = await read();
      if (typeof state.liked !== 'boolean') throw new Error('QQ 音乐未返回完整收藏状态');
      return {provider:'qq',id:'qq:'+mid,liked:state.liked};
    }
    const actual = await require('./favorite-confirmation.cjs').confirmFavorite({liked,toggle,read,write:async desired => {
      // Resolve the numeric ID/type from this MID on the server before writing.
      const detail = await call('music.pf_song_detail_svr','get_song_detail_yqq',{song_mid:mid});
      const track = detail.track_info;
      if (track?.mid !== mid || !Number.isSafeInteger(Number(track.id)) || Number(track.id) <= 0 || !Number.isSafeInteger(track.type) || track.type < 0) throw new Error('QQ 音乐曲目身份无法确认，未修改收藏');
      await call('music.musicasset.PlaylistDetailWrite',desired ? 'AddSonglist' : 'DelSonglist',{
        dirId:201,v_songInfo:[{songId:Number(track.id),songType:track.type}],
      },true);
      likedPreview = null;
    }});
    return {provider:'qq',id:'qq:'+mid,liked:actual};
  }
  const like = payload => favoriteRequest(payload);
  const likeState = payload => favoriteRequest(payload,true);
  async function search({ query, limit = 20, offset = 0 } = {}) {
    const cookie = await getCookie(),
      auth = { cookie, ...credentials(cookie) },
      keyword = text(query, 160);
    if (!keyword) return { provider: "qq", songs: [], hasMore: false };
    const size = Math.max(1, Math.min(30, Number(limit) || 20)),
      start = Math.max(0, Math.min(10000, Number(offset) || 0));
    const payload = {
      comm: {
        ct: "11",
        cv: "14090508",
        v: "14090508",
        tmeAppID: "qqmusic",
        phonetype: "EBG-AN10",
        os_ver: "12",
        OpenUDID: "0",
        QIMEI36: "0",
        udid: "0",
        chid: "0",
        aid: "0",
        oaid: "0",
        taid: "0",
        tid: "0",
        wid: "0",
        uid: "0",
        sid: "0",
        modeSwitch: "6",
        teenMode: "0",
        ui_mode: "2",
        nettype: "1020",
      },
      req: {
        module: "music.search.SearchCgiService",
        method: "DoSearchForQQMusicMobile",
        param: {
          search_type: 0,
          searchid: Date.now() + crypto.randomInt(100000, 999999).toString(),
          query: keyword,
          page_num: Math.floor(start / size) + 1,
          num_per_page: size,
          highlight: 0,
          nqc_flag: 0,
          multi_zhida: 0,
          cat: 2,
          grp: 1,
          sin: start,
          sem: 0,
        },
      },
    };
    const body = JSON.stringify(payload),
      json = parse(
        await requestText(
          "https://u.y.qq.com/cgi-bin/musics.fcg?sign=" + qqSearchSign(body),
          {
            method: "POST",
            headers: {
              "User-Agent": "QQMusic 14090508(android 12)",
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
              Cookie: auth.cookie,
            },
          },
          body,
        ),
      );
    const data = json?.req?.data,
      result = data?.body || data,
      items = result?.item_song || result?.song?.list || result?.list;
    if (
      Number(json?.code) !== 0 ||
      Number(json?.req?.code) !== 0 ||
      !Array.isArray(items)
    )
      throw new Error("QQ 搜索服务暂时不可用，请稍后重试");
    const songs = items.slice(0, size).map(mapSong).filter(Boolean);
    return {
      provider: "qq",
      songs,
      offset: start,
      nextOffset: start + size,
      hasMore: items.length >= size,
    };
  }
  async function profile() {
    const auth = await context(),
      body = await get(
        "https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg",
        {
          cid: 205360838,
          userid: auth.uin,
          reqfrom: 1,
          g_tk: 5381,
          loginUin: auth.uin,
          format: "json",
          platform: "yqq.json",
        },
        auth,
      );
    const creator =
      body?.data?.creator || body?.data?.user || body?.data?.profile;
    if (
      Number(body?.code) !== 0 ||
      !creator ||
      !text(creator.nick || creator.nickname || creator.name)
    )
      throw new Error("QQ 账号信息尚未通过服务端验证，请完成官方登录后刷新");
    // The profile page is public. Verify the private liked library as well
    // before calling a stored webpage session an authenticated API account.
    const verification = await music(
      {
        comm: { ct: 24, cv: 0, uin: auth.uin, authst: auth.key },
        req_0: {
          module: "music.srfDissInfo.DissInfo",
          method: "CgiGetDiss",
          param: {
            disstid: 0,
            dirid: 201,
            tag: 1,
            song_begin: 0,
            song_num: 1,
            userinfo: 1,
            orderlist: 1,
          },
        },
      },
      auth,
    );
    if (
      Number(verification?.code) !== 0 ||
      Number(verification?.req_0?.code) !== 0 ||
      !Array.isArray(verification?.req_0?.data?.songlist)
    )
      throw new Error("QQ 网页会话已保存，但个人歌单授权尚未通过验证");
    likedPreview = {
      uin: auth.uin,
      song: mapSong(verification.req_0.data.songlist[0]),
      total: Math.max(0, Number(verification.req_0.data.total_song_num) || 0),
    };
    return {
      provider: "qq",
      loggedIn: true,
      apiConnected: true,
      profile: {
        provider: "qq",
        userId: auth.uin,
        nickname: text(creator.nick || creator.nickname || creator.name),
        avatarURL:
          image(creator.headpic || creator.avatar || creator.avatarUrl || creator.logo) ||
          (auth.loginType === "qq"
            ? image("https://q1.qlogo.cn/g?b=qq&nk=" + encodeURIComponent(auth.uin) + "&s=100")
            : ""),
        verification: "verified",
      },
    };
  }
  async function playlists({ offset = 0 } = {}) {
    const auth = await context(),
      start = Math.max(0, Math.min(5000, Number(offset) || 0)),
      size = 50;
    const results = await Promise.allSettled([
      get(
        "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss",
        {
          hostUin: 0,
          hostuin: auth.uin,
          sin: start,
          size,
          g_tk: 5381,
          loginUin: auth.uin,
          format: "json",
          platform: "yqq.json",
        },
        auth,
      ),
      get(
        "https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg",
        {
          ct: 20,
          cid: 205360956,
          userid: auth.uin,
          reqtype: 3,
          sin: start,
          ein: start + size - 1,
          format: "json",
        },
        auth,
      ),
    ]);
    const valid = results.filter(
      (value) =>
        value.status === "fulfilled" && Number(value.value?.code) === 0,
    );
    if (!valid.length)
      throw new Error("QQ 歌单暂时无法读取，请确认官方登录状态");
    const raw = valid
      .flatMap(
        (value) =>
          value.value?.data?.disslist || value.value?.data?.cdlist || [],
      )
      .slice(0, 100);
    const lists = [
      ...new Map(
        raw
          .filter(value => Number(value.dirid) !== 201 &&
            !/qzone|空间背景音乐|本地上传/i.test(value.diss_name || value.dissname || value.name || ""))
          .map(mapPlaylist)
          .filter(Boolean)
          .map((value) => [value.id, value]),
      ).values(),
    ];
    if (start === 0)
      lists.unshift({
        id: "qq:liked",
        title: "我喜欢的音乐",
        provider: "qq",
        source: "qq",
        trackCount: likedPreview?.uin === auth.uin ? likedPreview.total : 0,
        coverURL: likedPreview?.uin === auth.uin ? likedPreview.song?.coverURL || "" : "",
      });
    return {
      provider: "qq",
      apiConnected: true,
      playlists: lists,
      offset: start,
      nextOffset: start + size,
      hasMore: raw.length >= size,
    };
  }
  async function playlist({ id, offset = 0, limit = 50 } = {}) {
    const auth = await context(),
      pid = String(id || "").replace(/^qq:/, ""),
      start = Math.max(0, Math.min(10000, Number(offset) || 0)),
      size = Math.max(1, Math.min(100, Number(limit) || 50));
    let songs, total, metadata = null;
    if (pid === "liked") {
      const body = await music(
        {
          comm: { ct: 24, cv: 0, uin: auth.uin, authst: auth.key },
          req_0: {
            module: "music.srfDissInfo.DissInfo",
            method: "CgiGetDiss",
            param: {
              disstid: 0,
              dirid: 201,
              tag: 1,
              song_begin: start,
              song_num: size,
              userinfo: 1,
              orderlist: 1,
            },
          },
        },
        auth,
      );
      if (
        Number(body?.code) !== 0 ||
        Number(body?.req_0?.code) !== 0 ||
        !Array.isArray(body?.req_0?.data?.songlist)
      )
        throw new Error("QQ 喜欢歌单需要完整的官方音乐授权");
      songs = body.req_0.data.songlist;
      total = body.req_0.data.total_song_num;
    } else {
      if (!/^\d{1,20}$/.test(pid)) throw new Error("无效的 QQ 歌单");
      const body = await get(
          "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg",
          {
            type: 1,
            utf8: 1,
            disstid: pid,
            song_begin: start,
            song_num: size,
            loginUin: auth.uin,
            format: "json",
            platform: "yqq.json",
          },
          auth,
        ),
        detail = body?.cdlist?.[0];
      if (Number(body?.code) !== 0 || !Array.isArray(detail?.songlist))
        throw new Error("QQ 歌单没有返回可用歌曲");
      songs = detail.songlist;
      total = detail.total_song_num || detail.songnum;
      metadata = mapPlaylist({ ...detail, dissid: pid });
    }
    const mapped = songs.slice(0, size).map(mapSong).filter(Boolean),
      count = Math.max(0, Number(total) || start + mapped.length);
    return {
      provider: "qq",
      songs: mapped,
      total: count,
      offset: start,
      nextOffset: start + Math.min(size,songs.length),
      hasMore: start + Math.min(size,songs.length) < count,
      playlist: metadata || {
        id: "qq:" + pid, provider: "qq", source: "qq",
        title: pid === "liked" ? "我喜欢的音乐" : "QQ 歌单",
        coverURL: mapped[0]?.coverURL || "", trackCount: count,
      },
    };
  }
  async function recommendedPlaylists(auth) {
    try {
      const body = await music({
        comm: { ct: 24, cv: 0, uin: auth.uin, authst: auth.key },
        req_0: {
          module: "playlist.HotRecommendServer",
          method: "get_hot_recommend",
          param: { async: 1, cmd: 2 },
        },
      }, auth);
      if (Number(body?.code) === 0 && Number(body?.req_0?.code) === 0) {
        const lists = (body.req_0.data?.v_hot || []).slice(0, 24).map(mapPlaylist).filter(Boolean);
        if (lists.length) return lists;
      }
    } catch {
      // The official web playlist directory remains available when the feed is down.
    }
    const body = await get("https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg", {
      picmid: 1, g_tk: 5381, loginUin: auth.uin, hostUin: 0,
      format: "json", inCharset: "utf8", outCharset: "utf-8",
      notice: 0, platform: "yqq.json", needNewCode: 0,
      categoryId: 10000000, sortId: 5, sin: 0, ein: 23,
    }, auth);
    if (Number(body?.code) !== 0) throw new Error("QQ 推荐歌单暂时不可用");
    return (body?.data?.list || []).slice(0, 24).map(mapPlaylist).filter(Boolean);
  }
  async function chart(mode, auth) {
    const spec = DISCOVERY[mode];
    if (!spec) throw new Error("QQ 音乐尚未接通此发现入口");
    const body = await music({
      comm: { ct: 24, cv: 0, uin: auth.uin, authst: auth.key },
      req_0: {
        module: "musicToplist.ToplistInfoServer",
        method: "GetDetail",
        param: { topid: spec.topId, num: 30, offset: 0 },
      },
    }, auth);
    const data = body?.req_0?.data;
    if (Number(body?.code) !== 0 || Number(body?.req_0?.code) !== 0 || !Array.isArray(data?.songInfoList))
      throw new Error("QQ " + spec.label + "暂时不可用");
    return {
      provider: "qq", source: "qq", mode,
      label: "QQ 音乐 · " + spec.label,
      songs: data.songInfoList.slice(0, 30).map(mapSong).filter(Boolean),
    };
  }
  async function home() {
    const auth = await context();
    const [feed, tracks] = await Promise.allSettled([
      recommendedPlaylists(auth), chart("daily", auth),
    ]);
    let lists = feed.status === "fulfilled" ? feed.value : [];
    let songs = tracks.status === "fulfilled" ? tracks.value.songs : [];
    if (!lists.length) {
      try { lists = (await playlists()).playlists; } catch {}
    }
    if (!songs.length && lists.length) {
      const pages = await Promise.allSettled(lists.slice(0, 2).map(item => playlist({ id: item.id, limit: 30 })));
      songs = pages.flatMap(page => page.status === "fulfilled" ? page.value.songs : []).slice(0, 30);
    }
    if (!lists.length && !songs.length) throw new Error("QQ 推荐暂时无法读取，请稍后刷新");
    return {
      provider: "qq", songs, cards: songs, playlists: lists,
      discoveryModes: Object.keys(DISCOVERY),
      discoveryLabels: Object.fromEntries(Object.entries(DISCOVERY).map(([id, value]) => [id, value.label])),
      recommendationMode: "public",
      recommendationLabel: "QQ 音乐 · 热歌精选",
    };
  }
  async function discovery({ mode = "daily" } = {}) {
    return chart(mode, await context());
  }
  async function resolvePlayback({ id, song = {}, quality = "hires" } = {}) {
    const auth = await context(),
      mid = songId(String(id || "").replace(/^qq:/, ""));
    if (!mid) throw new Error("无效的 QQ 歌曲");
    if (!songId(song.mediaMid) || !text(song.title)) {
      const detail = await music(
          {
            comm: { ct: 24, cv: 0 },
            songinfo: {
              module: "music.pf_song_detail_svr",
              method: "get_song_detail_yqq",
              param: { song_mid: mid },
            },
          },
          auth,
        ),
        resolved = mapSong(detail?.songinfo?.data?.track_info);
      if (resolved) song = { ...song, ...resolved };
    }
    if (!text(song.title)) throw new Error("QQ 未返回这首歌曲的有效信息");
    const media = songId(song.mediaMid) || mid,
      candidates = [...QUALITY_OPTIONS,
        {id:'standard',label:'AAC/M4A',shortLabel:'AAC',prefix:'C400',ext:'.m4a'}],
      mediaIds = [...new Set([media, mid])],
      filenames = mediaIds.flatMap(mediaId => candidates.map(value => value.prefix + mediaId + value.ext));
    const payload = {
        comm: {
          uin: auth.uin,
          format: "json",
          ct: 19,
          cv: 0,
          authst: auth.key,
          tmeLoginType: auth.loginType === 'wechat' ? 1 : 2,
        },
        req_0: {
          module: "vkey.GetVkeyServer",
          method: "CgiGetVkey",
          param: {
            guid: crypto.randomInt(100000000, 999999999).toString(),
            songmid: filenames.map(() => mid),
            songtype: filenames.map(() => 0),
            uin: auth.uin,
            loginflag: 1,
            platform: "20",
            filename: filenames,
            xcdn: 1,
          },
        },
      };
    let body = await music(payload, auth);
    const legacyDenied = body?.req_0?.data?.midurlinfo?.some(item => Number(item?.result) === 104003) === true;
    // The current official web resolver can reject the older RPC with 104003
    // for otherwise authorised clear-format files. Preserve the same account,
    // filenames and quality order when using its replacement method.
    if (!body?.req_0?.data?.midurlinfo?.some(item => item?.purl)) {
      const current = {...payload, comm:{...payload.comm,ct:24}, req_0:{...payload.req_0,module:'music.vkey.GetEVkey',method:'CgiGetEVkey'}};
      body = await music(current, auth, {signed:true});
    }
    const data = body?.req_0?.data;
    if (Number(body?.code) !== 0 || Number(body?.req_0?.code) !== 0)
      throw new Error("QQ 音源授权失败，请刷新官方登录或选择其他音质");
    const choices = [];
    for (const item of Array.isArray(data?.midurlinfo) ? data.midurlinfo : []) {
      if (!item?.purl || !/^[A-Za-z0-9_./?=&%+\-]+$/.test(item.purl)) continue;
      const supplied = String(item.filename || "").slice(0, 4),
        actual = candidates.find((value) => value.prefix === supplied);
      if (!actual) continue;
      for (const base of data.sip?.length ? data.sip : ['https://ws.stream.qqmusic.qq.com/']) {
        try {
          const url = new URL(item.purl, base);
          if (url.protocol === "http:") url.protocol = "https:";
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.port ||
            ![
              "ws.stream.qqmusic.qq.com",
              "isure.stream.qqmusic.qq.com",
              "dl.stream.qqmusic.qq.com",
              "aqqmusic.tc.qq.com",
              "sjy6.stream.qqmusic.qq.com",
            ].includes(url.hostname)
          )
            continue;
          choices.push({
            provider: "qq",
            source: "qq",
            song: {
              ...song,
              id: "qq:" + mid,
              providerId: mid,
              source: "qq",
              provider: "qq",
            },
            url: url.href,
            quality: actual.id,
            qualityLabel: actual.label,
            requestedQuality: quality,
            trial: false,
          });
          break;
        } catch {}
      }
    }
    if (choices.length) return choices;
    const denied = legacyDenied || (data?.midurlinfo || []).some(item => Number(item.result) === 104003);
    throw Object.assign(new Error(denied
      ? 'QQ 音乐已登录，但官方接口未向当前账号提供这首歌曲的播放地址（104003）。可更换音源或稍后重试。'
      : '当前 QQ 账号与歌曲未返回可播放的授权音源'),
      {code:denied ? 'QQ_PLAYBACK_NOT_AUTHORIZED' : 'QQ_STREAM_UNAVAILABLE'});
  }
  function availableQualities(choices) {
    return QUALITY_OPTIONS.filter(option => choices.some(choice => choice.quality === option.id))
      .map(({prefix,ext,...value}) => {
        const delivered = choices.filter(choice => choice.quality === value.id);
        return delivered.every(choice => choice.qualityLabel === 'AAC/M4A')
          ? {...value, label:'AAC/M4A', shortLabel:'AAC'}
          : value;
      });
  }
  async function playbackOptions(payload = {}) {
    if (!payload.id) return {provider:'qq',requiresLogin:true,qualityOptions:QUALITY_OPTIONS.map(({prefix,ext,...value})=>value)};
    try {
      const choices = await resolvePlayback({...payload,quality:'hires'});
      return {provider:'qq',apiConnected:true,requiresLogin:true,qualityOptions:availableQualities(choices)};
    } catch (error) {
      if (error?.code !== 'QQ_PLAYBACK_NOT_AUTHORIZED') throw error;
      return {
        provider:'qq',apiConnected:true,requiresLogin:true,qualityOptions:[],
        unavailableCode:error.code,unavailableMessage:error.message,
      };
    }
  }
  async function play(payload = {}) {
    const choices = await resolvePlayback(payload);
    const requested = QUALITY_OPTIONS.findIndex(option => option.id === payload.quality),
      allowed = QUALITY_OPTIONS.slice(requested < 0 ? 0 : requested),
      selected = allowed.map(option => choices.find(choice => choice.quality === option.id)).find(Boolean);
    if (!selected) throw new Error('QQ 未返回所选音质或较低档位的可用音源，请切换音质');
    return {...selected,degraded:requested >= 0 && selected.quality !== payload.quality,qualityOptions:availableQualities(choices)};
  }
  async function lyrics({ id } = {}) {
    const auth = await context(),
      mid = songId(String(id || "").replace(/^qq:/, ""));
    if (!mid) throw new Error("无效的 QQ 歌曲");
    const body = await music(
        {
          comm: { ct: 24, cv: 0 },
          lyric: {
            module: "music.musichallSong.PlayLyricInfo",
            method: "GetPlayLyricInfo",
            param: { songMID: mid },
          },
        },
        auth,
      ),
      data = body?.lyric?.data || {};
    const decode = (value) => {
      const string = String(value || "").slice(0, 140000);
      return string.includes("[")
        ? string
        : Buffer.from(string, "base64").toString("utf8");
    };
    return require("../lyrics.cjs").parseLyrics({
      lrc: { lyric: decode(data.lyric) },
      tlyric: { lyric: decode(data.trans) },
    });
  }
  return { profile, playlists, playlist, play, playbackOptions, lyrics, search, home, discovery, like, likeState };
}
module.exports = {
  createQQProvider,
  mapSong,
  mapPlaylist,
  credentials,
  QUALITY_OPTIONS,
};
