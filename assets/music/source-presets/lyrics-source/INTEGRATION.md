# Emily 与原生 3D 歌词接入

## 当前范围

视觉只保留 Emily 专辑封面。原独立音域场景、其他预设、背景媒体及 Wallpaper Engine 接入已移除。常用页只显示 Emily，不再包含用户存档或恢复模块。保留歌词、Emily 动效、歌单架和软件内存管理。

11 份带序号的歌词模块来自用户提供的 MineRadio GPL-3.0 源码。其中 02、03、07、14 已裁剪与已删除场景关联的分支、回调和字段。其余 7 份保持原始字节。manifest.json 分别记录 upstreamSHA256、当前 sha256 和 adaptation。歌词仍使用原 makeLyricShaderMaterial、buildLyricMesh、tickLyricsParticles、updateStageLyrics3D 及双语行层。

Emily 的粒子 shader 裁剪自原 00-pointer-cover-particles.js，仅保留 Emily 分支。原 183×183 默认粒子网格、噪声、封面采样、逐帧变形、bloom 和 ripple 函数继续使用。原 pointer ray 与旋转封面平面的局部交点算法由适配层接入，复用数学对象和同一 renderer。source-manifest.json 记录原文件与裁剪后文件的来源及哈希。

## 运行与数据

父页面只使用一个 audio 与共享 analyser。30Hz 有界状态消息提供真实歌曲秒数、频谱、封面 URL、独立镜头和设置。歌词元数据和设置仅在变更时发送。

Emily 子页面维护单一自主 RAF，正常最高 60fps，减少动态效果时 20fps。两次真实音频状态之间仅外推最多 0.5 秒的播放位置，暂停、隐藏和销毁时停止。新状态不额外叠加同步绘制，显式 seek 立即更新。歌词与 Emily 共用 renderer，通过独立前景 scene/camera 和 clearDepth 分开呈现。

加载顺序为 Three r128、Emily 环境、粒子模块、歌词 defaults/environment/manifest.order、source-space、歌词 adapter、封面/depth/ripple、Emily frame 和时钟 adapter。首次实际绘制后才通知父页面隐藏普通歌词回退。

歌词逐词填色、行内 progress feather、换句轨道与上下文淡化沿用原 shader 和行层算法。封面取色使用原 520ms palette tween，用户选色按原 07-fx/03-cover-picker-fonts.js 立即应用，同时启用对应的自定义通道。原默认上下文透明度为 0.54，保存过的用户数值继续恢复。调色会请求同一宿主时钟的合并绘制，暂停时也能立即呈现，播放时复用现有 RAF。玻璃只作用于沉浸播放栏，其独立 transportGlass 参数默认 0.2，旧全局 glassOpacity 不迁入。

sourceSchemaVersion 2 将默认字号改为 20，仅将旧 schema 的默认 27 迁到 20，其他用户字号保持。新 schema 中主动选择的 27 会照常保存。原生字号与基于 DOM 的回退保持同一设置，原 Three 布局的 27 单位基准继续用于显式比例换算。

## 资源边界

封面只保留当前、上一张和一个未完成请求。歌词复用相同封面采样，不另发图片请求。256×256 深度计算每张封面仅一次，过期任务取消。几何只在分辨率变化时重建，画布只在尺寸变化时调整。歌词重型设置仅在变更时映射。

原整曲 text runway 改为最多 32 主行 metadata 窗口，常态保留目标前 12、后 32 行的渲染行。远处行使用原 disposeStageLyricResidentRow 释放。高分辨率质量池限制 24 MiB，保留原坐标与进度函数。

## 代码核查

scripts/check-source-lyrics-contract.cjs 在 CPU 环境检查 15 项，包括来源哈希、原逐词 ShaderMaterial、暂停时三路颜色到真实材质的映射、seek、翻译、暂停、独立空间、真实时间、1000 行有界驻留以及销毁后零计时资源。music-emily-clock.test.cjs 覆盖自主时钟、单一 RAF、过期状态不倒退、隐藏/暂停/销毁、暂停重绘与减少动态效果。

这些检查不创建 WebGL 上下文，不核查像素、字体观感或 GPU 帧率。音乐视图验收由用户完成。
