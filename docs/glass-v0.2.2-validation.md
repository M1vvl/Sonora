# 0.2.2：透明合成修复与验证

日期：2026-10-28。用户明确选择保留 Windows 全局透明效果关闭，使用清透降级材质。

## 根因与证据边界

本机 Windows build 26200，`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\EnableTransparency` 为 0。Microsoft 文档确认 SystemBackdrop / Acrylic 在透明效果关闭时回退为实色。这个条件是系统材质实色回退的重要原因，但不能据此证明所有 undocumented Accent 模式都采用相同内部机制。[Microsoft Materials](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials)

此前还存在两项独立问题：窗口大于可见胶囊并有外围 padding；frameless 窗口仍保留默认 `WS_THICKFRAME`。Electron 官方说明 `thickFrame` 默认开启，会添加标准窗框。仅去掉 HTML 背景或设置圆角，不足以清除这些原生区域。[Electron window options](https://www.electronjs.org/docs/latest/api/structures/base-window-options)

0.2.1 的 Accent3 / Region 返回成功，只证明 API 接受请求，不证明实际背景模糊或最终裁切。旧版“已经修复磨砂”的结论撤回。

## 当前交付

- 关闭系统透明效果时：新建 `transparent:true` 的逐像素透明窗口，`frame:false`、`thickFrame:false`、`hasShadow:false`，透明背景。此路径完全不调用 Accent、DWM backdrop、Electron shape 或原生 Region。
- 窗口紧贴胶囊：收起 480×44、展开 520×260，页面 padding 为 0，无外阴影。
- 透明底色、矢量图标、局部内高光、亮边；没有底图、桌面截图、屏幕捕获或测试背景窗。
- 用户已选择清透降级，因此减少透明度媒体查询不再把清透模式覆盖成实色；系统高对比度可读性支持仍保留。
- 只读系统偏好，不修改注册表和系统设置。设置页面显示“清透模式 · Windows 透明效果已关闭”。
- 原生材质与逐像素透明使用不同的 HWND 创建路径；原生接口失败后重建为透明窗口，防止不透明 HWND 被误当作清透兼容模式。
- 展开后可选择项目下的主对话或自动跟随活动；跨快照保持手动选择，消失后回自动。Esc 收起。历史总量与今日用量保持独立。

## 验证

源码 Electron 冒烟检查 25 项通过，renderer errors 为 0。新增检查覆盖：材质遵守系统偏好、无外围 padding、实际透明像素、展开/收起尺寸、会话切换、选择在数据更新后保留、Esc 收起。

`capturePage()` 的收起 PNG 实测：四角 alpha=0，中部空白处 alpha=29/255（约 11.4% 不透明），可以透出下层真实内容。此检查验证渲染层 alpha，不等于桌面模糊验收。另检查了实际原生窗口显示。0.2.2 成品同样 25/25 项通过、renderer errors=0、alpha=0/29；结果见 `artifacts/v0.2.2-packaged/smoke-report.json`。

## 尚未宣称完成的能力

当前选择下，**清透不产生真实桌面磨砂，也没有 Apple Liquid Glass 的实时光学折射**。用户保持系统透明关闭，因此未更改该条件来进行原生磨砂视觉验收；保留的 Accent4 独立路径仍需要在允许系统透明时验证背景变化、失焦、拖动和 DPI。

Apple Dynamic Island 的活动/展开行为与 Liquid Glass 的材质效果分别借鉴；Apple 原生材质不是 Windows 可直接调用的 CSS。[Apple Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)

Terse 深入静态分析已确证岛尺寸与原点圆角、TAO 透明初始化；没有证据证明其岛实际调用通用 Acrylic 或 blur 分支。因此没有将这些未确认调用当作修复依据。详见 [REA 合成链报告](terse-island-composition-v0.2.2.md) 与 [桌面材质调研](desktop-liquid-glass-research.md)。
