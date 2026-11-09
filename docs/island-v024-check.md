# 0.3.24 灵动岛检查

## 已实现与代码检查

- 收起保持 480 × 44，展开保持 520 × 260。横滑切换监控与音乐页，双击展开，键盘 Enter 和 Space 保留。
- 鼠标手势仅用于横滑和下拉切换模式，移除了 renderer 中所有原生窗口移动请求。自动隐藏与固定模式均停靠当前显示器顶部。负坐标显示器、顶边唤出、展开保持、拖动进度保持均有回归测试。
- 下拉达到 48 像素显示就绪反馈，释放后由持久化设置确认模式。模式变化显示短文本 1.8 秒，自动隐藏保留 1.6 秒反馈时间。手势即刻反馈参考官方交互原则。[Apple Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)
- 音乐进度使用连续 2 像素细线，移除圆球，保留 10 像素交互高度。当前封面完成加载时取色一次，采样上限 16 × 16。明暗玻璃分别限制颜色对比度，时间包不重复采样。
- 无有效歌词或缺少可信时间轴时仅显示歌曲标题。歌词后端与展示端均拦截网易云信用信息 JSON、损坏的 `{c}` 片段。相同歌曲的时间包与延迟歌词包继续合并。
- 媒体消息增加 `timelineKnown` 与 `timelineSource`，区分系统媒体时间轴、可访问控件时间与信息缺失。未知时间轴停止歌词帧循环。

## 网易云真实时间轴调查

2026-11-05 在当前电脑以原生 `--probe-duration` 执行只读探测，网易云播放中返回 `position=0`、`duration=0`、`canSeek=false`，封面和播放按钮可正常读取。系统时间轴当前位置的含义与更新时间由 Windows 定义。[Microsoft timeline properties](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessiontimelineproperties)

只读检查了 `D:\Music\CloudMusic\package\native.ntpk`、`orpheus.ntpk`、安装目录的 `cloudmusic.dll` 和 `winrt_utils.dll`。资源为打包格式，公开字符串可以确认 SMTC 初始化与按钮回调，未确认时间轴发布设置。仅检查程序资源，不读取账号凭据。

对同一网易云进程的本地监听端口 `127.0.0.1:20017` 执行一次 GET `/` 和 OPTIONS `/`，两者均返回 404，未确认可读取进度的接口。

加入独立的只读 UI Automation 备选路径，参考 Now Playing Service 原作者的实现。仅在网易云系统媒体时间轴缺失时启用单一 STA worker。匹配网易云 PID、当前歌名和歌手的窗口，读取 Text 或 Slider 的完整 `MM:SS / MM:SS` 文本。冷扫描上限 256 个节点，失败后 3 秒再查，热路径只读取已匹配控件。播放中的数值连续 1.8 秒不前进则失效，拒绝将旧值持续当作同步时间。[Now Playing Service source](https://github.com/Widdit/now-playing-service/blob/master/external_programs/AudioService/GetMusicStatus/Helpers/NeteaseMusicHelper.cs)

本机当前网易云在托盘状态，UI Automation 对三个进程的十五个顶层窗口只返回根节点，没有可读的时间文本或 Slider。加入备选路径后原生探测仍为 `timelineKnown=false`、`timelineSource=none`。因此当前托盘状态的网易云精确进度和同步歌词仍未取得，软件显示真实歌曲标题。播放器公开有效控件文本或系统时间轴时才自动启用同步，不用本地估时伪装准确进度。

QQ 音乐与 Apple Music 沿用同一 GSMTC 真实时间轴和独立播放控制能力判断，支持其发布的进度与严格匹配歌词。检查时本机没有运行这两个播放器，未取得实际播放样本。对应时间字段、缺失时间降级和播放器未提供跳转能力的组合已做代码回归，未宣称本机播放验收通过。没有控件源码或真实可读样本时，不将网易云窗口规则套到其他播放器。

## 已运行检查

- 原生媒体组件编译通过。
- 二十九项音乐媒体和灵动岛专项测试通过。包含 C# 原生时间文本解析、越界与垃圾文本拒绝、停滞样本过期、真实跳转与暂停、双页手势、顶边模式持久化、封面取色、QQ 与 Apple 能力组合和未知时间轴降级。
- 没有执行鼠标操作或 GPU 视图验收。番剧、影视与视频播放器不属于本轮检查范围。
