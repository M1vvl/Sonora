# 音乐平台源码核对与迁移记录

## 源码能力

| 平台 | MineRadio 实际实现 | 本轮范围 |
|---|---|---|
| QQ 音乐 | 官方独立 session 登录、QQ/微信/QQ 音乐入口、自身播放票据、歌单、签名搜索、vkey、歌词 | 同一软件窗口内官方登录、私有歌单验证、本人歌单和分页歌曲、搜索、权限内主播放器取流与四档能力、歌词 |
| 酷狗 | 官方网页登录及自身 token、签名网关、歌单、歌曲、权益判断、歌词 | 原函数依赖闭包迁移，注入有界网络与独立账号 session，分页读取、搜索、权限内取流和实际音质报告 |
| 汽水 | Passport SDK 扫码、SDK 签名及 MFA 宿主，设备标识在本应用生成 | 由本轮独立汽水模块实现，账号界面已接专用 qrCreate/qrCheck/closeQr 协议，具体后端验收见该模块记录 |
| Spotify | PKCE、随机 state、回调服务、本应用 Client ID 和账号 API | 官方网页登录在同窗口内嵌。主播放器 OAuth 仍缺本应用 Client ID/登记回调 |
| Apple Music | 这份 MineRadio 源码没有 Apple Music 实现 | 官方网页登录在同窗口内嵌。主播放器曲库/播放仍缺 MusicKit 开发者令牌与授权配置 |

Spotify 的 PKCE 流程需要本应用 client_id 与配置一致的回调。Web Playback SDK 使用授权 token，并要求符合其账号与播放条件。[Spotify PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)、[Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started)

Apple Music API 的开发者令牌须由应用开发者配置。用户在苹果官方网页登录与为本应用配置 MusicKit 是两个分别核实的状态。[Apple 开发者令牌](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)

## 账号与播放器接口

`platformLogin` 接收平台、QQ 扫码方式及 DOM 提供的界面区域，创建隔离 WebContentsView。`platformBounds` 更新区域，`platformClose` 释放主视图和官方 OAuth 子视图。所有视图处于同一个原生窗口内，官方页面没有 preload、Node 或本软件的主界面权限。权限请求关闭，导航域名限制到对应平台，最多同时三层认证视图。关闭保留自身 session，退出登录只清除此平台的本软件 session。

`platformRequest` 的 QQ/酷狗动作包含 `profile`、`playlists`、`playlist`、`search`、`play`、`lyrics`、`playbackOptions`。歌曲使用 `qq:mid` 与 `kugou:hash`，服务端解析 URL 仅交给主进程桥转换为本地不透明播放地址。最多保存 300 首已返回歌曲的元数据。每个平台最多两个活跃元数据请求与十二个等待请求，响应上限 1MiB，单次超时不超过 10 秒。取消后旧代次不能继续发后续请求或恢复账号状态。

QQ 公开 profile 成功以后，还须使用自己的完整音乐票据通过私有喜欢歌单验证，才报告账号 API 已连接。酷狗通过本人云歌单的有效服务端响应核实。Cookie 存在只代表网页 session 已保存。

两个平台都按权限内官方响应取流。QQ 音质识别使用实际返回的文件前缀。酷狗新增独立的已交付音质投影，缺少返回音质、文件格式或有效码率时显示未标明。请求档位保留为请求信息。会员权限继续由原协议和服务端限制处理。

## 代码验证与网络探测

2026-11-05，使用上述适配器和空白 cookie 执行真实匿名搜索，查询“周杰伦 稻香”。QQ 的签名完整搜索返回 3 首，耗时 1565ms。酷狗 song_search_v2 返回 3 首，耗时 1535ms。探测未使用账号，未读取其他播放器登录态。

代码测试覆盖账号到歌单再到主播放器回调、精确队列、来源 ID、服务端实际降档、元数据分页、会话保密、登出作用域、官方 OAuth 子视图内嵌、关闭释放、过期异步结果、汽水独立扫码动作及网络并发上限。真实扫码由用户操作，个人歌单、付费音质和音频播放没有替用户执行登录验收。

QQ/酷狗的收藏修改与评论接口尚未迁入本模块。Apple Music 与 Spotify 的官方网页登录成功也不会在本模块中自动变为主播放器 API 已连接。汽水受保护音频的处理以独立后端的实际返回和支持范围为准。
