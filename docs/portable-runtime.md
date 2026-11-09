# 便携包与全新用户运行核查

目标交付为 Windows x64 便携 EXE。Electron 运行时、应用 JavaScript、hls.js、HTML 规则解析器和原生音视频组件均随包提供；用户不需要安装 Node.js、Docker、Kazumi、LibreTV 或开发工具。

## 实际运行路径

| 能力 | 随包内容 | 首次运行数据 |
|---|---|---|
| 监控 | `src/monitor.cjs` 等；Electron 自带 Node 运行时 | 读取新用户本机存在的 Codex/Claude 日志；没有日志时为空 |
| 番剧 | `src/anime/default-rules.json` 的 18 条规则与解析模块 | Kazumi 本机规则只用于可选导入；不存在时直接使用随包规则 |
| 影视 | `src/movies/` 模块及 4 个默认非成人源配置 | 独立新建影视偏好和观看历史，不读取开发者 LibreTV 源码目录 |
| 原生视频 | `resources/native/player/AgentPulse.Player.exe`、`libmpv-2.dll`、9 个 Anime4K GLSL | 播放时按需启动，不要求系统安装其他播放器 |
| 音频与封面 | `resources/native/audio/AgentPulse.AudioProbe.exe`、`resources/native/media/AgentPulse.MediaProbe.exe` | 使用目标 Windows 的 WASAPI / 系统媒体会话；不要求播放器安装路径与开发者相同 |
| ECH | `resources/native/ech/ech_http.dll`、解包的 Koffi 绑定 | 原生模块按需加载，没有外部 Dart / Flutter 运行时要求 |

所有偏好、面板状态与历史放在目标用户的 `%APPDATA%/Agent Pulse`。软件包不应包含开发者账号、日志、真实偏好或私有观看记录。`resources/corresponding-source.zip` 是应用源码与构建资料，不是运行依赖。

## 已检查

- `tests/portable-bundle.test.cjs` 在独立临时目录、指定不存在的 Kazumi 安装规则路径启动番剧模块，并启动影视模块；无需网络调用即可取得 18 条番剧规则、4 个默认影视源和空历史。
- 依据构建配置核对数据默认值、播放器/音频/媒体 helper、ECH、libmpv、9 个着色器和第三方许可文本都由应用包或 `extraResources` 覆盖。
- 对两个复用 DLL 的 PE 导入表做静态核对：`ech_http.dll` 只导入 Windows 系统 DLL；`libmpv-2.dll` 只导入 Windows 系统 DLL 和系统 API-set/UCRT。未发现需另装的 `vcruntime140.dll`、`msvcp140.dll` 或 Kazumi/LibreTV 运行库。两者均为 x64。
- helper 使用 .NET Framework 编译；编译器仅供开发/打包时使用，发布时携带编译后的 EXE。实际运行使用目标 Windows 的 .NET / WinRT / 音视频系统组件。

## 适用边界

此核查覆盖全新应用数据目录与静态本地依赖，不等同于已在每一种干净 Windows 虚拟机、显卡和企业安全策略下实测。最终成品仍需跑正常启动、原生组件、播放器和跨进程续播诊断。

影视搜索与播放依赖第三方服务和目标用户网络。默认配置免手动部署，不能保证所有第三方来源永久可用；失败应在软件中显示、隔离并允许换源，不能伪造可播放结果。Docker / Next.js 服务部署是 LibreTV 网站的交付方式，不是本桌面软件用户的前置步骤。
