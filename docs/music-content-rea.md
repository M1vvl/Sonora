# 音乐内容、推荐与播放：定向 REA 和独立适配

验证时间：2026-10-30（北京时间）。本次仅只读安装目录中的程序文件，未读取网易云或 MineRadio 的用户目录、账号、Cookie、缓存和播放历史，也未自动扫码或复用其他软件的登录。

## 来源和边界

- MineRadio 2.1.0：`D:\Music\Mineradio\resources\app`。只对照公开 `server.js` 的推荐、搜索、红心、评论路由以及随包 MIT `NeteaseCloudMusicApi` 模块；没有引入它的 HTTP 服务或完整运行时。
- 网易云 Windows 3.1.41.205529：`D:\Music\CloudMusic`。检查程序版本、资源包签名和哈希；`package/orpheus.ntpk` 是原生资源包，不是这里可直接迁移的公开源码。未解密专有包、修改程序、附加进程或声称已经复现其闭源内部实现。
- `cloudmusic.exe` SHA-256：`16689D9731121F0F15116205D73A472748DE932B6A848E36B55B60501CBF0EDE`。
- `package/orpheus.ntpk` SHA-256：`58BEE4E575F2B276FEA33253115CF898628F1E7DE5A6735FBB99E3093252AA1B`。

实际执行 REA `analyze-javascript-application`，仅选择九个精确文件：`server.js` 及 NodeAPI 的 `recommend_songs.js`、`recommend_resource.js`、`personalized.js`、`cloudsearch.js`、`song_url_v1.js`、`comment_music.js`、`like.js`、`playlist_detail.js`。退出码 0，证据 ID `ev_52fb3400582d7c51cbff40c920617c4b309144bb9090e53a92878124bd38ca75`；证据与摘要保存在 `artifacts/music-content-rea/selected-modules` 和 `rea-summary.json`。

该分析只静态解析所选源文件，未执行目标程序。九个文件语法解析成功，server.js 的语义图受 6000 节点限制，整体为部分覆盖；2048 个未选文件不在调用关系分析范围，不能将未出现关系当成不存在。另直接核查 `personalized_newsong.js`、`song_detail.js`、`song_like_check.js` 的公开模块实现。

## 采用的公开模块思路

| 功能 | 源码中的官方请求 | 独立适配 |
|---|---|---|
| 每日歌曲 | `/api/v3/discovery/recommend/songs` | 最多 30 首；从候选中随机抽三首卡片，缓存期保持稳定 |
| 每日歌单 | `/api/v1/discovery/recommend/resource` | 已核实登录时使用，最多八个；失败可显示公开歌单 |
| 公开候选 | `/api/personalized/playlist`、`/api/personalized/newsong` | 未登录歌单及每日歌曲失败后的公开新歌回退 |
| 搜索 | `/api/cloudsearch/pc`，type 1 / 1000 | 歌曲最多 30 首、歌单六个，分别展示；新搜索取消旧任务 |
| 歌单 | `/api/v6/playlist/detail` | 最多 30 首，必要时用 `/api/v3/song/detail` 补齐元数据 |
| 官方播放地址 | `/api/song/enhance/player/url/v1` | 请求 exhigh，保留真实权限；无 URL、试听片段或错误 code 均明确不可完整播放 |
| 收藏 | `/api/radio/like`、`/api/song/like/check` | 只接受显式布尔值、必须已核实登录，服务端成功后才投影红心；不因点击提前报成功 |
| 评论 | `/api/v1/resource/comments/R_SO_4_<id>` | 只读真实公开评论，最多 20 条；不实现代发评论 |

请求直接发送到 `music.163.com` / `interface.music.163.com`，使用随包 MIT 模块公开的 weapi/eapi 算法；不使用第三方解锁、音源替换、DRM 绕过或其他软件的会话数据。未采用原配置中的反作弊 token/clientSign。

匿名每日接口本机实际返回 code 200，本次有效条目为 29 首（此前记录为 30 首）；归一化后最多保留 30 首，不要求上游每日数量固定。这不证明它针对这个用户做了个性化推荐。未登录始终返回 `recommendationMode: public`，`recommendationLabel` 为“公开每日推荐”；只有应用自己的扫码登录被官方账号接口核实后才为 `personal` / “每日推荐”。每日接口失败回退新歌时返回 public / “公开新歌推荐”，避免把回退新歌误称每日推荐。

