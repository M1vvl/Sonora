# 0.3.26圆角与材质核对

2026-11-06。只核对本轮窗口轮廓、材质及相关音乐生命周期回归，视觉由用户验收。

## Q1外部圆角

- 普通窗口半径24DIP，CSS与原生区域相同。使用GetWindowRect/GetDpiForWindow计算物理像素区域，由SetWindowRgn同时限制绘制和四角命中。
- 透明分层窗口无法只靠DWM33圆角偏好完成圆角，因此以GDI区域作为实际裁切，DWM仅作辅助。[Microsoft圆角限制](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-rounded-corners)
- resize、移动跨屏及DPI变化以单次32ms更新合并，几何相同不重建区域。最大化和全屏移除圆角，恢复普通窗口时重建。关闭释放监听和待执行任务。
- SetWindowRgn成功后区域归Windows所有，失败时本模块释放，避免GDI资源泄漏。

## Q2透明度和玻璃层次

旧版将保存不透明度乘以0.25后才用于窗口主体。用户当前保存0.76，背景实际仅用了19%不透明底色，这是壁纸过度清晰的直接原因。本轮直接使用保存的76%，文字和控件不做整窗淡化。内面板独立采用较轻表面，避免多层高浓度叠加。

新增共享玻璃样式变量。主面板与歌词播放栏采用相同的18px软件内部backdrop blur、125%饱和度、内高光和亮边语法。噪声由固定128×128 SVG平铺，一次加载，没有新增桌面采样、全屏截图、摄像头或动态噪声循环。主题小卡不再重复嵌套模糊，减少层数。

Windows当前EnableTransparency为0，用户前次选择保持关闭。本轮保持该值。系统关闭时原生Acrylic无法提供真实桌面磨砂，界面标为“雾面材质降级”，软件内部CSS模糊不代表下层桌面画面已被模糊。[Microsoft材质回退](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials)、[Electron透明窗口](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)

查阅DesktopAcrylicController、SystemBackdropConfiguration与CreateHostBackdropBrush，未发现可在保持系统关闭的条件下可靠保证真实桌面模糊的受支持轻量路径。未将未文档化Accent API的成功返回值当作视觉通过，也未用静态壁纸贴图替代真实材质。

## 核对

原生区域10项测试及材质、后台播放相关71项定向测试通过。最终源码合同、完整相关回归及安装文件检查记录在本轮artifacts报告中。正式主题读取为electric-purple，拟态玻璃已开启、不透明度0.76，均保持用户数值。

额外以从未显示的原生测试窗口验证真实Koffi/GDI调用，圆角区域已建立、角点被排除、中心被包含，进入全屏后区域恢复矩形。未显示、未捕获任何用户桌面画面。报告 `artifacts/v026-native-shape.json`。

完整相关回归340项、源码139项合同检查通过。原生构建及成品检查记录于 `artifacts/v0.3.26-runtime`，安装替换记录为 `release/runtime-update.json`。本轮保留原主题及0.76不透明度，版本留存规则保持默认增量更新。
