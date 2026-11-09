# 0.3.20：MineRadio 预设定向分析与原生 3D 适配

## 分析范围与证据

本次只读分析用户提供的 MineRadio 2.2.0 程序资源，不启动其音乐服务、不读取 Cookie、账号或浏览记录。通过本机缓存 REA 6.8.0 的 `analyze-javascript-application` 对下列四个精确文件静态解析：

- `js/modules/02-visual/00-pointer-cover-particles.js`
- `sonic-topography-preset.js`
- `sonic-workshop-preset.js`
- `js/modules/07-fx/04-preset-grid-uniforms.js`

四个选中文件均完整解析，无语法恢复或失败；其余文件未分析，不将局部静态证据称为整个应用执行验证。证据：`artifacts/v020-presets-rea/evidence/`，摘要 `summary.json`。另人工核对 `02-visual/01-float-skull-backcover.js` 的点云格式、法线和骨骼光照，并读取其公开 `skull-decimation-points.bin`。全部原始文件大小和 SHA256 见 `source-map.json`。

| 原始模块 | SHA256 |
| --- | --- |
| 封面、球面、隧道、唱片、星河顶点算法 | `4a33b2209f0455dfccf13cb70abc8e85430edb9ea0db864341aa41a59a77c04a` |
| 骷髅点云与光照 | `b7f28a6013ae26be1b7eb8bf5e131330e4eeb152ea5a454d521939e5b7bfdbdb` |
| Sonic Topography | `c4b48ae186e5893b87e512e0eb644f97695f3d1f4778505e3ffec652fd31944d` |
| Sonic Workshop 桥接 | `0103860c777ff42d4c1c973743a1e9a54e1792e90ce12dc0ca4ea1a77d2f866e` |
| 原始骷髅表面点数据 | `4dfc716a5b8d51c250e39fd9e26d975deb0e1492e18f225691e3d516f822d8f0` |

## 对应实现

原 0.3.19 `CanvasRenderingContext2D` 示例绘制已经移除，`visual-renderer.js` 改为原生 WebGL 透视投影、视图矩阵、深度测试、方向光、顶点着色器、封面纹理和真实频谱纹理。没有引入另一套播放器或 Three.js / React 运行时。

| 保留的配置 ID | 当前预设及实际几何 |
| --- | --- |
| `cover` | emily 专辑封面：128×128 封面采样点，以亮度建立 Z 轴浮雕，按低/中/高频进行柔和位移。保留原来的平面点云、封面取色和深度表达；并非单张平面贴图。 |
| `tranquil` | 安魂：原 MineRadio 骷髅表面数据固定每四点取一点，52,416→13,104 点，保留真实三维坐标和 jaw kind。方向光、边缘光、克制的低频下颌位移。旧 ID 兼容，显示名纠正为原预设“安魂”。 |
| `topography` | 音域回响 · Sonic-Topography：42×42 根有法线的立体柱，按原算法的低频中心隆起、中频河流、高频边缘分布、距离衰减建立高度；真实音频频谱参与顶点高度。 |
| `ripple` | 音域回响 · Wallpaper Engine：内部音域脉冲模式使用圆形传播和真实频谱柱体；当地壁纸由独立导入/原生播放桥读取时，媒体/场景背景另由该桥提供。不能把本着色器称为 Wallpaper Engine 原生引擎。 |
| `stars` | 星河：参考原多条曲线带的世界空间位置与 Z 层分布，封面颜色和主色融合。粒子数量改变实际提交顶点数量，关闭后不绘制该粒子场。 |
| `record` | 唱片：圆形封面、黑胶沟槽和双环高光，位于三维平面并持续低速旋转，封面与外环不是同一个平面色块。 |
| `planet` | 星球：原球面经纬映射，封面围绕球面采样，自转、透视、遮挡、法线漫反射及边缘光。 |
| `tunnel` | 滚筒：原圆柱 UV 映射、纵深流动及轴向旋转，按低频收缩和中频形变。 |
| `void` | 虚空：清空 3D 图元，只保留用户选择的背景和歌词。 |

频谱高度、浮空方块数量、粒子数量/尺寸/速度、强度、深度和指针镜头均进入实际 draw/uniform，不保留仅改变文字而不改变画面的开关。选取器使用由同一真实 3D 引擎生成的 PNG 缩略图，位于 `assets/music/presets/`；不再使用旧荧光几何轮廓代替预设内容。缩略图使用自绘抽象封面与静态演示频谱，不读取真实用户封面。

这是有界原生 WebGL 的适配实现，保留指定算法与数据，降低原 160–320 网格及大型全局场景开销；没有宣称与 MineRadio 完整 Three.js 场景、后期 Bloom、全部渲染参数逐像素相同。

## 共享音频与资源

- `audio-analysis.js` 使用 WeakMap 为当前 `audio` 创建唯一 MediaElementSource/AudioContext，供歌词卡片与沉浸页共用。每个消费者只获得有界频谱、频带能量和时域 RMS；没有自身轮询计时器，采样最多 30Hz。
- 保留 HTML audio 本身的音量/静音语义，不额外叠加 GainNode。减少动态效果只停止视觉帧，不暂停播放上下文。普通消费者释放不关闭播放链，最后的 `release({final:true})` 用于整套音乐 UI 销毁。
- 单画布最大 960×540，15–30fps 上限；封面上传尺寸最多 512×512。仅按首次使用建立至多五组几何，全部预设同时访问后几何 3,999,744B（小于 4MiB）、两张纹理、一个着色器程序。
- 帧中复用矩阵、颜色、频谱和几何缓冲，不重建 React/DOM、不逐帧创建纹理。`deactivate()` 停帧并删除 GPU 几何/纹理/程序，缩为 1px；重新进入时按需重建，音频继续。隐藏、暂停及减少动态效果停帧；销毁解除监听，清理资源。WebGL 上下文丢失停止提交，恢复后重新建立资源。
- `trim()` 只在停用状态释放 GPU，不通过重启音频伪称内存优化。WebGL/驱动不可用时明确提示，保留背景与歌词；不偷偷切回旧的 2D 示例。

## 验证

`node --test tests/music-audio-analysis.test.cjs`：3/3 通过，含唯一音频图、引用计数、30Hz 采样界限、音量 0/静音/暂停、临时释放后换源不重复绑定。

`node scripts/check-visual-engine.cjs --root <源码或app.asar> --output <目录>`：27/27 隐藏真实 Chromium 检查通过。九个预设由真实 WebGL 输出并具有不同 SHA256；验证实际 GPU 资源界限、非零真实 RAM 测试音频、共享图、静音、减少动态效果时仍有声音、后台停止、关闭释放 GPU 但音频时间继续、上下文丢失/恢复以及最终销毁。报告和图像在 `artifacts/v020-visual-engine/`。测试不操作桌面鼠标、不采集摄像头、麦克风或桌面。

## 来源与许可证

MineRadio 自带 `LICENSE` 为 GPL-3.0-only；保留为 `assets/licenses/MineRadio-GPL-3.0.txt`。修改的选定着色器公式、固定步长点云数据及来源注释随对应源码交付。其 Sonic Topography 源注释注明从 yin-yizhen/sonic-topography 1.1.1、commit `3ff303e` 移植视觉层，归功于原作者 Ajin；本项目沿此出处保留说明。未复制 MineRadio 的账号、服务器、推荐算法或完整第三方前端包。