## 模块、数据与生命周期

- `src/music/netease.cjs`：限时、限字节的官方协议。总网络并发最多三，内容最多占二，给二维码/账号核实保留一个槽；待处理队列最多 32。鉴权响应 128KiB，内容按接口最多 256/512KiB；每次请求最多十秒，不新增持续轮询。
- `src/music/catalog.cjs`：歌曲/歌单/评论白名单映射、三张随机卡片、五分钟有界缓存、搜索和页面任务取消。已知歌曲最多 300 个、缓存最多 30 项、红心投影最多 300 个；账号切换清理相关缓存。
- `src/music/player-service.cjs`：完整播放权限判定、官方 CDN HTTPS 地址校验、收藏和实际播放进度入口。上游 `http` 只允许在网易云官方 CDN 上规范为 `https`；地址由主进程转换成受控本地协议，原始地址不写入历史。
- `src/music/state.cjs`：独立的原子 `music-state.json`，仅保存 `autoHideAccount` 偏好和最多 100 首本地播放历史。获取播放 URL、点击卡片或失败播放不生成历史；UI 在真实 audio `playing` 事件首次报告 0 秒，再低频保存后续进度。只接受服务本次发出过完整可播放 URL 的歌曲。
- `bootstrap` 在联网前读取本地偏好。因此即使推荐网络离线，重启仍恢复账号栏自动隐藏设置；主题设置不经过本模块。
- `inactive` / `deactivate` 只取消内容任务，不使已授权音频流或扫码流程失效。`dispose` 取消并等待活跃内容任务及鉴权原子写入回滚后释放；页面没有持续探活或歌曲轮询。

Cookie 仍仅由鉴权服务持有，通过注入的 Electron safeStorage 加密，内容服务只通过私有闭包读取。Renderer 获得白名单元数据和受控播放句柄，不获得 Cookie、原始请求对象或账号凭据。

## 验证与实际限制

`tests/music-auth.test.cjs`、`tests/music-content.test.cjs` 共 33 项通过，覆盖鉴权取消、磁盘加密/失败、重启恢复、离线偏好、公开/私人标记、随机三卡去重及缓存稳定、完整权限、试听/第三方 URL 拒绝、红心服务端确认、评论上限、100 首历史、取消释放和并发鉴权保留槽。

真实匿名链路记录：`artifacts/music-content-rea/live-content-check.json`。本机直接官方请求结果：公开每日 30 首、随机三卡、八个歌单；搜索 30 首/六个歌单；推荐歌单展开 30 首；真实评论 20 条。每日候选中的一个可完整播放条目在 `m801.music.126.net` HTTPS Range 请求返回 206、`audio/mpeg` 和 4096 字节。报告不包含播放 URL、二维码、Key、Cookie、评论正文或个人资料。

随后通过 `scripts/check-music-auth.cjs` 执行完整主进程/preload 的隔离实测，35 项通过：真实二维码 801、取消、Windows DPAPI 加密往返、官方目录/搜索/歌单/评论、受控图片协议、实际 WebGL 封面上传，以及受控音频协议下静音解码与播放历史落盘。证据为 `artifacts/v0.3.16-music-auth-final/music-auth-report.json`；真实封面截图为同目录 `music-live-workspace.png`，没有二维码或个人账号画面。测试始终保持原生窗口隐藏，仅为验证 GPU/截图在隔离 renderer 中覆盖可见性标志并请求有限合成帧。

该实测识别并修复网易云封面 CDN 返回 `image/jpg` 别名被拒绝的问题，主进程规范为 `image/jpeg`；一次请求四张以上封面通过有限队列等待。最终有 29 张受控封面成功解码、八张可见歌单图都有真实尺寸，GPU 使用单一 WebGL 上下文；实际音频时长 198.33 秒，静音播放到约 0.41 秒并写入同等进度。报告不保存音频 URL 或音频内容。截图会等待已解码图片提交画面，不能用加载前的空占位截图作为视觉验收。

这完成了本机实际解码与界面链路验证，未进行可见播放器听感或所有歌曲/账号的播放验证。歌曲版权、付费权限、地区和第三方网络状态由网易云实际返回决定；不可用时明确显示，不绕过权限，也不承诺全部歌曲永远可播。真实个人每日推荐和收藏账号写入只在用户完成本应用扫码后才能验证，本次未替用户登录或更改真实收藏。
