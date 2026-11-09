# 0.3.21 歌单架、详情与沉浸页面接线核对

2026-11-02。依据用户要求，本轮以 MineRadio 已发布模块及其提供的源码为依据，不使用 Apple Design skill。没有读取或复制 MineRadio 的账号凭证，没有使用鼠标自动操作。

## 证据与适配边界

- 已有 REA 结果：`artifacts/v021-shelf-rea/summary.json`，原始证据在同目录 `evidence/`。
- 发布模块目录：`D:/Music/Mineradio/resources/app/public/js/modules`，目录 SHA-256 为 `88021417aa5c80e1119a046d368f4bcece72ff339d5076ba1651651276dabdcc`。
- 该次 REA 只解析了指定的四个 JS 模块；清点视图含 107 项，另有 99 个源文件未进入语义分析。它是静态证据，不能证明全部功能运行等价或视觉逐像素相同。
- 本轮另直接阅读用户提供的 `C:/新建文件夹/DownLoad/Mineradio-paused-main/Mineradio-paused-main/public/js/modules`，重点核对如下模块。

| 模块 | 使用的原思路 | 源文件 SHA-256 |
|---|---|---|
| `04-shelf/01-manager-core.js` | `centerTarget/centerSmooth` 连续位置、可见窗口、距离衰减、唤出 smoothstep 与分层延迟 | `6a4320ea05fccdfe9f5df139b3dc5eba65f61ccbe0a07b642fae266ab19ad351` |
| `04-shelf/03-content-list-manager.js` | 歌单详情同一立体场景展开、歌曲行选中与实际播放/收藏/排队、详情入场及指针视差 | `67c969eda5d56ef8aa153bbcfb28a2f294fe17acbe393679d2fb56400085b05e` |
| `07-fx/07-bindings-shelf-immersive.js` | `shelf*` 参数与各自外观/动效职责 | `07e41c68b853a1f0665b1123ecbdc1b17181dc3f1b77904f52023b644b46a6a7` |
| `01-scene/01-orbit-free-camera.js` | 不限制水平角度、俯仰限制为 ±0.45π、复位和交互避让 | `83bb1ced884b068b3c2d92b3b86aab2800ca9830ff6c29bf128f1b1c59754714` |

Agent Pulse 的歌单架仍使用已有的 DOM/CSS perspective 适配层，未嵌入第二套 Three.js 歌单运行时。保留七张邻近卡片节点，对滚轮输入使用临界阻尼弹簧，不复制原版每帧固定 0.16/0.18 的插值系数，以避免不同刷新率下速度改变。外观与行为的适配不能称为原 Three.js 场景逐像素 1:1 复刻。画布预设及 Wallpaper 引擎由各自独立模块负责。

## 逐项核对

| 用户要求 | 当前落实位置与行为 |
|---|---|
| 右键直接开/关立体歌单，去掉原多项右键菜单 | `immersive.js` 的 contextmenu 直接 toggle；无额外菜单点击步骤；账号浮层和输入控件内不截获 |
| 歌单架放右侧、卡片缩至原来的约 2/3 | `playlist-stage.css` 基准卡片 360×127，右侧舞台；用户尺寸参数在此基础上作用 |
| 上方不要“我的歌单 / 当前队列”栏 | 沉浸 stage 隐藏原 library header，一级常规音乐侧栏保留 |
| 避免遮挡歌词、禁用左侧入口 | shelf-open 时歌词留出右侧空间，小窗口降低背景歌词交互；沉浸页 edgeEnabled=false，返回主页恢复 |
| 连续滚动、可反向打断、不重建全部卡片 | `playlist-stage.js` 保留 key→DOM 映射；浮点 position/target/velocity；pointerdown 即停止旧弹簧，滚轮可立即反向 |
| 详情为立体歌曲列表，按钮有效 | 同一 stage 的 createDetails；播放、喜欢、enqueue、收藏调用现有业务；收藏仅列本人可写歌单 |
| 账号浮层不再空白或阻塞后台交互 | immersive.setAccountOpen 关闭 DIY/歌单架，暂停视觉与歌词，单独 inert 背景交互区域，不 inert 登录浮层本体 |
| 舞台 360° 旋转 | 背景左键拖动将不限范围 yaw 与受限 pitch 交给 visual.setOrbit；按钮、输入、播放器、歌单架、DIY 面板不启动 orbit |
| MineRadio 风格沉浸播放条 | 引用共用 immersive-transport，将原节点搬入/移回；不创建第二个 audio；实际音量、队列、喜欢、收藏等继续调用已有播放器 |
| 渐进歌词 | 通过 lyrics.createView 复用同一时间轴投影；返回/遮挡/退出有明确停用路径 |

## 已接入的参数

`library.configure({appearance: settings}) → stage.updateSettings(settings)` 不复制账号或目录状态。

