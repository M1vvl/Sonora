# Kazumi Windows 播放器与超分辨率定向分析

分析日期：2026-10-29（Asia/Shanghai）。目标限定为用户提供的 Windows 2.4.2 安装目录及配套源码；不迁移 Android、iOS 和 macOS 的平台实现。

## 证据与对应关系

本次使用缓存的 REA 6.8.0 CLI，对原装 `libmpv-2.dll` 执行只读导出表分析。完整记录在 `artifacts/kazumi-rea/mpv-exports.json`：

- 格式：Windows amd64 PE，38,735,640 字节。
- SHA-256：`c9ceefa4b313f4081ae42554837950dd28f319990eeb332e654b848c5eaee584`。
- 导出 54 项，包含 `mpv_create`、`mpv_initialize`、`mpv_command`、`mpv_set_property`、`mpv_get_property`、`mpv_wait_event`、`mpv_terminate_destroy` 及 render API。
- 限制：导出表只能证明这些符号存在，不能证明播放、GPU 编译或超分辨率已经运行。

另用独立的、有界原生调用读取 `mpv_client_api_version()`，返回 131077，即客户端 API 2.5。该检查没有加载视频、创建播放器界面或执行着色器。记录在 `artifacts/kazumi-rea/mpv-client-api.json`；这是普通原生函数观察，不能与 REA 静态 Evidence 混称。

九个 GLSL 文件同时比对源码目录与 Windows 发行版 `data/flutter_assets/assets/shaders`。原始字节哈希不同，原因是 LF/CRLF 行尾差异；统一行尾后九个文件内容全部相同，未发现卷积系数或渲染 pass 差异。`artifacts/kazumi-rea/shader-identities.json` 保留两侧哈希和逐文件结果。

## 超分辨率实际实现

源码位置：

- `lib/pages/player/controller/player_super_resolution.dart`：枚举、中文名称与持久化值。
- `lib/utils/constants.dart`：两套有序 Anime4K 文件链。
- `lib/pages/player/controller/player_playback_controller.dart` 的 `setShader`：通过原生播放器 `change-list glsl-shaders` 切换链。
- `lib/services/shaders/shader_asset_service.dart`：将打包的 GLSL 资源复制为原生播放器可访问的外部文件。
- `lib/utils/media.dart` 的 `buildShadersAbsolutePath`：Windows 使用分号连接绝对路径。

| UI 档位 | 原持久化值 | 原生操作 |
| --- | --- | --- |
| 关闭 | 1 | `change-list glsl-shaders clr ""` |
| 效率档 | 2 | 用以下效率链替换完整列表 |
| 质量档 | 3 | 用以下质量链替换完整列表 |

效率档保持七个文件的原始顺序：

1. `Anime4K_Clamp_Highlights.glsl`
2. `Anime4K_Restore_CNN_M.glsl`
3. `Anime4K_Restore_CNN_S.glsl`
4. `Anime4K_Upscale_CNN_x2_M.glsl`
5. `Anime4K_AutoDownscalePre_x2.glsl`
6. `Anime4K_AutoDownscalePre_x4.glsl`
7. `Anime4K_Upscale_CNN_x2_S.glsl`

质量档保持六个文件的原始顺序：

1. `Anime4K_Clamp_Highlights.glsl`
2. `Anime4K_Restore_CNN_VL.glsl`
3. `Anime4K_Upscale_CNN_x2_VL.glsl`
4. `Anime4K_AutoDownscalePre_x2.glsl`
5. `Anime4K_AutoDownscalePre_x4.glsl`
6. `Anime4K_Upscale_CNN_x2_M.glsl`

