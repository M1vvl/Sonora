# 0.3.20 Wallpaper Engine 与内存管理定向适配

## REA 范围

对本机 MineRadio 的以下五个文件进行 REA 6.8.0 只读 JavaScript 分析，5 个文件完整解析，0 个语法失败。其余 2,067 个文件未在本次分析范围内，不将静态发现称为整个 MineRadio 功能的运行验证。原始证据在 `artifacts/v020-wallpaper-memory-rea/evidence`，摘要在同目录 `summary.json`。

| 原模块 | SHA256 | 采用思路 |
| --- | --- | --- |
| `desktop/wallpaper-engine-library.js` | `9ef95d0cbacf43fbefc3a67776ece3a98f5d0570eec659fadad0ecf984950a35` | Steam 库和创意工坊项目识别、project.json 类型和公开属性 |
| `desktop/wallpaper-engine-runtime.js` | `e76d4304266fd8375d3db13bfb2d38228de176e7f9797a929bcc34756419ffe3` | 原生引擎独立窗口、公开 CLI 控制、会话生命周期 |
| `desktop/app-memory.js` | `d05e7e5df1aacbcae0fcdfc85b7542983a03784362dc320262998af0eb3623ee` | 当前应用进程工作集释放 |
| `desktop/system-memory.js` | `6e39cdb42a56a09d1a5fd8667c8f2875aa61bf5dfe5e49fa34b8dd1e8acbcc78` | 状态/阈值/定时逻辑与应用释放范围的区分 |
| `public/js/modules/00-state/11-system-memory-controls.js` | `a1ea0c7439e7c921e2e1116bcae97055381f63e01c412251c8155f3229133159` | 用户偏好、后台触发和明确反馈 |

原生 Wallpaper Engine 无须拆解或再分发二进制：用户已有正版引擎，通过官方 CLI 和项目描述实现联动。没有改写其已安装文件、解包场景或读取账号凭证。

## 实际模块边界

- `src/music-visual/media.cjs`：图片、视频、Web 和 Scene 项目识别、最多 128 条本地引用、公开属性白名单和原子保存。媒体不复制到 Agent Pulse；路径仅保留在主进程配置，renderer 收到不透明 ID/协议地址。
- `engine.cjs`：Steam 库发现、有效 Skutta Software 签名校验、原生独立窗口创建、特定窗口捕获和关闭。只操作随机 nonce 命名的独立窗口，不改变现有桌面壁纸、不终止用户已有引擎。
- `files.cjs`：真实路径边界、符号链接越界拒绝、MIME、字节 Range 和原子写入。
- `memory.cjs`：真实系统/应用统计、应用工作集释放、用户定时偏好。只从 Electron 当前应用 metrics 和本进程取得 PID，调用方不能传入任意 PID。
- `index.cjs`：有限动作路由、捕获授权和销毁组装；UI 的背景/歌词/音频分析仍由原播放器及视觉模块负责。

本地协议只允许已登记项目根目录内的资源，拒绝目录穿越和不支持类型。最多 32 个媒体流，每流转接队列按字节限为 128 KiB，取消请求或销毁模块会主动关闭流。没有整段视频或歌曲 RAM 缓存。

Web 项目运行在不带同源权限的沙箱 iframe，禁止摄像头、麦克风、显示捕获、远程网络和嵌套 frame。兼容 `wallpaperRegisterAudioListener` 与 `wallpaperPropertyListener.applyUserProperties`；仅接收父页带项目 token 的有界消息。并非完全复刻 Wallpaper Engine 的全部 Web API/第三方网络插件。

公开属性支持 bool/slider/combo/color，slider 限定项目范围，color 在 UI 使用 `#rrggbb`，在原生/兼容 Web 桥使用 0–1 的 RGB 三元组。最多 32 项已选属性保存在配置；重新导入同一项目、退出重启后恢复。Scene 未启动或已隐藏时仍保存属性，不声称已应用；下次启动对应场景时应用保存值。

## 本机原生验证

用户补充的 `D:/Table/Wallpaper Engine：壁纸引擎.url` 指向 `steam://rungameid/431960`。从 Steam 配置找到 `D:/Game/steamapps/common/wallpaper_engine/wallpaper64.exe`，Authenticode 有效发布者为 Skutta Software GmbH。

使用已安装的默认 `deep_space/project.json`，通过公开 `openWallpaper -playInWindow` 创建唯一原生场景窗口，并以主应用自己的 WebContents 主 frame 申请一次视频捕获。捕获租约有效期 15 秒，取得后即消费；请求只允许 video，不提供整屏来源，核对窗口标题、HWND、PID 对应的签名引擎路径。

2026-11-01，`scripts/check-wallpaper-native.cjs --root <项目目录> --output artifacts/v020-wallpaper-native-final`：10/10 检查通过。实际视频 800×450，0 条音轨；16:9 抽样 14,400 个像素均非黑，900ms 前后画面绝对差值 71,658，证明原生场景确实推进。结束后已关闭此独立会话；诊断 BrowserWindow 始终隐藏。未采集桌面截图或保存用户壁纸像素。

该脚本同样接受 `--root <app.asar>`，供成品验证。它依赖本机安装有效引擎；其他用户未安装正版引擎时，Scene 明确显示需要原生引擎。独立图片、视频与兼容 Web 背景不要求安装引擎。

## 保存与内存范围

`music-media.json` 只保存项目路径引用、选择和公开属性；`music-memory.json` 保存定时/阈值偏好，均独立原子写入，不写入音乐凭证。源码单元验证了独立模块重建后的恢复，旧运行期不透明 URL 在重启后失效。

自动释放默认关闭。启用后间隔 5–180 分钟、阈值 50–98%，可限制仅应用处于后台时执行。释放最多 32 个当前应用进程的可回收工作集；不清理全系统修改页/待机页，不弹管理员窗口。读取系统内存情况与释放整台电脑内存是两件事，界面不把后者冒充已支持功能。

隔离诊断中仅对诊断 Node 自身执行 EmptyWorkingSet，1/1 成功；当时工作集从 40,292,352 B 降为 1,716,224 B。该数字只是一次工作集测量，不能作为提交内存下降比例或日常性能承诺，重新使用页面时内存可能重新进入工作集。

最终相关单元检查：`music-visual-backend`、`music-visual-settings`、`music-bridge` 共 20 项通过，涵盖恢复、路径边界、颜色转换、授权单次消费、启动中取消、媒体流关闭和应用 PID 范围。

## 明确限制

- 真实运行已验证当前默认 Scene；没有验证用户订阅的每个场景包，第三方场景可能需要缺失资源/特定引擎版本。
- Scene 使用已安装原生引擎绘制，再把专属窗口画面呈现在 Agent Pulse 中；不是把专有引擎移植为网页，也不随软件分发引擎。
- 只做已列出的公开属性与 Web 音频桥适配；不声称每项 MineRadio 专有设置、Steam 订阅管理或摄像头交互已经迁移。
- 内存释放针对当前应用的工作集。系统级待机页、修改页清理和提升权限功能未迁移，不能显示为可用开关。
