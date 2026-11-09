# v0.2.2：灵动岛透明合成链与黑矩形复核

日期：2026-10-28。本报告的分析阶段仅做静态制品分析、对应依赖源码核对及 Agent Pulse 源码审查；未启动 Terse 或测试窗口。目标是解释“Accent 3 接受设置、native region 读回成功，为什么仍有整窗黑底”，并提出可逐项验收的最小方案。Accent 属性读回本身不受支持，不能写成已读回成功。最终实施和验证另见 glass-v0.2.2-validation.md。

## 核心判断

Terse 的原生透明路径不等于给窗口加 Accent 3。此次在其机器码中找到了另一条明确路径：**空 region 的 `DwmEnableBlurBehindWindow`，用于让透明窗口的 alpha 参与桌面合成**。这与对应 TAO 版本源码的透明窗口初始化一致。

原生圆角 helper 也确认是从窗口坐标 `(0,0)` 开始，胶囊 360×44、半径 22，与整个可视窗口紧贴，不存在 Agent Pulse 0.2.1 的 10px 外围透明带。

因此，WCA Accent 3 调用成功只能证明 Windows 接收了该策略，region 读回成功只能证明窗口 region 已设置；二者都不能证明 Chromium 的最终桌面表面在 region 外保持 alpha 0。把二者的 API 成功当作视觉验收，是此前遗漏的检查层。

## Terse 原生透明分支的新证据

目标仍是本机 `Terse.exe` 1.4.2.0，SHA-256 `aa746b596565869c2eb57e5dec6c5f9462efb9cbe0e64fb3e96c3622c1a2bd22`。地址使用首选 VA，ImageBase `0x140000000`；运行时 ASLR 会改变实际地址。

制品中的依赖路径能够识别出 `tao-0.35.3`、`wry-0.55.1`、`tauri-runtime-wry-2.11.4`。本轮复用先前 LIEF / Capstone 的只读指令与 `.pdata` 函数边界结果，检查了实际参数，而非重复统计 import 名称。

### 透明初始化调用

在函数 `0x1406e2ff0` 中：

| 地址 | 指令参数与含义 |
| --- | --- |
| `0x1406e37ee`–`0x1406e3809` | 两个条件检查，决定是否进入透明初始化分支 |
| `0x1406e380f`–`0x1406e381f` | `CreateRectRgn` 参数为 `(0,0,-1,-1)` |
| `0x1406e3828` | 将 `0x100000003` 写入结构开头，即 DWORD flags 3、BOOL enable 1 |
| `0x1406e3839` | 将刚创建的空 region 放入结构 |
| `0x1406e3840` | 关闭最大化过渡项 |
| `0x1406e3854` | 实际调用 `DwmEnableBlurBehindWindow` |

另一个单态化函数 `0x1410134f0` 在 `0x141013d1f` / `0x141013d54` 具有相同的空 region 创建与调用序列。

已识别的岛构造外层函数，经直接调用关系能够到达前一通用窗口初始化函数。但该外层还负责创建其他窗口；静态连通不代替运行时条件证明。