- `shelfSize / shelfOffsetX / shelfOffsetY / shelfOffsetZ / shelfAngleY / shelfOpacity / shelfBgOpacity`：整体尺寸、右侧位置/深度、转角及卡片透明度。
- `shelfDetailOffsetX / shelfDetailOffsetY / shelfDetailOffsetZ / shelfDetailScale / shelfDetailAngleX / shelfDetailAngleY / shelfDetailRowGap`：详情位置、缩放、俯仰/水平角和歌曲间距。
- `shelfDetailOpenDuration / shelfDetailCloseDuration / shelfDetailRowDuration / shelfDetailIntroStrength / shelfDetailParallax`：详情进入与退出时间、行展开及滚动阻尼、入场幅度和真实指针视差。
- `shelfSummonOpenDuration / shelfSummonCloseDuration / shelfSummonSlide / shelfSummonStagger / shelfSummonScale / shelfSummonParallax`：唤出、退出、滑动、层间延迟、缩放与指针视差。
- `shelfCameraEnterSpeed / shelfCameraExitSpeed`：在 DOM perspective 适配层中控制相应进入/退出速度，默认 .24 对应时间倍率 1；不是独立的原 Three.js 摄像机跟拍实现。
- `libraryDynamic=false` 或系统减少动态效果时直接显示终态、停止弹簧，不留下透明卡片。`libraryMode=off` 禁止右键唤出。手动右键 toggle 优先于旧的移开自动隐藏选项，符合用户本轮明确要求。

## 资源与竞态

- 稳定后无常驻 stage RAF。隐藏、pause、dispose 清除 RAF 与滚轮吸附定时器。
- 正常关闭先暂停 stage，保留最后 DOM 完成 CSS 淡出，再清理；重开取消旧退出清理并接续入场。离页和销毁立即释放，不让关闭动画拖延后台资源。
- 目录请求有代次校验。关闭、账号变化、tab 切换后的迟到结果不能重新打开或启动旧歌单播放；加载失败不会复用上一歌单歌曲。
- 同 ID 元数据更新只更新该卡内容，保留节点与当前位置；详情最多 1000 首、歌单最多 500 条，实际同时保留至多七张卡片。
- 原播放器、账号和侧栏通过 marker portal 返回原位置。全屏只退出本页打开的全屏；Esc 优先退出全屏。

## 验证

`node --test tests/music-library-ui.test.cjs tests/music-stage-motion.test.cjs`：12/12 通过。

新增针对真实风险的四项验证：弹簧中途反向且保留 DOM、同 ID 元数据/设置更新与减少动态效果、隐藏/销毁取消帧与吸附、退出动画保留与重开打断/迟到目录不复活。静态语法检查覆盖 immersive/library/playlist-stage。实际生产 Electron 的隐藏隔离 UI 验证由根任务统一执行；本文件不把静态 REA 结果冒充运行验证。

## 后续集成复核

额外只读核查 `immersive-transport.js/css`，未修改这两份根任务文件。新增 `tests/music-immersive-integration.test.cjs`，与上述两个文件合计 **16/16** 通过；生产 `check-music-v021` 仅由根任务运行，没有并发启动。

- 用真实 player 的节点验证 transport 激活两次不会复制 audio 或按钮，退出返回六组节点的原 parent/前后相邻节点；随机、下一首、喜欢、静音继续走原委托事件。
- 确认歌词开关、镜头复位、全屏和视觉设置均有回调接线；DIY 设置按钮打开时同步 `aria-pressed`。
- 修复关闭动画期间再导航退出的竞态：immediate deactivate 现在立即取消旧动画并返回 portal，不等 360ms。销毁显式取消剩余 WAAPI。
- 修复全屏 IPC 迟到结果：页面已退出后返回 `fullscreen=true` 会补发退出，不遗留隐藏页面全屏；拒绝的 IPC 由控制器处理。
- 已关闭页面的迟到视觉偏好不会再次读取背景封面。账号遮挡时停止舞台/歌词，账号节点本身不设置 inert；解除后恢复。背景可拖过 360°，播放器按钮拖动不会改变镜头。

本轮核查的实际差异仍需保留：

1. 播放条是依据原 `#bottom-bar/#controls` 的 DOM/材质适配，并非复制 MineRadio 的全部播放器业务。原 Agent Pulse 音源、权限判断与队列继续使用自己的模块。
2. 歌单架和详情使用 CSS perspective；原版 Three.js 摄像机跟拍、场景与卡片相互遮挡、细节纹理绘制没有完全相同的实现。27 个设置可实际改变适配层，但不能因此声称逐像素等价。
3. `shelfCameraEnterSpeed/ExitSpeed` 当前映射为适配层进入/退出速度，并不是原版独立自由摄像机。用户要求的中央视觉舞台旋转已接到 renderer.setOrbit；歌单 DOM 本身不随中央舞台旋转。
4. 右键手动开/关优先于旧的移开自动隐藏设置；原复杂上下文菜单和歌单架顶栏按用户要求删除。这是有意的产品差异。
5. 沉浸播放条使用原参考的单行控件构成，原播放器评论按钮仍属于一级常规音乐界面，未加入此单行条。正式风格/像素比对及 Wallpaper 引擎实际场景的验证由根任务和相应模块分别负责。
