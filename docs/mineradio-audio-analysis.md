# Mineradio 2.1.0 定向 REA：音频律动

2026-10-28，分析本机安装的 `D:\Music\Mineradio\resources\app`，未启动、修改播放器或读取账号数据。

## 制品与工具证据

`package.json` 确认为 Mineradio 2.1.0，Electron 应用，入口 `desktop/main.js`。`Mineradio.exe` 的 SHA-256 为 `297C9BE0134EF69FBB404830EF1328145B7BFEAF11D7089AFE17798E59343377`。

实际运行 REA 6.8.0 的 `analyze-javascript-application`，选择三个精确路径：

- `public/js/modules/05-playback/08-audio-graph-controls.js`
- `public/js/modules/11-main-loop.js`
- `public/js/modules/01-scene/02-beat-camera-runtime.js`

CLI 退出码 0，证据 ID `ev_b1aeefe399d0562a9740f17d8a1914e27e825b57e3895c3c07680ed4513b0378`。完整本地证据保存于 `artifacts/mineradio-2.1-audio-evidence.json`（不进入成品）。REA 只静态解析三个文件，未执行目标代码；2054 个未选文件不在关系分析范围，不能据此证明未出现的能力不存在。

另直接只读核查上述文件行号及 `00-state/00-core-stores.js`。图控模块 SHA-256 为 `12FF46C351F140D5DD4E3063524B4B0EA7FA94F180EF67D7AAA275FEEE348D73`；节拍模块为 `FF573A026361239D90A403DDBF094F6A0E519C3474C8F50014FDADA495A2FB7B`。

## 能确认的调用关系

| 文件位置 | 静态确证 |
|---|---|
| `05-playback/08-audio-graph-controls.js:124`、`:126`、`:160` | 从自身 audio 元素建立 MediaElementSource，或用自身 captureStream 的 MediaStreamSource 作为兼容路径 |
| 同文件 `:174`–`:184` | 建立普通 analyser 与 beatAnalyser，两条分析流接同一播放源，平滑系数分别 0.58 与 0.10 |
| `00-state/00-core-stores.js:8`、`:11` | 普通和节拍 FFT 大小均为 2048 |
| `11-main-loop.js:364`、`:404`、`:408` | 读实时频谱，计算低音上升量，调用实时节拍引擎 |
| `01-scene/02-beat-camera-runtime.js:392` 起 | 先检查 audio 是否暂停，结合频谱与时域数据分析低音、鼓点、主体、人声、瞬态等频带 |
| 同文件 `:417` 起 | 用随 dt 变化的指数跟随区分快速响应和慢速基线，再分析谱能量上升和 onset |

这说明其律动由实际播放信号驱动，不是随机高度或固定往返动画。静态调用链不等于已验证所有分支在本机运行，未进行 Mineradio 播放时的动态追踪。

## 对 Agent Pulse 的适用边界

Mineradio 是播放器，能直接分析自身音源。Agent Pulse 是跨播放器监控器，不能用一个网页 AnalyserNode 自动读取另一个软件的音频。因此独立实现 Windows WASAPI 默认输出回环：识别活跃音频会话 → 本机输出混音 → Hann 窗 FFT → 三频带能量 → 快速上升、缓慢释放 → 小 IPC 帧 → 三条缩放。

Agent Pulse 没有复制 Mineradio 代码、着色器、图片或其他资源。采用独立 C# / JavaScript 实现，也没有引入它的完整可视化引擎。

默认不需要手动选择软件。自动模式响应活跃的输出音频，包括网易云、QQ 音乐、Mineradio、浏览器等；可选“仅常见音乐播放器”使用明确的名称名单。音频会话只提供来源识别，实际频谱仍是默认输出的混合声音，不能宣称按应用独立隔离。跨不同输出设备、独占或受保护音频仍有范围限制。

## 网络调研的一手来源

- [Microsoft：Loopback Recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)：说明读取播放端点的输出混音，支持 WASAPI 共享回环。
- [Microsoft：IAudioCaptureClient](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-iaudiocaptureclient)：按音频帧管理捕获包，创建与释放遵循线程约束。
- [W3C：AnalyserNode 的 FFT 与时间平滑](https://www.w3.org/TR/webaudio/#fft-windowing-and-smoothing-over-time)：频谱窗口和平滑的标准定义。
- [Mineradio 原项目](https://github.com/XxHuberrr/Mineradio)：用于核对原项目归属；线上版本可能晚于本机 2.1.0，未以线上版本代替本机证据。

## 本机验证

独立 helper 的三种单频合成信号测试验证各自落入低、中、高频；静音释放测试确认回到零。这些测试在内存中执行，不播放测试声音。真实探测自动识别到 `cloudmusic`，三频带值随音频变化；只保存数值范围和进程资源摘要，不保存 PCM。其他播放器尚未逐个启动实测。
