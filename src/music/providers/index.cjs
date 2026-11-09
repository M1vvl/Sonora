"use strict";
const { createProviderHTTP } = require("./http.cjs");
const { parseLyrics } = require("../lyrics.cjs");
const ACTIONS = Object.freeze([
  "home",
  "discovery",
  "profile",
  "playlists",
  "playlist",
  "play",
  "lyrics",
  "search",
  "playbackOptions",
  "like",
]);
const text = (value, max = 160) =>
  String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, max);
const hash = (value) =>
  /^[a-f0-9]{32}$/i.test(String(value || ""))
    ? String(value).toLowerCase()
    : null;
const decimal = (value) =>
  /^\d{1,20}$/.test(String(value || "")) ? String(value) : "";
function cover(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    return require("../media-policy.cjs").imageURL(url.href)?.href || "";
  } catch {
    return "";
  }
}
const key = (value) =>
  /^[A-Za-z0-9_]{1,100}$/.test(String(value || "")) ? String(value) : null;
const KUGOU_QUALITY_OPTIONS = Object.freeze(
  [
    { id: "jymaster", label: "蝰蛇母带", shortLabel: "母带" },
    { id: "hires", label: "Hi-Res", shortLabel: "Hi-Res" },
    { id: "lossless", label: "无损 FLAC", shortLabel: "SQ" },
    { id: "exhigh", label: "极高 320kbps", shortLabel: "HQ" },
    { id: "standard", label: "标准 128kbps", shortLabel: "标准" },
  ].map(Object.freeze),
);
function kugouSong(value) {
  const id = hash(value?.hash || value?.id);
  if (!id || !text(value.name || value.title)) return null;
  const fields = {
    albumId: decimal(value.albumId),
    albumAudioId: decimal(value.albumAudioId),
  };
  for (const name of ["hqHash", "sqHash", "resHash"])
    if (hash(value[name])) fields[name] = hash(value[name]);
  return {
    id: "kugou:" + id,
    provider: "kugou",
    source: "kugou",
    providerId: id,
    title: text(value.name || value.title),
    artist: text(value.artist) || "未知歌手",
    album: text(value.album),
    duration: Math.max(
      0,
      Math.min(86400, (Number(value.duration) || 0) / 1000),
    ),
    coverURL: cover(value.cover || value.coverURL),
    ...fields,
  };
}
function kugouPlaylist(value) {
  const id = key(value?.listId || value?.id);
  return id
    ? {
        id: "kugou:" + id,
        provider: "kugou",
        source: "kugou",
        title: text(value.name || value.title),
        coverURL: cover(value.cover),
        trackCount: Math.max(0, Number(value.trackCount) || 0),
      }
    : null;
}
function createProviderAdapter({
  provider,
  getCookie,
  requestText: injectedTransport,
} = {}) {
  if (!["qq", "kugou"].includes(provider))
    throw new Error(
      provider === "spotify"
        ? "Spotify 主播放器接入需要本应用 Client ID 与 OAuth 授权配置"
        : provider === "qishui"
          ? "汽水 Passport 扫码需要独立 SDK 与安全验证宿主"
          : "不支持的音乐平台",
    );
  const network = injectedTransport
    ? null
    : createProviderHTTP({
        domains: provider === "qq" ? ["qq.com"] : ["kugou.com"],
        maxActive: 2,
      });
  const requestText = injectedTransport || network.requestText;
  const known = new Map();
  let generation = 0,
    disposed = false,
    verifiedProfile = null;
  let clients = null;
  function currentClients() {
    if (!clients) {
      const clientGeneration = generation;
      const guardedTransport = (...args) => {
        if (disposed || clientGeneration !== generation)
          return Promise.reject(new Error("平台音乐操作已取消"));
        return requestText(...args);
      };
      clients = {
        qq:
          provider === "qq"
            ? require("./qq.cjs").createQQProvider({
                getCookie,
                requestText: guardedTransport,
              })
            : null,
        kg:
          provider === "kugou"
            ? require("./kugou-core.cjs").createKugouCore({
                requestText: guardedTransport,
              })
            : null,
      };
      if (clients.kg) {
        clients.favorites = require('./kugou-favorites.cjs').createKugouFavorites({core:clients.kg,getCookie});
        clients.discovery = require("./kugou-discovery.cjs").createKugouDiscovery({
          core: clients.kg,
          getCookie,
          requestText: guardedTransport,
        });
      }
    }
    return clients;
  }
  function fail(value, message) {
    if (value?.error) throw new Error(value.message || message);
    return value;
  }
  function kugouQualities(info) {
    const max = info?.membershipRights?.maxQuality || 'standard';
    const start = KUGOU_QUALITY_OPTIONS.findIndex(option => option.id === max);
    return KUGOU_QUALITY_OPTIONS.slice(start < 0 ? KUGOU_QUALITY_OPTIONS.length - 1 : start);
  }
  async function request(payload = {}) {
    if (disposed) throw new Error("平台音乐模块已关闭");
    if (!ACTIONS.includes(payload.action))
      throw new Error("不支持的平台音乐操作");
    const ticket = generation;
    const { qq, kg, discovery, favorites } = currentClients();
    if (["play", "lyrics", "like"].includes(payload.action))
      payload = {
        ...payload,
        song: { ...known.get(String(payload.id)), ...payload.song },
      };
    let result;
    if (payload.action === "playbackOptions" && qq) {
      result = await qq.playbackOptions({...payload,song:{...known.get(String(payload.id)),...payload.song}});
      result.apiConnected = !!verifiedProfile;
    }
    else if (payload.action === "playbackOptions") {
      const info = await kg.getKugouLoginInfo(await getCookie());
      result = {
        provider,
        apiConnected: !!verifiedProfile,
        requiresLogin: true,
        qualityOptions:
          provider === "qq"
            ? require("./qq.cjs").QUALITY_OPTIONS.map(
                ({ prefix, ext, ...option }) => option,
              )
            : kugouQualities(info),
      };
    }
    else if (qq) result = await qq[payload.action](payload);
    else if (payload.action === 'like') result = await favorites.like(payload);
    else {
      const cookie = await getCookie();
      if (payload.action === "home") {
        const [library, recommendation, publicLibrary] = await Promise.allSettled([
          kg.handleKugouUserPlaylists(cookie),
          discovery.recommend(20),
          discovery.publicPlaylists(18),
        ]);
        const lists = library.status === "fulfilled" ? library.value : {};
        const songs = recommendation.status === "fulfilled"
          ? recommendation.value.map(kugouSong).filter(Boolean)
          : [];
        const publicLists = publicLibrary.status === "fulfilled" ? publicLibrary.value : [];
        if (!songs.length && !lists.libraryReady && !publicLists.length) {
          throw new Error("酷狗推荐与歌单暂时未能加载，请稍后再试");
        }
        result = {
          provider,
          songs,
          cards: songs,
          playlists: (publicLists.length ? publicLists : lists.playlists || []).slice(0, 100).map(kugouPlaylist).filter(Boolean),
          discoveryModes: songs.length ? ["daily"] : [],
          discoveryLabels: { daily: "猜你喜欢" },
          recommendationMode: songs.length ? "personal" : "library",
          recommendationLabel: "酷狗音乐 · " + (songs.length ? "猜你喜欢" : publicLists.length ? "热门歌单" : "我的歌单"),
        };
      } else if (payload.action === "discovery") {
        if (payload.mode !== "daily") throw new Error("酷狗暂未提供此推荐模式");
        result = {
          provider,
          label: "猜你喜欢",
          songs: (await discovery.recommend(20)).map(kugouSong).filter(Boolean),
        };
      } else if (payload.action === "search") {
        const query = text(payload.query, 160),
          limit = Math.max(1, Math.min(20, Number(payload.limit) || 20)),
          offset = Math.max(0, Math.min(10000, Number(payload.offset) || 0));
        const rows = await kg.handleKugouSearch(query, limit, cookie, offset);
        result = {
          provider,
          songs: (rows || []).slice(0, limit).map(kugouSong).filter(Boolean),
          offset,
          nextOffset: offset + limit,
          hasMore: rows.length >= limit,
        };
      } else if (payload.action === "profile") {
        // A local cookie label does not prove that the server still accepts it.
        const library = fail(
          await kg.handleKugouUserPlaylists(cookie),
          "酷狗账号暂未通过服务端验证",
        );
        if (!library.libraryReady)
          throw new Error("请在酷狗官方页面完成账号登录后刷新");
        const info = await kg.getKugouLoginInfo(cookie);
        result = {
          provider,
          loggedIn: true,
          apiConnected: true,
          profile: {
            provider,
            userId: text(info.userId, 30),
            nickname: text(info.nickname) || "酷狗用户",
            avatarURL: cover(info.avatar),
            vip: info.membershipVerified === true && info.isVip === true,
            verification: "verified",
          },
        };
      } else if (payload.action === "playlists") {
        const value = fail(
          await kg.handleKugouUserPlaylists(cookie),
          "酷狗歌单暂时不可用",
        );
        result = {
          provider,
          apiConnected: value.libraryReady === true,
          playlists: (value.playlists || [])
            .slice(0, 100)
            .map(kugouPlaylist)
            .filter(Boolean),
          hasMore: false,
        };
      } else if (payload.action === "playlist") {
        const id = key(String(payload.id || "").replace(/^kugou:/, ""));
        if (!id) throw new Error("无效的酷狗歌单");
        const offset = Math.max(
            0,
            Math.min(10000, Number(payload.offset) || 0),
          ),
          limit = Math.max(1, Math.min(50, Number(payload.limit) || 50));
        const isPublic = /^public_\d{1,20}$/.test(id);
        const value = fail(
          isPublic ? await discovery.publicPlaylist(id, {offset, limit}) : await kg.handleKugouPlaylistTracks(id, cookie, {
            paged: true,
            offset,
            limit,
          }),
          "酷狗歌单暂时不可用",
        );
        const tracks = isPublic ? value.songs : value.tracks;
        result = {
          provider,
          songs: (tracks || [])
            .slice(0, limit)
            .map(kugouSong)
            .filter(Boolean),
          total: Math.max(0, Number(value.total) || 0),
          offset,
          nextOffset: offset + (tracks?.length || 0),
          hasMore: value.hasMore === true,
          ...(isPublic ? {playlist: kugouPlaylist(value.playlist)} : {}),
        };
      } else if (payload.action === "play") {
        const id = hash(String(payload.id || "").replace(/^kugou:/, ""));
        if (!id) throw new Error("无效的酷狗歌曲");
        const song = payload.song || {},
          params = {
            hash: id,
            quality: KUGOU_QUALITY_OPTIONS.some(
              (value) => value.id === payload.quality,
            )
              ? payload.quality
              : "hires",
            albumId: decimal(song.albumId),
            albumAudioId: decimal(song.albumAudioId),
          };
        for (const field of ["hqHash", "sqHash", "resHash"])
          if (hash(song[field])) params[field] = hash(song[field]);
        const value = fail(
          await kg.handleKugouSongUrl(params, cookie),
          "酷狗暂未返回授权音源",
        );
        if (!value.url || !value.playable)
          throw new Error("当前酷狗账号与歌曲未返回可播放的授权音源");
        result = {
          provider,
          source: provider,
          song: {
            ...song,
            id: "kugou:" + id,
            providerId: id,
            source: provider,
            provider,
          },
          url: value.url,
          quality: KUGOU_QUALITY_OPTIONS.some(
            (option) => option.id === value.deliveredQuality,
          )
            ? value.deliveredQuality
            : "unknown",
          qualityLabel:
            KUGOU_QUALITY_OPTIONS.find(
              (option) => option.id === value.deliveredQuality,
            )?.label || "音质未标明",
          requestedQuality: params.quality,
          degraded: value.deliveredQuality && value.deliveredQuality !== 'unknown' && value.deliveredQuality !== params.quality,
          qualityOptions: kugouQualities(value),
          bitrate: value.bitrate || 0,
          trial: value.trial === true,
        };
      } else {
        const id = hash(String(payload.id || "").replace(/^kugou:/, ""));
        if (!id) throw new Error("无效的酷狗歌曲");
        const value = fail(
          await kg.handleKugouLyric(
            id,
            decimal(payload.song?.albumAudioId),
            Number(payload.song?.duration) || 0,
          ),
          "酷狗歌词暂时不可用",
        );
        result = parseLyrics({
          lrc: { lyric: value.lyric },
          tlyric: { lyric: value.trans },
        });
      }
    }
    if (disposed || ticket !== generation)
      throw new Error("平台音乐操作已取消");
    if (payload.action === "profile") {
      verifiedProfile = result.profile || null;
      result.qualityOptions =
        provider === "qq"
          ? require("./qq.cjs").QUALITY_OPTIONS.map(
              ({ prefix, ext, ...option }) => option,
            )
          : KUGOU_QUALITY_OPTIONS;
    }
    for (const song of result.songs || []) {
      known.delete(song.id);
      known.set(song.id, { ...song });
      while (known.size > 300) known.delete(known.keys().next().value);
    }
    return result;
  }
  return {
    request,
    getProfile: () => verifiedProfile,
    cancel() {
      generation++;
      verifiedProfile = null;
      known.clear();
      network?.cancel();
      clients?.kg?.clearKugouSessionCaches();
      clients = null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      verifiedProfile = null;
      known.clear();
      network?.dispose();
      clients?.kg?.clearKugouSessionCaches();
      clients = null;
    },
  };
}
module.exports = {
  createProviderAdapter,
  kugouSong,
  kugouPlaylist,
  KUGOU_QUALITY_OPTIONS,
  ACTIONS,
};