对应 TAO 0.35.3 源码明确将这段路径放在 `transparent` 开启且 `no_redirection_bitmap` 关闭时：使用空 region、开启 DWM 的 alpha 透明基础路径，并在调用后释放临时 region。这是框架透明初始化，不应解释为启用可见的桌面磨砂。[TAO 0.35.3 Windows window.rs](https://raw.githubusercontent.com/tauri-apps/tao/tao-v0.35.3/src/platform_impl/windows/window.rs)

### 岛构造与实际磨砂调用的证据边界

在外层函数 `0x1402b5e50` 中，`0x1402b6c8b` 装入 `island` 标签，`0x1402b6ca2` 调用 builder 候选 `0x140195020`；随后 `0x1402b6ca8` 装入 `Terse Island`，`0x1402b6cc3` 调用标题 setter `0x140195d40`，`0x1402b6ce7` 调用尺寸 setter `0x140208880`，参数为 360×44。`0x1402b6e19` 调用构建候选 `0x140203830`。这些标签、参数与后面的圆角 helper 相互印证了岛的构造位置；对未带符号的 builder/build 仍保留候选标记。

外层构造到透明初始化的直接调用可达路径为 `0x1402b5e50 → 0x140114e00 → 0x1406c7910 → 0x1406c8440 → 0x1406e2ff0`。这只证明二进制中存在可达代码，不证明岛窗口的相应条件在当前设置下一定取真。

此外，已定位到真实的通用 `apply_blur` 路径 `0x14106a6f0`：较新 Windows 分支动态解析 `SetWindowCompositionAttribute`，传入 Accent State 3、Flags 2、属性 19；`apply_acrylic` 路径 `0x14106aac0` 则按 Windows 版本使用系统背景属性 38 / 值 3，或 Accent State 4。当前直接调用关系仅将二者连到通用材质 dispatcher `0x1401b46f0`，其上层为 `0x1407217c0` / `0x140729ee0`；没有找到把某种材质选择明确绑定到岛标签的直接调用。因此，不能写成“Terse 岛已证实使用 Accent 3 / Acrylic”。

与此相符，岛 CSS 最终的 `!important` 规则使 body/root 背景透明，并关闭 `backdrop-filter`；全局伪元素也关闭该 filter。较早声明的 blur 已被后续规则覆盖。这支持“最终前端为清透玻璃边缘”的解释，但仍不能单凭 CSS 排除某个运行时原生材质设置。

### WebView2 的内容 alpha

同版本 Wry 对透明 WebView 使用 alpha 为零的默认背景色，并在初始化时设置透明背景。它负责的是 WebView2 的内容层；这与原生窗口透明初始化是两个配合层。[Wry 0.55.1 WebView2 实现](https://raw.githubusercontent.com/tauri-apps/wry/wry-v0.55.1/src/webview2/mod.rs)

不能把这个 WebView2 / TAO 路径逐 API 搬到 Electron / Chromium，便认为两个框架拥有相同的合成行为。Chromium 自己管理呈现表面、子窗口和 GPU 合成链。

## 原生 region 是紧贴整个胶囊的

`island` 标签附近的调用 `0x1402b781e → 0x14009c620`，传入的 double 尺寸为 360.0、44.0、22.0。

helper 的进一步指令验证：

- 宽、高分别乘显示缩放系数，再取整为物理像素。
- 半径乘缩放系数后再乘 2，得到 `CreateRoundRectRgn` 的椭圆直径。
- 宽、高整数各增加 1，用于右/下边界的 region 范围。
- `CreateRoundRectRgn` 的左、上参数均为 0。
- `0x14009c78a` 调用创建 region，`0x14009c79c` 将它交给窗口。

这确认了 **0-origin、紧窗口边界、无 10px 外围 padding** 的原生几何。Agent Pulse 当前 500×64 HWND 内放 480×44 胶囊并从 `(10,10)` 裁剪，是不同布局。改为 tight bounds 可以消除额外边距，但仅凭改尺寸仍不能声称修复了真正的合成错误。

## WS_EX_LAYERED 与 NOREDIRECTIONBITMAP：能确认和不能确认的部分

本轮没有目标运行时 HWND，也遵守了不重启 Terse 的限制，因此没有读取到岛窗口的实际 exstyle。以下不能写成“Terse 当前一定使用/不使用某个 flag”。

对应 TAO 版本的窗口样式规则说明：

- `NO_BACK_BUFFER` 对应 `WS_EX_NOREDIRECTIONBITMAP`。
- 忽略鼠标事件时才会在该规则中附加 `WS_EX_TRANSPARENT | WS_EX_LAYERED`；透明这一属性本身并不在该处直接映射为 `WS_EX_LAYERED`。
- `no_redirection_bitmap` 的默认值为 false，但这不证明 Terse 没有在具体 builder 中覆盖它。

这些是版本源码语义，不能替代具体岛 HWND 的实时 flag 值。[TAO 0.35.3 window_state.rs](https://raw.githubusercontent.com/tauri-apps/tao/tao-v0.35.3/src/platform_impl/windows/window_state.rs)，[Windows builder 默认参数](https://raw.githubusercontent.com/tauri-apps/tao/tao-v0.35.3/src/platform_impl/windows/mod.rs)

没有找到 `SetLayeredWindowAttributes`、`UpdateLayeredWindow` 或 `DwmExtendFrameIntoClientArea` 的目标 import 字符串。这个缺失只能帮助排除某些直观路径，不能单凭它推断最终 exstyle 或排除动态解析。

特别不建议在既有 Electron HWND 上盲目翻转 `WS_EX_LAYERED` / `WS_EX_NOREDIRECTIONBITMAP` 来“模仿 Terse”。框架在创建呈现表面时已经作了相关选择；只改变一个样式位并不等于重建正确的呈现链。

## 对 Agent Pulse v0.2.1 源码的独立审查

当前 `material.cjs` 在任何模式下都先调用 `win.setShape`，Windows 下还会创建并设置原生 region；然后才根据设置决定 Accent State 是 3 还是 0。

所以当前所谓的 CSS 回退模式仍然改变了原生 region，并不是“仅使用 Electron 默认 per-pixel alpha”的隔离基线。原生 region 可能本身没有问题，但现有对照无法单独排除它、Accent 策略以及 Chromium 呈现链的交互。

黑底覆盖整个 500×64 窗口而不只是胶囊区域，与合成表面或系统效果越过内容区域的现象一致；这是根据用户截图描述和当前代码得到的工作假设，不是已经由 API 成功返回证实的唯一根因。还需要排除测试截屏器把 alpha 0 显示成黑色的情况，应以真实桌面叠加结果为准。

## 最小可验收方案

第一步应构造一个全新的、自有 Electron 岛窗口，使用 `transparent: true`、无边框、无原生阴影及 alpha 0 背景；这个对照路径完全不调用 Accent、DWM 系统背景、`setShape` 或自定义 region。窗口直接使用胶囊尺寸，例如 480×44，body padding 为 0。CSS 只画胶囊、细高光和浅 tint，窗口外没有为阴影预留的矩形空间。

这是为了回到此前已能在真实桌面上透出背景的基础路径。若纯 alpha 对照仍出现黑底，问题就在更基础的透明窗口/呈现/捕获层，继续增加原生 blur 不会提供有效证据。

基线通过后，再独立增加 tight、0-origin 的原生圆角 region，验证它有没有改变角落的桌面像素。最后才将真正的 blur 作为单独实验开关；开关前后必须使用相同背景与几何做对照。

另一条需单独创建窗口的对照路线来自 `windows-swca` 作者的 Electron 使用建议：保留 `backgroundColor: '#00000000'`，但不启用 BrowserWindow 的 `transparent`。这适合验证 Electron per-pixel 透明与 WCA 材质是否存在交互；它与上面的纯 alpha 基线是两条独立的创建路线，不能在同一个已创建 HWND 上来回改 flag 后当作等效比较。该库文档提供的是第三方库作者的一手使用经验，不是 Electron 官方保证，也没有直接证明本次黑矩形的根因。[windows-swca 的 Electron 使用建议](https://github.com/sylveon/windows-swca#tips-for-usage-on-electron)

如果真实 blur 的可见结果仍不合格，发布默认模式应保持清透玻璃边缘和正确 alpha，清楚标记实际模式；不应把会制造黑矩形的效果当作成功磨砂，也不应把纯 CSS blur 说成已验证的跨窗口桌面模糊。

## 验收方式

1. 在浅色、深色和棋盘/文字纹理背景上，看整个 HWND 四角及胶囊外边是否与原桌面一致。
2. 使用桌面层捕获做前后对照；单独 `webContents.capturePage` 的 alpha 结果不能证明 DWM 的最终合成。
3. 检查 native region 时同时记录坐标原点和 DPI，不能只记录 `SetWindowRgn` 返回成功。
4. 分别验证纯 alpha、仅 region、region + blur；不要让“关闭 blur”的对照仍保留其他未经隔离的 native 改动。
5. 展开/收起、移动、置顶切换、隐藏/显示后重复检查黑边和残影，避免只验首次静止画面。

本轮没有修改实现，也没有启动任何目标或测试窗口。上述方案需由根代理在自有 Agent Pulse 窗口完成真实视觉验证。

## 补充：系统透明效果关闭与 Windows 26200

根代理后续只读检查记录：本机 OS 为 `10.0.26200`，`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\EnableTransparency` 为 0。此处复用根代理读数；本子任务未改动设置，也未重启桌面进程。

微软官方资料明确说明，用户关闭 Transparency effects 后，SystemBackdrop 材质与 AcrylicBrush 会使用实色替代；Acrylic 文档也将透明效果关闭、电池节能和低端硬件列为回退条件。因此，当前“系统材质填满 HWND 且不透桌面”存在一个有官方依据的外部条件，应先消除该变量后再判断几何/合成实现。[Materials in Windows apps](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials)，[Acrylic material](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)

官方 `UISettings.AdvancedEffectsEnabled` 属性用于读取系统 Transparency effects 是否开启，是比单纯推断注册表语义更直接的运行时状态接口。`DWM_SYSTEMBACKDROP_TYPE` 文档则说明 transient 类型在 Windows 11 对应 Desktop Acrylic，绘制范围是整个窗口 bounds。[UISettings.AdvancedEffectsEnabled](https://learn.microsoft.com/en-us/uwp/api/windows.ui.viewmanagement.uisettings.advancedeffectsenabled)，[DWM_SYSTEMBACKDROP_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)

这些官方资料不能被扩大为“已证明 undocumented ACCENT4 在所有版本采用完全相同的回退逻辑”。本轮未找到对 Accent State 4 这一内部状态的微软公开契约。它在本机关闭透明效果时是否以及如何回退，仍应通过自有窗口的视觉对照确定。

对 Accent State 3 也需要保留版本边界：window-vibrancy 的 README 将 apply_blur 的 Windows 11 支持标为 22H1 only，并另注 22621+ 的拖动/缩放性能问题；其公开 lib.rs 注释明确的是性能差，windows.rs 仍未对 22621+ 拒绝调用。不能把这些代码写成“微软证明 22621+ 完全失效”。另一个 Electron 材质库 vibe 的作者明确记录 blurbehind 在 Windows 11 及较新 Windows 10 不工作，并建议使用 Acrylic。这是实现者的一手兼容经验，足以反对在 26200 上将 Accent 3 作为可靠默认值，但不代替本机验证。[window-vibrancy 支持表](https://github.com/tauri-apps/window-vibrancy#available-functions)，[apply_blur 注释](https://github.com/tauri-apps/window-vibrancy/blob/dev/src/lib.rs)，[vibe 已知问题](https://github.com/pykeio/vibe#known-issues)

### 用户允许开启透明效果后的验证顺序

1. 记录开启后的系统状态，确认 Transparency effects 生效；不要将写入注册表成功当作最终状态。
2. 保留相同桌面背景、同一 tight bounds 和相同内容 tint。先重新创建纯 alpha 窗口，验证四角、边缘、移动后的外部像素。
3. 在独立新 HWND 上验证 `transparent: false` + alpha 0 背景 + Accent 4 路线。状态 3 仅保留为兼容对照。每一条路线都记录实际创建参数、region、DPI 和 API 读回值。
4. 若测试系统 Desktop Acrylic，则使用独立窗口，确认系统材质是否仍越过目标圆角；不要与 WCA/透明初始化状态混用后失去可比性。
5. 在带文字或棋盘纹理的背景上用真实桌面捕获判定磨砂：背景应被模糊而非只变暗；胶囊四角外应完整露出原背景。
6. 检查不激活的常驻岛、激活岛、移动、展开收起、隐藏显示。官方资料指出 background acrylic 还可能因窗口不激活回退，常驻监控岛的实际无焦点状态尤其需要验收。

这一计划不要求再次更改用户的全局设置。若开启后仍有黑矩形，继续按创建链与形状逐项隔离；不要以系统开关已开启直接宣告玻璃实现通过。
