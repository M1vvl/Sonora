# 桌面灵动岛与 Liquid Glass：原生材质和交互研究

核查日期：2026-10-28。本文只读研究 Apple、Microsoft、Electron 和 Tauri 维护者的一手资料，未启动 GUI、测试背景窗口或屏幕采集，未修改实现。下面区分资料已证实的能力、当前产品事实和建议方案。

## 先明确要实现的三种能力

| 能力 | 实际含义 | Agent Pulse 当前 CSS 能否提供 |
| --- | --- | --- |
| 真透明 | 桌面其他窗口能穿过胶囊的透明像素被看见，角落没有矩形底板 | Electron 逐像素透明窗口可以；必须整个根页面透明 |
| 真桌面磨砂 | 用户移动胶囊或背后窗口时，背后真实内容持续被系统模糊 | 仅 CSS 不能；需要操作系统合成器/原生宿主 |
| 光学折射 | 背后实际图像在玻璃边缘发生可观察的弯折、位移或透镜放大，且随运动变化 | CSS 高光不能；需要 Apple 原生材质或可采样背景的专用渲染路径 |

Electron 官方明确说明网页的模糊滤镜不能模糊窗口后面的其他应用。半透明渐变、边缘高光和 inset shadow 可以建立玻璃外观，但不能据此标注“原生桌面磨砂已启用”。[Electron Custom Window Styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)

## Apple 的真实做法：材质与状态共同工作

### Dynamic Island 不等于透明玻璃