这些是包含固定卷积权重的多阶段 GLSL 处理。配置到播放器后，GPU 还需要成功编译并执行。上游说明，链中的文件顺序有意义，CNN 规模会影响处理成本；对特定片源过度处理也可能引入振铃等失真，不能承诺所有视频的质量档都更合适。[Anime4K 官方高级说明](https://github.com/bloc97/Anime4K/blob/master/md/GLSL_Instructions_Advanced.md)

## 播放画面与控件

`lib/pages/player/player_item_panel.dart` 将桌面控件分成顶部和底部：顶部返回、片名与集数、截图、画中画和其他菜单；底部进度、播放/暂停、时间、超分辨率、倍速、画面比例、选集及全屏。弹幕和一起看分别依赖其他服务，不能仅复制按钮就声称功能已迁移。

原 `PlayerAspectRatio` 实际提供自动（contain）、裁切填充（cover）、拉伸填充（fill）和 4:3。Agent Pulse 保留这些模式，并增加明确的 16:9 选项；16:9 是本次适配的扩展，不称为 Kazumi 原有菜单项。原倍速为 0.25 至 3.0、每档 0.25。

原截图控制器在捕获后检查当前视频身份，再进入有界候选列表；最多 24 张或 96 MiB。该身份检查可以避免切集后将新视频画面记录为旧标题。0.3.9 按用户新要求删除 Agent Pulse 的产品截图按钮、控制动作及原生截图命令；验证像素仅由显式诊断模式的内部接口完成，正常播放器不能调用该接口。

原 Kazumi 有画面亮度交互；本次增加的亮度、对比度、饱和度和 gamma 原生数值控制属于桌面适配。mpv 为这些画面属性提供 -100 至 100 的范围，具体支持取决于输出驱动。嵌入 Windows 窗口可使用 `wid`，让原生视频窗口依附宿主 HWND；这些能力来自播放器原生接口。[mpv 官方手册](https://mpv.io/manual/stable/)

## Agent Pulse 模块边界

- `src/player-settings.cjs`：独立偏好、有限枚举、数值校验及原始着色器链。默认关闭超分辨率、1×、100 音量、不静音、自动适配画面。`preview()` 仅校验，`save()` 原子持久化，不触发监控重建。
- `src/player-resolver.cjs`：无 Node/preload 的远程页面解析，独立网络会话与取消路径。
- `src/player-host.cjs`：在既有监控面板中创建、布局和移除隔离的 WebContentsView；0.3.9 起播放覆盖全界面与右侧竖轨，返回时恢复原 DOM。
- `src/native-player/` 与 `native/player/`：固定原生组件路径、有限 JSON 协议、实际视频输出及生命周期。
- `ui/anime-player/`：控件、菜单、进度反馈及布局；原生视频区域单独上报物理像素坐标。
- `src/anime-player.cjs`：组合上述模块，并对打开、返回、切集、超时和异步命令进行身份检查。

播放器失败时，兼容播放可以继续承担普通视频；兼容路径应禁用并说明不支持 Anime4K，不能保存一个表面开启的超分状态。返回番剧列表或切换主导航时应停止播放并释放原生进程，不留下可见的额外播放器窗口。

## 验证标准和当前已核对项

设置模块三个单元检查已通过：原始链的有序性与不可变性、非法枚举/非有限数值拒绝、预览无写入与持久化往返。后续成品验收还需实际执行以下检查，不能用设置保存成功替代：

1. 同一视频和时间点切换关闭、效率、质量，再关闭，核对原生着色器列表与视频持续播放。
2. 获取原生 `vo-passes` 中的 Anime4K pass 名称和执行信息，并结合处理后截图检查。仅文件名列表证明“配置已加载”；`vo-passes` 才能提供活跃渲染阶段的信息。[mpv 渲染 pass 文档](https://mpv.io/manual/stable/#properties)
3. 检查无图像、视频解析失败、原生组件不可用时的兼容行为，超分开关不能报假成功。
4. 快速切集、返回期间解析完成、调节过程中关闭、宿主关闭、全屏与缩放后的原生区域位置。
5. 暂停/继续、拖动进度、倍速、音量、静音、画面比例和截图对应真实播放器状态。
6. 打包后使用资源目录的原生库与着色器重复检查，并核对退出后的进程、句柄和窗口释放。

不根据“质量档”名称推断性能，不承诺固定帧率、显存占用或画质增幅；必须在本机实际片源、窗口大小和 GPU 条件下测量。

## 0.3.9 控件显隐与画面几何适配

本次进一步阅读 `player_item.dart` 的 `showVideoController`、`hideVideoController`、`acquirePlayerPanelHold` 与 `player_panel_hold.dart`。Kazumi 使用统一可见性状态及一次性保持对象；菜单打开、进度拖动和控件区域悬停会延后隐藏，释放后重新计时。不是为每个按钮设置一个持续轮询。

Agent Pulse 的 `chrome-visibility.js` 将该职责独立为一份上下栏共用的状态机：视频静止 2.5 秒、离开应用 150ms，拖动和菜单使用命名 hold。Windows 原生视频 HWND 不属于 DOM，DOM 无法可靠收到其鼠标移动，因此在既有 4Hz helper 检查中只发送坐标/所在区域变化的小通知，通过独立 `anime-player:pointer` 通道到达该模块。不为显隐新增后台轮询，也不把指针消息混进历史保存或 Token 快照。

`player_item_surface.dart` 使用 `Video(controls: NoVideoControls, fit: aspectRatioMode.fit)`；`player_aspect_ratio.dart` 默认 `BoxFit.contain`，裁切与拉伸由用户明确选择。对应修复为：普通窗口和全屏的 WebContentsView 均覆盖完整 client area；不再扣除 72px 导航或 16px 顶部；隐藏控制栏后原生视频视口跟随释放空间，默认 `video-aspect-override=-1`、`panscan=0`。真实 `video-out-params` 和 `osd-dimensions` 用于核对源比例与显示区域。自然宽高比黑边和片源中已编码的黑边属于不同问题，本次不通过默认裁切掩盖它们。

## 许可证

Anime4K GLSL 的原始 `LICENSE` 为 MIT，版权所有者 `bloc97`，2019。随原始九个文件一起保留该许可。Kazumi 适配代码依其 GPLv3 保留来源；原装 libmpv 的构建身份与许可证说明也应随成品保存，不删除上游通知。
