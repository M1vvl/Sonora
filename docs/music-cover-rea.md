# 网易云与 Mineradio：当前歌曲封面定向 REA

日期：2026-10-28。目标是为灵动岛提供随歌曲更新的真实封面；后台没有可识别音乐会话或没有封面时，继续使用当前 Agent 图标。

本报告仅只读静态分析本地制品和公开接口文档。未启动、注入、修改播放器，未读取 Cookies、账号凭据或整份用户配置。没有将播放器代码、图片、皮肤或其他资源加入 Agent Pulse 成品。

## 网易云音乐 3.1.41.205529

本地安装目录 `D:\Music\CloudMusic`。以下 SHA-256 用于固定证据版本：

| 制品 | SHA-256 |
|---|---|
| `cloudmusic.exe` | `16689d9731121f0f15116205d73a472748de932b6a848e36b55b60501cbf0ede` |
| `cloudmusic.dll` | `7f667f876caf94bc3dac3b0070d3e495117005fafdcf18b6aaa51eb004edac8c` |
| `winrt_utils.dll` | `a23c67d403e2fc031c0f040ea980bf665f064017b37cc92eafb28878d4292501` |
| 本机静态代码包 `web.pack` | `de01c3ed1642dd5f1eb49338ac2fc103cea239758a94e84c875296f95b40025b` |

### REA 确认的原生边界

实际使用 REA 6.8.0 的 `inspect-native-exports` 读取 `winrt_utils.dll`，退出码 0。证据 ID `ev_cab172b415558069b766fe99a1931a99d6e1e5a50a20ce4f38dce53f9373d4a4`，完整导出证据 `artifacts/cloudmusic-smtc-exports.json`。

导出表完整枚举为两个函数：

| 导出 | 首选 VA |
|---|---|
| `WinRTUtilsSMTCCreate` | `0x180004880` |
| `WinRTUtilsSMTCDestroy` | `0x180004910` |

另用 REA `inspect-pe-imports` 检查 `cloudmusic.dll`，结果保存在 `artifacts/cloudmusic-core-imports.json`。没有把静态导出或 import 存在等同于当前启用了此功能。

只读字符串检查提供进一步候选证据：`cloudmusic.exe` 文件偏移 `0x16ac40` 有 `Windows.Media.SystemMediaTransportControls`，`0x16ae20` 有 `SystemMediaTransportControlsDisplayUpdater`；`cloudmusic.dll` 偏移 `0x1db0f98` 有 `WinRTUtilsSMTCCreate`，`0x1db1008` 附近记录加载 `winrt_utils.dll` 失败，`0x1db1058` 附近有 SMTC title 日志模板。字符串不能单独证明实际调用，也没有据此推导私有函数的参数布局。

### SMTC 关闭的直接代码证据

本机 `C:\Users\10707\AppData\Local\NetEase\CloudMusic\web.pack` 是带自定义前缀的 ZIP；仅在内存读取其中静态 JavaScript。

`pub/hybrid/app.chunk.83304b1.js` 的字符偏移约 `3025416`，默认设置对象包含 `smtcEnable:!1`。字符偏移约 `3045315` 的 `setSmtcEnable` 链更新该设置，随后派发 `playing/onSMTCEnable`；约 `808693` 的桥接包装调用 `player.setSMTCEnable`。

`pub/hybrid/64.chunk.83304b1.js` 的约 `22104` 处有“开启SMTC”控件标签，随后明确说明开启后播放信息同步至系统菜单及第三方软件。这是原应用自身设置功能的静态证据，**不证明这台机器当前的具体开关值，也不保证每个版本有相同菜单布局**。主任务的只读 GSMTC 探针当时返回 0 个会话，与未发布系统媒体信息的情况相容；不能仅凭 0 个会话确定唯一原因。

Agent Pulse 不应通过私有桥接调用、注入或修改配置来擅自开启此设置。系统媒体会话不可见时清楚降级；如需开启第三方播放器的发布功能，应让用户知情选择。

### 不可靠的“当前歌曲”替代来源

同一 bundle 在约 `820701` 处定义 `currentPlayingList` / `lastPlayingList` 表名，约 `2438312` 定义 `playingInfo` / `lastPlaying` 存储项，约 `2976037` 出现从 LocalStorage 读取 lastPlaying 的代码，约 `2443475` 附近可见序列化/编码包装。这里只分析静态代码，没有读取这些用户值。

这些是内部持久化候选，未证明其写入频率、时序、加密格式或与实际播放状态的一致性。**历史表最新一行、队列最后一首和磁盘里最新的图片都不能当成当前歌曲。**没有可靠当前歌曲 ID 与封面映射时，应保留 Agent 图标。

## Mineradio 2.1.0

