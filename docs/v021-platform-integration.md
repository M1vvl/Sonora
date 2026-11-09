# 其他音乐平台限时接入核查

用户允许遇到阻碍先跳过，不在此项停留过久。本轮没有把网页登录窗口或预留按钮称为“登录、本人歌单与权限内播放均已接通”。实际完整来源仍为网易云，其他入口显示具体阻碍。

| 平台 | 本轮结论 | 阻碍与后续条件 |
|---|---|---|
| Apple Music | 跳过，未启用登录 | MusicKit需本应用的开发者标识/私钥签发的developer token和用户授权；当前没有这套应用凭证。不能拿别的应用身份当作本应用生产配置。 |
| Spotify | 跳过，未启用登录 | PKCE不需要client secret但仍需要本应用client ID、回调和授权；完整SDK播放需Premium。开发模式还有授权用户范围限制，不符合直接分发后人人可用的目标。 |
| QQ音乐 | 跳过，未声称技术不可实现 | MineRadio使用独立网页登录会话和QQ音源协议适配。仅迁移登录UI无法证明本人歌单及权限内播放已完成；完整链路未在本轮限时内接通。 |
| 酷狗 | 跳过，未声称技术不可实现 | 原版独立kugou-api与账号会话、播放协议互相依赖，不能把已有网易云请求替换成平台名即算接通。 |
| 汽水 | 跳过 | 原版依赖设备注册、请求签名、独立授权/播放模块。本轮没有完成端到端联调，不启用空操作按钮。 |

本地只读依据为用户提供的MineRadio源码：`spotify-api.js`、`qq-vip-api.js`、`kugou-api.js`、`qishui-api.js`及`public/js/modules/08-account/`。没有读取MineRadio配置中的实际cookies、账号或token，也没有迁移其他应用的凭证。

官方依据：[Apple developer token](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)、[Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started)、[Spotify配额模式](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)、[2026年开发模式变更](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)。

这五项属于本轮明确跳过的请求，不能混入已实现清单。后续可单独以一个平台为范围做完整授权、分页歌单、播放与退出恢复适配。