Apple 的 Live Activities 指南把系统岛分为 compact、minimal、expanded 等展示。单活动使用紧凑视图；多活动可以使用更小的独立展示；长按查看扩展内容，点击进入对应应用详情。指南还明确系统 Dynamic Island 中的活动背景是黑色不透明，不能任意自定义各岛形态的背景。因此，本项目应借鉴它的实时状态与形态切换，并单独采用玻璃材质，不能把两者混为同一个系统效果。[Apple Live Activities HIG](https://developer.apple.com/design/human-interface-guidelines/live-activities/)

### Liquid Glass 不是固定透明 PNG

WWDC25 展示的材质会根据底层内容和交互调整光学效果。它包含实时 lensing、反射、散射和内容可读性的适配，外观与运动共同设计。Regular 与 Clear 有不同用途；更通透的 Clear 需要局部压暗等可读性支持。把灰底换成蓝底、固定一条白色高光，仍然只是视觉近似。[Apple WWDC25：Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)

Apple 自定义视图使用 `glassEffect`，可指定形状、tint 和 interactive；`GlassEffectContainer` 用于组合多个玻璃表面并支持形态融合。这些是 Apple 平台原生能力，不是 Windows 上可直接调用的跨平台 CSS 库。[Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)

## Windows 上各条路线的边界

### 1. 现有 Electron：透明基线可靠，整窗系统材质需单独验证

`BrowserWindow({ transparent: true, frame: false })` 配合透明根页面提供逐像素透明。根节点不能铺实色，窗口边界应紧贴胶囊，避免把外围 padding 也当成原生材质区域。透明像素的点击穿透不会自动成立，不能仅靠 CSS 圆角推断命中区域已经同步。[Electron 透明窗口](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)

`setBackgroundMaterial('acrylic')` 是另外一层能力：它要求 Windows 11 22H2 及以上，对整个 HWND 及非客户区设置系统背景。这个 API 的契约没有承诺“把 Chromium 透明窗口中的任意 CSS 胶囊变为独立 Acrylic 表面”。[Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window#winsetbackgroundmaterialmaterial-windows)

Microsoft 对 `DWMSBT_TRANSIENTWINDOW` 的定义也是整窗 Desktop Acrylic；`MAINWINDOW` 对应 Mica，后者不是透过当前其他窗口的磨砂材质。官方枚举支持基线为 Windows 11 build 22621。[DWM_SYSTEMBACKDROP_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)

**工程判断：**此前出现灰矩形，说明原生系统背景覆盖区域、Chromium 表面 alpha、窗口裁剪或系统回退至少有一项未形成预期组合。仅有 API 返回成功无法证明画面已磨砂；继续调 CSS alpha 不能修复原生底层矩形。这个判断是对当前症状的诊断假设，不是已完成的底层原因定位。

### 2. ACCENT / Tauri：确实调用原生，但不自动解决 Chromium/窗口组合

Tauri 维护的 `window-vibrancy` 源码显示：新版 Windows 的 `apply_acrylic` 使用系统 backdrop type；旧系统走 Accent acrylic；`apply_blur` 走 Accent blur。该仓库公开了 Windows 版本与拖动/缩放性能限制。换 Tauri 可以改变宿主结构和部署方式，但如果仍调用同一个整 HWND DWM 路径，就不能保证灰矩形和裁剪问题自动消失。[window-vibrancy 维护者说明](https://github.com/tauri-apps/window-vibrancy)、[Windows 实现源码](https://github.com/tauri-apps/window-vibrancy/blob/dev/src/windows.rs)

尤其不能把老 `DwmEnableBlurBehindWindow` 当成现代 Windows 的通用修复：Microsoft 明确记载它从 Windows 8 起不再产生该模糊效果。[DwmEnableBlurBehindWindow](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmenableblurbehindwindow)

WebView2 的透明背景只是浏览器内容背景的设置；原生合成模式另有 `CoreWebView2CompositionController`，还需要宿主负责视觉树和输入转发。单独把 HTML `background` 清空，不会创建桌面模糊。[WebView2 API 概览](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/overview-features-apis#rendering-webview2-using-composition)

### 3. 推荐原生路线：只替换灵动岛宿主，保留 Electron 主面板

Microsoft 当前材料指南严格区分：`AcrylicBrush` 只模糊应用内部；`DesktopAcrylicBackdrop` 显示实时的桌面背景模糊；Mica 主要使用桌面壁纸色。不要用普通 XAML AcrylicBrush 冒充桌面磨砂。[Microsoft Materials overview](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials)

Windows App SDK 2.0 的 `SystemBackdropElement` 可以把系统材质限制到一个控件的边界，并支持 `CornerRadius`。这比“给整个 Electron HWND 打一层 Acrylic，再希望 CSS 圆角裁掉它”更接近本需求。建议实验宿主使用透明根容器、一个 `SystemBackdropElement` 作为胶囊表面，再把文字与按钮放在同级内容层；材质选 Desktop Acrylic 的 Thin 变体，并保留操作系统回退策略。[System backdrops：局部背景示例](https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops#apply-a-system-backdrop-to-any-xaml-element)

可实施的进程结构：

```text
现有 Node 日志索引 / 价格计算 / 项目历史
              │  本地、有限 schema 的状态消息
              ├── Electron 主面板（保留）
              └── 原生 WinUI 3 灵动岛宿主
                    ├── 透明根表面
                    ├── 圆角 SystemBackdropElement / DesktopAcrylic
                    └── 图标、实时文本、按钮、会话切换
```

这不是要求重写整个软件。第一步仅新增小型 `AgentPulse.Island.exe`，由主进程管理生命周期，通过 named pipe 或严格本地 IPC 传递活动会话、Token、金额、历史/今日与状态。原生岛只发送“打开主面板 / 选择会话 / 固定 / 收起”等动作，不承担日志或计费计算。

如果采用 Win32 + Composition 而非完整 WinUI，需要明确建立 apartment、DispatcherQueue、Compositor、目标和根视觉对象。Microsoft 的 Win32/WebView2 示例给出了这些初始化步骤；WebView2 采用 STA。它是可以参考的宿主骨架，不是可直接复制到 Electron HWND 后立即获得局部磨砂的一行代码。[Microsoft Win32 与 WebView2 材质宿主示例](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-mica-win32)

### 4. 真折射需要另一条研发路线

Desktop Acrylic 提供真实模糊与 tint，但不等于 Apple Liquid Glass 的全部实时透镜效果。若需要可观察的桌面图像形变，需要先有可采样的背景表面，再实现 GPU 位移/透镜着色和裁剪；Windows Desktop Duplication 可以提供逐帧 DXGI 桌面表面，但采样包含自身窗口时会产生递归，必须专门解决背景获取、显示排除、多屏 DPI、HDR 和设备重建。[Desktop Duplication API](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api)

Windows Graphics Capture 也能提供 Direct3D 帧与捕获项选择机制。这属于屏幕采集与渲染管线，而非纯装饰 CSS；不能在现有日志监控应用中悄悄增加持续采集。当前方案不使用截图背景来冒充实时玻璃。[Windows Screen capture](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture)

## Agent Pulse 的交互建议

下列为本项目建议参数，属于设计决策，并非声称 Apple 或 Terse 使用了相同像素值。

| 状态 | 胶囊应显示 | 用户动作与结果 |
| --- | --- | --- |
| 收起、单会话 | 云朵/Agent、当前动作、真实 Token 与 USD | 点击主体展开；独立手柄直接拖动 |
| 多会话进行中 | 主活动与 `+N`；选择规则稳定 | 展开后选会话；手动固定后不被新事件自动抢走 |
| 等待用户输入 | 清楚的等待状态，保留会话名 | 点击打开该会话的对应详情；不伪造进度百分比 |
| 展开 | 历史/今日分别显示、最近工具或消息、最多 3 个会话选择入口 | Esc 收起；点击详情打开已有主面板 |
| 完成 | 简短完成状态与本轮统计（有可靠字段时） | 短暂保留后回到空闲，不持续闪动 |
| 空闲 | 低干扰状态、可访问的历史/面板入口 | 不把“Codex 进程存在”误显示为“正在生成” |

桌面鼠标交互不必照搬 iPhone 的长按：可以点击切换展开，用 hover 只给轻微反馈，避免鼠标经过就不断撑开窗口。拖动按 Pointer Events 的 screen 坐标 1:1 跟随，松手后保存位置；拖动与展开必须可中断。形态变化保持同一锚点，内容淡入可以使用约 180ms；频繁 token 更新保持数字排版稳定，不做循环弹跳。需要减少动态或增加对比度时降低装饰效果，保持文字清晰。这些是对 Apple 状态与材质原则的桌面适配，而非复制其平台 API。[Apple Live Activities 指南](https://developer.apple.com/design/human-interface-guidelines/live-activities/)、[Apple 自定义 Liquid Glass](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)

## 建议的实现顺序与验收证据

1. **当前可交付：**Electron 逐像素真透明 + 本地实时状态 + 自绘折射外观。材质名显示“清透玻璃外观”，准确标注没有跨桌面模糊；先消除灰矩形。
2. **下一阶段原生材质：**只把岛切到独立 WinUI 3 宿主，优先验证 `SystemBackdropElement` + Thin Desktop Acrylic。操作系统不支持时明确回退；不能把回退到实色也标为磨砂已启用。
3. **进阶折射：**只有原生桌面模糊已经稳定、并明确需要透镜效果时，再独立评估真实背景纹理管线，不把截图伪装成结果。

验收应检查真实桌面透过、原生模糊是否随背后内容变化、圆角外是否零底板、150%/200% DPI、多屏拖动、折叠中断、手动固定多会话、关闭/重开位置保持，以及系统透明关闭时的实际回退。静态 CSS 截图只能证明视觉外观，不能证明跨窗口模糊。本文未运行这些 GUI 验证，也没有为了测试创建红蓝背景窗口。

