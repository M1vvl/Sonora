# 0.3.22 原装场景空间与音频适配

本次仅改音乐适配层，不修改原装 7 份场景/Shader、11 份歌词模块。原始字节继续由 `assets/music/source-presets/source-manifest.json`、`lyrics-source/manifest.json` 和 CPU 合同中的 SHA-256 校验。

## 可追溯来源

- MineRadio `public/js/modules/11-main-loop.js`，SHA-256 `46d2f1cffa6ae0d7011124c441ccbdd3f494379f9dd9cd6e2b16a1530fd08514`：38–74 / 52–165 / 165–420 Hz 鼓点组合、2600–6200 Hz 乐器、6200–16000 Hz 高频；动态峰值、四组 attack/release、preset>=4 环形响应及暂停衰减。宿主的 `source-space.js` 复用这些系数，按 dt 换算原固定帧平滑，使 10/30fps 宿主时钟一致。不生成假节拍，不增加音频图。
- 原装 `14-stage-lyrics-rendering.js`，SHA-256 `eb1f2ea10fda8e557aad9aad53173685522eadc4b90028ec51116e4812f28a61`：原生歌词粒子/Shader、逐词进度、行过渡、beatGlow、highBloom、呼吸/辉光/浮空粒子继续直接调用。没有用 CSS 近似替换。
- 原装 `updateStageLyrics3D` 有安魂嘴部锚定和封面粒子四元数继承。本次用户要求独立歌词，因此适配层仅在调用原生歌词时提供中性 preset、独立 Scene/Camera/anchor；还原调用前全部全局引用。视觉与歌词在同一 renderer/context 两次绘制，中间 clearDepth，防止安魂/星球遮住歌词。

## 宿主协议

- `settings.visualScale`、`settings.lyricScale` 各自持久化并限于 0.55–1.65。前者缩放背景 Scene；后者乘以字号比例后，继续服从原装歌词 0.35–1.65 限幅。原有歌词前后位置与文字倾角仍按原装限幅。
- `frame.yaw/pitch` 只控制背景。可选 `frame.lyricYaw/lyricPitch` 只控制歌词 anchor；没有绑定鼠标移动才推进歌词的本地循环。
- `frame.audio` 来自唯一当前 audio 的分析器，附带 `bins/rms/sampleRate/fftSize`。空间模块先归一化，原始 Shader、安魂、原装地形和歌词均得到该真实信号。沉浸 Workshop 仍使用其原装内部音频处理，宿主前景歌词使用同一输入投影。
- `prepare(frame,dt,preset)` 返回已投影 frame；`updateLyrics(frame,dt)` 提供原装歌词调用上下文；`render()` 背景后绘歌词；`dispose()` 释放原装歌词任务与前景组。所有时钟仍由父窗口提供，没有增加 RAF/计时器。
- `pulse-preset-ready` 只表示脚本就绪；`pulse-preset-presented` 必须在实际 render 后发送，供父窗口保留旧画面直到首帧完成。

## 代码核验与范围

- 8 项源场景/独立空间单元合同通过：原装 7 份 SHA、依赖顺序、封面取消、前景场景、清深度顺序、独立限幅、真实频带、静音衰减及无额外时钟。
- 13 项原生歌词 CPU 合同通过：原装 11 份 SHA、真实 Three ShaderMaterial、逐词进度/定位、九预设、独立 Scene/Camera、原装嘴部脱离、独立旋转/缩放、1000 行有界驻留、销毁任务。
- 虚空源预设本身不绘粒子，保留该行为；未为其捏造律动。没有移植 MineRadio 的整曲预分析 beatmap/外部 DJ 子系统；宿主使用当前在线播放实时谱与源程序保守 onset 后备。
- 按用户范围，本次没有运行 GPU、截图或视觉验收；音乐实际外观由用户验收，也没有复测番剧/影视。
