# 0.3.17 音质、歌词与听歌统计定向分析

只读分析用户指定的 `D:/Music/Mineradio/resources/app` 发布代码，未读取现有播放器用户配置、凭证或缓存。选择五个公开程序模块，副本与SHA-256位于 `artifacts/v0.3.17-music-rea/selected` 和 `source-map.json`；REA证据为同目录 `evidence`，约18MB。五个文件均成功解析；应用图覆盖为partial，静态语义unknown不能当作完整运行时证明。

| MineRadio/随包API模块 | Agent Pulse适配 |
| --- | --- |
| `05-playback/00-api-quality-output.js` 音质ID/标签/平台偏好 | `src/music/quality.cjs` 和 `ui/music/track-options.js` |
| NeteaseCloudMusicApi `song_url_v1.js` | `netease.cjs` 官方 `/api/song/enhance/player/url/v1`，固定五档白名单，保留账号与版权权限 |
| NeteaseCloudMusicApi `lyric.js` 与 `06-lyrics/00-lyrics-fetch-parse.js` | 官方歌词请求，独立LRC解析与缓存，UI直接跟随已有audio事件 |
| `05-playback/02-listen-stats.js` | 独立原子音乐状态，真实播放时间、去重歌曲、连续天数；不复制完整localStorage或长期ID全集 |

另外人工读取了MineRadio `server.js` 的质量候选与真实完整音源判断。它将高清臻音映射为 `hires`，超清母带为 `jymaster`。本适配不迁移其同名跨平台回退、其他平台账号、试听兜底、解锁服务或原有重型音频图；仅采用所需官方协议与状态组织方式。

实际请求档位与返回档位分开：本机匿名 `hires` 请求返回 `exhigh`、320000bps；显示HQ而不显示臻音。高比特率不能证明无损、Hi-Res或母带。版权/会员无完整URL或只返回试听时明确失败，当前正在播放的音频不被权限失败替换。

来源菜单目前只有网易云实际接通；其他平台禁用并标记未接入，未使用本机其他播放器的登录状态。Apple Music为账号入口预留，未声称获得Apple Music播放权限。

歌词每次最多256KiB响应，解析100k字符/1200行，缓存16项且总计2MiB；UI显示800行上限，按audio timeupdate二分定位当前行，不创建独立时钟。切歌/离页有代次和取消保护。

听歌统计使用UI实际播放间隔，等待、停滞、跳转、暂停停止计数；后台限制到已过墙钟时间和单次30秒，以北京时间划日，跨午夜分段。保存当日曲目去重及近七天ID，较早天只留秒数供连续天数计算，避免长期增长超出存储预算。

验证：`tests/music-playback-options.test.cjs`五项检查，包含实际档位识别、未知档位、存储上限、歌词时间/翻译、去重及跨日；音乐UI覆盖缓冲/拖动不累计、音质失败保留当前播放、切换保留秒数与暂停意图。实际匿名接口歌词返回41行并通过内置播放器链路。个人Hi-Res/SVIP可用性仍由官方账号与具体歌曲决定，本次未替用户登录或更改会员权限。


## 悬停音量（追加）

定向分析公开安装文件 `D:/Music/Mineradio/resources/app/public/js/modules/05-playback/08-audio-graph-controls.js`（REA单文件静态证据，不读取账号数据）；人工核对 `public/css/index.css` 的 volume-control / volume-popover，以及 index.html 的volume-slider。原实现通过 hover/focus-within 显示浮层，透明跨缝命中区保证指针能从按钮移到滑杆，音量通过统一setVolume限制到0..1。

Agent Pulse复用自己的audio.volume / audio.muted和范围校验，只新增主题内的CSS浮层，透明12px过渡区域、键盘可聚焦滑杆；关闭页面随原节点释放，不新增计时/轮询或WebAudio图。未迁入参考图的淡入/淡出设置，它们不属于本次悬停调音量要求。首次静音保留原音量，恢复不会重置到默认。