本地应用目录 `D:\Music\Mineradio\resources\app`，版本由其 `package.json` 确认。

实际运行 REA `analyze-javascript-application`，选定下表三个精确路径。退出码 0，父证据 ID `ev_09679a3e73f0cf0c104393250ea82e0c697d48808b4910e3ad849cf670b50b9e`，本地证据 `artifacts/mineradio-cover-evidence.json`。仅静态解析所选文件，不执行目标代码；其他文件未纳入关系分析，不可据此宣称能力不存在。

| 文件 | SHA-256 |
|---|---|
| `public/js/modules/03-beat/05-cover-loading-crop.js` | `21b3a012b6ae692d538e5aad41c7da9fea16ff468217df1ddc1b43c47a2df986` |
| `public/js/modules/05-playback/13-playback-start-audio.js` | `e149d843bc676da1b8a6e37db2a36a49d35f1afe7c745cf39e6cb13a81b7aa91` |
| `public/js/modules/02-visual/15-ripples-cover-depth.js` | `58862e8d906ff7a33a9e9a58552992449ddf798f4a326216f87dce749acac5e9` |

### 随歌曲更新封面的调用链

- `13-playback-start-audio.js:1066` 起的 cover-load 步骤以当前 song 查找自定义封面；否则在 `:1080` 从 `song.cover` 建立封面 URL。该请求携带当前 `trackToken`，还有同专辑切歌和无缝过渡参数。
- `05-cover-loading-crop.js:14` 的 `loadCoverFromUrl` 校验来源，异步加载图片，裁正方形，再进入 `applyCoverCanvas`。加载成功、失败和兼容重试分支都检查请求是否仍属于当前曲目。
- `15-ripples-cover-depth.js:517` 的 `coverApplyStillCurrent` 对比 `opts.trackToken` 与 `trackSwitchToken`；`:559` 起的 `applyCoverCanvas` 再递增 `coverProcessToken`，为重操作和延迟结果提供第二层过期检查。
- 同文件 `:575` 附近将上一个封面保留为过渡纹理；随后把新 canvas 赋给当前纹理并标记需要更新。`:523` 的 `setControlCoverSrc` 更新普通控件封面，空值时清除旧图。

可以借鉴的是“曲目标识 → 异步封面 → 版本检查 → 只提交最新图片”的时序策略，不能直接复制它的播放器内部状态与庞大可视化引擎。

### 旋转与系统发布的边界

`public/css/index.css:2484` 起的 `.home-disc` 为首页装饰唱片，`:2493` 设置 18 秒线性旋转；其背景是渐变绘制，**不是证明正在播放歌曲封面旋转的证据**。实际封面还参与 Three.js 场景旋转，例如 `11-main-loop.js:635` 将 backCoverGroup 的 rotation 与粒子对象同步；这也不能当作小型唱片组件的实现。

在 `public` / `desktop` JavaScript 的限定搜索中未找到 `navigator.mediaSession`、`MediaMetadata`、`artwork`、SMTC 发布代码。这个负结果不排除未搜索的依赖或其他版本存在系统集成。`startup-state.json` 经 `desktop/main.js:2100` 确认为启动阶段日志，不是播放快照；listen-sync-journal 是听歌上报去重用途，也不应充当实时当前曲目。

如果当前 Mineradio 未发布 GSMTC 封面，第三方没有可靠只读当前封面来源时，Agent Pulse 应降级为 Agent 图标。不能仅因进程名存在而展示固定封面或从历史缓存猜歌。

## Agent Pulse 的实现建议

使用单独、只读的 Windows GSMTC 媒体模块：识别音乐应用会话，优先正在播放的会话，以 MediaPropertiesChanged 等事件触发获取标题和 Thumbnail。官方将 Thumbnail 定义为当前媒体关联缩略图的流引用；属性变化事件用于感知切歌。[Microsoft Thumbnail](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmediaproperties.thumbnail)、[Microsoft MediaPropertiesChanged](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession.mediapropertieschanged)

- 歌曲身份、应用身份和请求代次分别记录；旧图片加载晚到时丢弃，禁止覆盖新歌封面。
- 封面限尺寸、限字节；只在图片变化时发送到 UI，不并入 20Hz 音频帧或完整 Token 快照。
- 播放时旋转，暂停时停在当前角度；关闭播放器、会话消失、封面无效或加载失败时回到当前 Agent 图标，不残留上一首封面。
- 旋转与图片加载使用独立显示层，不能被原有 Agent 快照渲染每秒替换。保留原按钮语义和点击整岛展开。
- 尊重减少动态效果；用户明确请求连续旋转时，可提供应用内可选策略，不修改 Windows 全局设置。

本报告不把静态研究当作本机最终功能验收。实际系统会话、真实封面、切歌与退出回退应由成品单独验证。
