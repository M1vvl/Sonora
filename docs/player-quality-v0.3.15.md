# 0.3.15 播放画质与 Escape

## 模型与边界

“片源解码像素”来自原生播放器 `videoWidth/videoHeight`，是输入分辨率。输出目标为独立 GPU 中间画面处理：1080p 对应 1920×1080、2K/1440p 对应 2560×1440、4K/2160p 对应 3840×2160 的边界框，宽屏/竖屏按原比例适配。最终显示仍由窗口、屏幕和缩放决定，不把超分输出宣称为原生 4K 视频，也不把 CPU 视频缩放伪装成 GPU 神经网络。

新配置默认最佳质量和 2160p。旧配置没有 `outputResolution` 键时按本次用户明确要求迁移为最佳质量/2160p，音量等其他偏好保留；新配置中手动选择的关闭增强或其他输出目标在保存后会一直保留。

`src/player-output.cjs` 集中管理目标和着色器组合。九个原始 Anime4K 文件保持原 SHA 和系数；`scripts/build-player-output.cjs` 生成 27 个目标适配副本，只改 `//!` 元数据中的 `OUTPUT.w/h` RPN 表达式，使神经网络的触发门限依据目标分辨率而非小窗口。GLSL 代码、神经网络系数、原始 MIT 声明保留。原生构建脚本在编译 helper 前确定性生成副本。

额外的三个 `AgentPulse_Output_*.glsl` 以可调整尺寸的 MAIN hook 做 GPU 纹理目标和 Catmull-Rom 重采样，随后由 mpv 正常合成至真实窗口。没有调整 Windows 显示模式、没有构造隐藏的巨大原生窗口、没有 CPU `vf=scale`，没有修改固定的 OUTPUT hook。

## GPU 验证

`scripts/check-player-output.cjs` 以合成的 1920×1080 图片和 640×360 原生窗口核对：

- `vo-passes` 中三档均有对应目标 pass；2160p 下真实执行 Anime4K Upscale CNN，证明不是只有双三次放大。
- 诊断后置 pass 把实际 `HOOKED_size` 编码到像素，输出截屏中心分别为 `[60,34]`、`[80,45]`、`[120,68]`，与 1920×1080、2560×1440、3840×2160 的尺寸编码一致（8 位量化有一等级误差）。
- 七项验证通过，证据 `artifacts/v0.3.15-output/output-report.json`。只读取合成图及测试窗口，不读取桌面或真实视频内容。

真实公开视频嵌入检查另验证所有三档 pass、原始效率/质量网络执行、画面像素差异和资源释放；旧网络比较时切换输出为自动，避免额外目标 pass 混入原始管线比较。

## Escape

全屏退出使用幂等的 `setFullscreen(false)`；不能以“切换全屏”实现 Escape。DOM 在按钮/滑块的快捷键过滤之前处理 Esc，原生子 HWND 处理 WM_KEYDOWN，mpv 的 ESC 绑定继续保留，播放器及宿主 WebContents 的 `before-input-event` 提供兜底。监听在关闭时移除。

真实嵌入检查验证：焦点位于控件时退出、向测试 helper 自己的 HWND 投递 Escape 后退出、Electron 输入兜底退出；普通窗口 Esc 只收起菜单，不会进入全屏。诊断键消息仅显式诊断 helper 可用，未暴露给产品页面。

官方接口依据：[mpv GLSL hook 与 RPN 尺寸定义](https://mpv.io/manual/stable/#options-glsl-shaders)、[可调整的 MAIN / 固定的 OUTPUT](https://mpv.io/manual/stable/#options-glsl-shaders)、[vo-passes 统计](https://mpv.io/manual/stable/#properties-vo-passes)。
