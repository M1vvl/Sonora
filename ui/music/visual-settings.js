/* Emily cover and lyric settings. Legacy preferences are projected through
 * this whitelist so removed visual/media features cannot restart on reopen. */
(function(host, factory) {
  'use strict';
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else host.PulseMusicVisualSettings = value;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const PRESETS = Object.freeze(["cover", "topography"]);
  const DEFAULTS = Object.freeze({
  "backgroundStarRiver":true,
  "sonicGroundAmplitude":50,
  "sonicGroundMotionSpeed":50,
  "sonicGroundDensity":46,
  "sonicGroundRange":82,
  "sonicGroundLower":68,
  "sonicGroundDepth":62,
  "sonicGroundAutoRotate":50,
  "sonicGroundColorMode":"cover",
  "sonicGroundBaseColor":"#05070c",
  "sonicGroundCoolColor":"#0066ff",
  "sonicGroundWarmColor":"#ff3c19",
  "sonicGroundAccentColor":"#33e6ff",
  "sonicGroundGlow":20,
  "sonicGroundSubBass":90,
  "sonicGroundBass":92,
  "sonicGroundLowMid":50,
  "sonicGroundMid":50,
  "sonicGroundHighMid":50,
  "sonicGroundPresence":25,
  "sonicGroundBrilliance":50,
  "sonicGroundAir":48,
  "sonicGroundFloatingEnabled":true,
  "sonicGroundFloatingIntensity":36,
  "sonicGroundFloatingMinSize":9,
  "sonicGroundFloatingMaxSize":12,
  "sonicGroundFloatingSpeed":59,
  "sonicGroundFloatingCount":80,
  "sonicAudioMonitorEnabled":true,
  "sonicAudioAutoTrack":true,
  "sonicAudioSensitivity":100,
  "sonicAudioBandStart":1,
  "sonicAudioBandEnd":4,
  "sonicAudioThreshold":32,
  "sonicAudioPulseStrength":62,
  "preset": "cover",
  "visualEnabled": true,
  
  "transportGlass": 0.2,
  "lyricMode": "immersive",
  "lyricLines": 7,
  "translationMode": "current",
  "translationGap": 0.75,
  "translationSize": 0.65,
  "translationOpacity": 0.8,
  "fontFamily": "system",
  "fontSize": 20,
  "fontWeight": 650,
  "lyricX": 50,
  "lyricY": 48,
  "lyricRotation": 0,
  "lyricShadow": 1,
  "lyricMotion": true,
  "lyric3D": true,
  "lyricDepth": 32,
  "intensity": 0.85,
  "depth": 0.2,
  "coverResolution": 384,
  "libraryMode": "sidebar",
  "libraryDynamic": true,
  "libraryWidth": 320,
  "libraryRadius": 20,
  "libraryOpacity": 0.88,
  "fps": 60,
  "lyricProgressEase": 0.18,
  "lyricFeather": 0.055,
  "lyricContextOpacity": 0.54,
  "lyricLineHeight": 1.4,
  "lyricSweep": 0.4,
  "lyricShimmer": 0.25,
  "lyricGlitch": 0,
  "lyricFill": true,
  "lyricContextSpread": 1.4,
  "lyricLetterSpacing": 0,
  "lyricEdgeFade": 0.2,
  "lyricMotionSoftness": 0.72,
  "lyricMotionStyle": "float",
  "lyricGlitchIntensity": 1,
  "lyricGlitchSlice": 0.72,
  "lyricGlitchChroma": 0.86,
  "lyricGlitchRate": 1,
  "lyricGlitchJitter": 0.72,
  "lyricGlowStrength": 0.28,
  "lyricGlowBeat": true,
  "lyricVerticalFloat": true,
  "shelfSize": 0.92,
  "shelfOffsetX": -0.34,
  "shelfOffsetY": -0.2,
  "shelfOffsetZ": 0.12,
  "shelfAngleY": -11,
  "shelfOpacity": 1,
  "shelfBgOpacity": 0.79,
  "shelfDetailOffsetX": 0,
  "shelfDetailOffsetY": 0,
  "shelfDetailOffsetZ": 0,
  "shelfDetailScale": 1.35,
  "shelfDetailAngleX": 0,
  "shelfDetailAngleY": -13,
  "shelfDetailRowGap": 1,
  "shelfDetailOpenDuration": 0.6,
  "shelfDetailCloseDuration": 0.18,
  "shelfDetailRowDuration": 0.72,
  "shelfDetailIntroStrength": 1,
  "shelfDetailParallax": 1,
  "shelfSummonOpenDuration": 0.91,
  "shelfSummonCloseDuration": 0.46,
  "shelfSummonSlide": 1.9,
  "shelfSummonStagger": 1,
  "shelfSummonScale": 1,
  "shelfSummonParallax": 1,
  "shelfCameraEnterSpeed": 0.24,
  "shelfCameraExitSpeed": 0.24,
  "point": 1,
  "speed": 1,
  "twist": 0,
  "color": 1.1,
  "scatter": 0,
  "bgFade": 0.2,
  "bloomStrength": 0.62,
  "bloomSize": 2.65,
  "bloom": false,
  "visualTintMode": "cover",
  "visualTintColor": "#9db8cf",
  "lyricTiltX": 0,
  "lyricTiltY": 0,
  "lyricTextureClarity": 1,
  "lyricColorMode": "auto",
  "lyricColor": "#7ec8d8",
  "lyricHighlightMode": "auto",
  "lyricHighlightColor": "#fff0b8",
  "lyricGlow": true,
  "lyricGlowLinked": true,
  "lyricGlowColor": "#9db8cf",
  "lyricGlowParticles": false,
  "lyricBackdropAdapt": true,
  "lyricPauseHold": true,
  "lyricCameraLock": false,
  "sourceSchemaVersion": 2,
  "visualScale": 1,
  "lyricScale": 1
});
  const FIELDS = Object.freeze({
  "lyrics": [
    [
      "显示与翻译",
      "lyricMode",
      "显示方式",
      {
        "off": "关闭",
        "single": "单行",
        "double": "双行",
        "triple": "三行",
        "multi": "多行",
        "immersive": "沉浸"
      }
    ],
    [
      "显示与翻译",
      "lyricLines",
      "多行数量",
      3,
      15,
      1
    ],
    [
      "显示与翻译",
      "translationMode",
      "翻译显示",
      {
        "off": "关闭",
        "current": "当前",
        "double": "双行",
        "multi": "多行"
      }
    ],
    [
      "显示与翻译",
      "translationGap",
      "译文间距",
      0.28,
      2.2,
      0.05
    ],
    [
      "显示与翻译",
      "translationSize",
      "译文字号",
      0.46,
      1.12,
      0.05
    ],
    [
      "显示与翻译",
      "translationOpacity",
      "译文透明度",
      0.2,
      1,
      0.05
    ],
    [
      "字体与排版",
      "fontFamily",
      "字体",
      {
        "system": "系统",
        "serif": "衬线",
        "rounded": "圆润",
        "mono": "等宽"
      }
    ],
    [
      "字体与排版",
      "fontSize",
      "字号",
      14,
      64,
      1
    ],
    [
      "字体与排版",
      "fontWeight",
      "字重",
      500,
      900,
      50
    ],
    [
      "字体与排版",
      "lyricX",
      "水平位置",
      20,
      80,
      1
    ],
    [
      "字体与排版",
      "lyricY",
      "垂直位置",
      20,
      75,
      1
    ],
    [
      "歌词动画",
      "lyricMotion",
      "当前句轻微浮动",
      "toggle"
    ],
    [
      "立体歌词",
      "lyric3D",
      "歌词立体景深",
      "toggle"
    ],
    [
      "立体歌词",
      "lyricDepth",
      "立体深度",
      0,
      80,
      1
    ],
    [
      "歌词动态 · 原版",
      "lyricContextOpacity",
      "上下文透明",
      0.25,
      1,
      0.01
    ],
    [
      "歌词动态 · 原版",
      "lyricLineHeight",
      "行高",
      0.72,
      1.8,
      0.01
    ],
    [
      "歌词动态 · 原版",
      "lyricContextSpread",
      "上下文展开",
      0.6,
      2.4,
      0.05
    ],
    [
      "歌词动态 · 原版",
      "lyricLetterSpacing",
      "字间距",
      -0.05,
      0.3,
      0.01
    ],
    [
      "歌词动态 · 原版",
      "lyricEdgeFade",
      "边缘渐隐",
      0,
      0.5,
      0.01
    ],
    [
      "歌词动态 · 原版",
      "lyricMotionSoftness",
      "运动柔和",
      0.15,
      1.2,
      0.02
    ],
    [
      "歌词动态 · 原版",
      "lyricGlitchIntensity",
      "故障强度",
      0,
      1.5,
      0.05
    ],
    [
      "歌词动态 · 原版",
      "lyricGlitchSlice",
      "切片",
      0,
      1.4,
      0.05
    ],
    [
      "歌词动态 · 原版",
      "lyricGlitchChroma",
      "色差",
      0,
      1.6,
      0.05
    ],
    [
      "歌词动态 · 原版",
      "lyricGlitchRate",
      "故障频率",
      0.45,
      2.2,
      0.05
    ],
    [
      "歌词动态 · 原版",
      "lyricGlitchJitter",
      "抖动",
      0,
      1.8,
      0.05
    ],
    [
      "歌词动态 · 原版",
      "lyricGlowStrength",
      "溢光强度",
      0,
      0.85,
      0.05
    ],
    [
      "歌词动态 · 原版",
      "lyricGlowBeat",
      "律动溢光",
      "toggle"
    ],
    [
      "歌词动态 · 原版",
      "lyricVerticalFloat",
      "垂直浮动",
      "toggle"
    ],
    [
      "歌词动态 · 原版",
      "lyricMotionStyle",
      "动画风格",
      {
        "float": "浮动",
        "smooth": "平滑",
        "glass": "玻璃",
        "quick": "快速",
        "shine": "光泽",
        "glitch": "故障"
      }
    ],
    [
      "立体歌词 · 原版",
      "lyricTiltX",
      "俯仰",
      -84,
      84,
      1
    ],
    [
      "立体歌词 · 原版",
      "lyricTiltY",
      "水平转角",
      -84,
      84,
      1
    ],
    [
      "字体与排版",
      "lyricTextureClarity",
      "纹理清晰度",
      0.75,
      2,
      0.05
    ],
    [
      "颜色与光效 · 原版",
      "lyricColorMode",
      "文字配色",
      {
        "auto": "封面配色",
        "custom": "自定义"
      }
    ],
    [
      "颜色与光效 · 原版",
      "lyricColor",
      "文字颜色",
      "color"
    ],
    [
      "颜色与光效 · 原版",
      "lyricHighlightMode",
      "当前句配色",
      {
        "auto": "跟随歌词",
        "custom": "自定义"
      }
    ],
    [
      "颜色与光效 · 原版",
      "lyricHighlightColor",
      "当前句颜色",
      "color"
    ],
    [
      "颜色与光效 · 原版",
      "lyricGlow",
      "文字光晕",
      "toggle"
    ],
    [
      "颜色与光效 · 原版",
      "lyricGlowLinked",
      "光晕随歌词配色",
      "toggle"
    ],
    [
      "颜色与光效 · 原版",
      "lyricGlowColor",
      "独立光晕色",
      "color"
    ],
    [
      "颜色与光效 · 原版",
      "lyricGlowParticles",
      "歌词星河",
      "toggle"
    ],
    [
      "颜色与光效 · 原版",
      "lyricBackdropAdapt",
      "背景可读性适配",
      "toggle"
    ],
    [
      "歌词动画 · 原版",
      "lyricPauseHold",
      "暂停保持当前句",
      "toggle"
    ],
    [
      "立体歌词 · 原版",
      "lyricCameraLock",
      "锁定歌词镜头",
      "toggle"
    ],
    [
      "独立空间",
      "lyricScale",
      "歌词缩放",
      0.55,
      1.65,
      0.01
    ]
  ],
  "motion": [
["音域回响 · 原版","backgroundStarRiver","背景星尘","toggle"],
["音域回响 · 原版","sonicGroundAmplitude","地面起伏",0,100,1],
["音域回响 · 原版","sonicGroundMotionSpeed","运动速度",0,100,1],
["音域回响 · 原版","sonicGroundDensity","地形密度",0,100,1],
["音域回响 · 原版","sonicGroundRange","地面范围",0,100,1],
["音域回响 · 原版","sonicGroundLower","地面高度",0,100,1],
["音域回响 · 原版","sonicGroundDepth","前后位置",0,100,1],
["音域回响 · 原版","sonicGroundAutoRotate","自动旋转",0,100,1],
["音域回响 · 原版","sonicGroundColorMode","地形配色",{"cover":"封面取色","custom":"自定义"}],
["音域回响 · 原版","sonicGroundBaseColor","基础底色","color"],
["音域回响 · 原版","sonicGroundCoolColor","冷色","color"],
["音域回响 · 原版","sonicGroundWarmColor","暖色","color"],
["音域回响 · 原版","sonicGroundAccentColor","高光颜色","color"],
["音域回响 · 原版","sonicGroundGlow","发光强度",0,100,1],
["音域回响 · 原版","sonicGroundSubBass","超低频",0,100,1],
["音域回响 · 原版","sonicGroundBass","低频",0,100,1],
["音域回响 · 原版","sonicGroundLowMid","中低频",0,100,1],
["音域回响 · 原版","sonicGroundMid","中频",0,100,1],
["音域回响 · 原版","sonicGroundHighMid","中高频",0,100,1],
["音域回响 · 原版","sonicGroundPresence","临场频段",0,100,1],
["音域回响 · 原版","sonicGroundBrilliance","明亮频段",0,100,1],
["音域回响 · 原版","sonicGroundAir","空气感",0,100,1],
["音域回响 · 原版","sonicGroundFloatingEnabled","浮空方块","toggle"],
["音域回响 · 原版","sonicGroundFloatingIntensity","浮空律动",0,100,1],
["音域回响 · 原版","sonicGroundFloatingMinSize","最小尺寸",0,100,1],
["音域回响 · 原版","sonicGroundFloatingMaxSize","最大尺寸",0,100,1],
["音域回响 · 原版","sonicGroundFloatingSpeed","漂浮速度",0,100,1],
["音域回响 · 原版","sonicGroundFloatingCount","浮空数量",0,100,1],
["原版节拍检测","sonicAudioMonitorEnabled","节拍检测","toggle"],
["原版节拍检测","sonicAudioAutoTrack","自动追踪频段","toggle"],
["原版节拍检测","sonicAudioSensitivity","灵敏度",0,100,1],
["原版节拍检测","sonicAudioBandStart","频段起点",0,510,1],
["原版节拍检测","sonicAudioBandEnd","频段终点",2,512,1],
["原版节拍检测","sonicAudioThreshold","触发阈值",0,100,1],
["原版节拍检测","sonicAudioPulseStrength","脉冲强度",0,100,1],
    [
      "独立空间",
      "visualScale",
      "背景缩放",
      0.55,
      1.65,
      0.01
    ],
    [
      "Emily 封面",
      "intensity",
      "律动强度",
      0,
      2,
      0.05
    ],
    [
      "Emily 封面",
      "depth",
      "画面景深",
      0,
      1,
      0.05
    ],
    [
      "Emily 封面",
      "coverResolution",
      "封面清晰度",
      128,
      384,
      128
    ],
    [
      "Emily 封面",
      "point",
      "点大小",
      0.2,
      3,
      0.05
    ],
    [
      "Emily 封面",
      "speed",
      "运动速度",
      0,
      3,
      0.05
    ],
    [
      "Emily 封面",
      "twist",
      "扭曲",
      0,
      2,
      0.05
    ],
    [
      "Emily 封面",
      "color",
      "颜色增强",
      0.2,
      2,
      0.05
    ],
    [
      "Emily 封面",
      "scatter",
      "粒子散开",
      0,
      2,
      0.05
    ],
    [
      "Emily 封面",
      "bgFade",
      "暗部抑制",
      0,
      1,
      0.02
    ],
    [
      "Emily 封面",
      "bloomStrength",
      "辉光强度",
      0,
      2,
      0.02
    ],
    [
      "Emily 封面",
      "bloomSize",
      "辉光半径",
      1,
      5,
      0.05
    ],
    [
      "Emily 封面",
      "bloom",
      "辉光",
      "toggle"
    ],
    [
      "Emily 封面",
      "visualTintMode",
      "粒子染色",
      {
        "cover": "封面原色",
        "custom": "自定义"
      }
    ],
    [
      "Emily 封面",
      "visualTintColor",
      "染色颜色",
      "color"
    ]
  ],
  "library": [
    [
      "显示方式",
      "libraryMode",
      "歌单架",
      {
        "off": "关闭",
        "stage": "立体歌单"
      }
    ],
    [
      "显示方式",
      "libraryDynamic",
      "展开动画",
      "toggle"
    ],
    [
      "外观与位置",
      "libraryWidth",
      "一级侧栏宽度",
      260,
      420,
      10
    ],
    [
      "外观与位置",
      "libraryRadius",
      "一级侧栏圆角",
      0,
      30,
      1
    ],
    [
      "外观与位置",
      "libraryOpacity",
      "一级侧栏透明度",
      0.2,
      1,
      0.02
    ],
    [
      "立体歌单 · 原版",
      "shelfSize",
      "整体尺寸",
      0.65,
      1.45,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfOffsetX",
      "水平位移",
      -1.2,
      1.2,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfOffsetY",
      "垂直位移",
      -0.9,
      0.9,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfOffsetZ",
      "前后位移",
      -0.9,
      0.9,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfAngleY",
      "歌单转角",
      -60,
      60,
      1
    ],
    [
      "立体歌单 · 原版",
      "shelfOpacity",
      "卡片透明",
      0.25,
      1.0,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfBgOpacity",
      "卡片底色透明",
      0.25,
      0.98,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailOffsetX",
      "详情水平",
      -4.8,
      4.8,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailOffsetY",
      "详情垂直",
      -3.6,
      3.6,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailOffsetZ",
      "详情前后",
      -3.6,
      3.6,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailScale",
      "详情尺寸",
      0.72,
      1.35,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailAngleX",
      "详情俯仰",
      -24.0,
      24.0,
      1
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailAngleY",
      "详情转角",
      -28.0,
      28.0,
      1
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailRowGap",
      "歌曲间距",
      0.72,
      1.32,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailOpenDuration",
      "详情展开时长",
      0.12,
      1.2,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailCloseDuration",
      "详情收起时长",
      0.08,
      0.8,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailRowDuration",
      "歌曲展开时长",
      0.16,
      1.6,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailIntroStrength",
      "详情入场幅度",
      0.0,
      1.8,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfDetailParallax",
      "详情视差",
      0.0,
      1.8,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfSummonOpenDuration",
      "唤出时长",
      0.08,
      2.0,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfSummonCloseDuration",
      "隐退时长",
      0.08,
      1.6,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfSummonSlide",
      "唤出滑动距离",
      0.0,
      4.0,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfSummonStagger",
      "层间延迟",
      0.0,
      3.0,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfSummonScale",
      "入场缩放",
      0.0,
      3.0,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfSummonParallax",
      "入场视差",
      0.0,
      2.5,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfCameraEnterSpeed",
      "镜头进入速度",
      0.2,
      1.5,
      0.01
    ],
    [
      "立体歌单 · 原版",
      "shelfCameraExitSpeed",
      "镜头退出速度",
      0.2,
      1.5,
      0.01
    ]
  ],
  "system": [
    [
      "性能",
      "fps",
      "最大帧率",
      15,
      60,
      5
    ]
  ]
});
  const ENUMS = Object.freeze({
 sonicGroundColorMode:["cover","custom"],
  
  "preset": ["cover","topography"],
  "lyricMode": [
    "off",
    "single",
    "double",
    "triple",
    "multi",
    "immersive"
  ],
  "translationMode": [
    "off",
    "current",
    "double",
    "multi"
  ],
  "fontFamily": [
    "system",
    "serif",
    "rounded",
    "mono"
  ],
  "libraryMode": [
    "off",
    "sidebar",
    "stage"
  ],
  "lyricMotionStyle": [
    "float",
    "smooth",
    "glass",
    "quick",
    "shine",
    "glitch"
  ],
  "visualTintMode": [
    "cover",
    "custom"
  ],
  "lyricColorMode": [
    "auto",
    "custom"
  ],
  "lyricHighlightMode": [
    "auto",
    "custom"
  ]
});
  const NUMBERS = Object.freeze({
  "sonicGroundAmplitude":[0,100],
  "sonicGroundMotionSpeed":[0,100],
  "sonicGroundDensity":[0,100],
  "sonicGroundRange":[0,100],
  "sonicGroundLower":[0,100],
  "sonicGroundDepth":[0,100],
  "sonicGroundAutoRotate":[0,100],
  "sonicGroundGlow":[0,100],
  "sonicGroundSubBass":[0,100],
  "sonicGroundBass":[0,100],
  "sonicGroundLowMid":[0,100],
  "sonicGroundMid":[0,100],
  "sonicGroundHighMid":[0,100],
  "sonicGroundPresence":[0,100],
  "sonicGroundBrilliance":[0,100],
  "sonicGroundAir":[0,100],
  "sonicGroundFloatingIntensity":[0,100],
  "sonicGroundFloatingMinSize":[0,100],
  "sonicGroundFloatingMaxSize":[0,100],
  "sonicGroundFloatingSpeed":[0,100],
  "sonicGroundFloatingCount":[0,100],
  "sonicAudioSensitivity":[0,100],
  "sonicAudioBandStart":[0,510],
  "sonicAudioBandEnd":[2,512],
  "sonicAudioThreshold":[0,100],
  "sonicAudioPulseStrength":[0,100],
  "transportGlass": [
    0.2,
    1
  ],
  "lyricLines": [
    3,
    15
  ],
  "translationGap": [
    0.28,
    2.2
  ],
  "translationSize": [
    0.46,
    1.12
  ],
  "translationOpacity": [
    0.2,
    1
  ],
  "fontSize": [
    14,
    64
  ],
  "fontWeight": [
    500,
    900
  ],
  "lyricX": [
    20,
    80
  ],
  "lyricY": [
    20,
    75
  ],
  "lyricRotation": [
    -15,
    15
  ],
  "lyricShadow": [
    0,
    2
  ],
  "lyricDepth": [
    0,
    80
  ],
  "lyricProgressEase": [
    0.04,
    0.5
  ],
  "lyricFeather": [
    0.005,
    0.2
  ],
  "lyricContextOpacity": [
    0.25,
    1
  ],
  "lyricLineHeight": [
    0.72,
    1.8
  ],
  "lyricSweep": [
    0,
    2
  ],
  "lyricShimmer": [
    0,
    2
  ],
  "lyricGlitch": [
    0,
    1
  ],
  "lyricContextSpread": [
    0.6,
    2.4
  ],
  "lyricLetterSpacing": [
    -0.05,
    0.3
  ],
  "lyricEdgeFade": [
    0,
    0.5
  ],
  "lyricMotionSoftness": [
    0.15,
    1.2
  ],
  "lyricGlitchIntensity": [
    0,
    1.5
  ],
  "lyricGlitchSlice": [
    0,
    1.4
  ],
  "lyricGlitchChroma": [
    0,
    1.6
  ],
  "lyricGlitchRate": [
    0.45,
    2.2
  ],
  "lyricGlitchJitter": [
    0,
    1.8
  ],
  "lyricGlowStrength": [
    0,
    0.85
  ],
  "intensity": [
    0,
    2
  ],
  "depth": [
    0,
    1
  ],
  "coverResolution": [
    128,
    384
  ],
  "libraryWidth": [
    260,
    420
  ],
  "libraryRadius": [
    0,
    30
  ],
  "libraryOpacity": [
    0.2,
    1
  ],
  "fps": [
    15,
    60
  ],
  "shelfSize": [
    0.65,
    1.45
  ],
  "shelfOffsetX": [
    -1.2,
    1.2
  ],
  "shelfOffsetY": [
    -0.9,
    0.9
  ],
  "shelfOffsetZ": [
    -0.9,
    0.9
  ],
  "shelfAngleY": [
    -60,
    60
  ],
  "shelfOpacity": [
    0.25,
    1.0
  ],
  "shelfBgOpacity": [
    0.25,
    0.98
  ],
  "shelfDetailOffsetX": [
    -4.8,
    4.8
  ],
  "shelfDetailOffsetY": [
    -3.6,
    3.6
  ],
  "shelfDetailOffsetZ": [
    -3.6,
    3.6
  ],
  "shelfDetailScale": [
    0.72,
    1.35
  ],
  "shelfDetailAngleX": [
    -24.0,
    24.0
  ],
  "shelfDetailAngleY": [
    -28.0,
    28.0
  ],
  "shelfDetailRowGap": [
    0.72,
    1.32
  ],
  "shelfDetailOpenDuration": [
    0.12,
    1.2
  ],
  "shelfDetailCloseDuration": [
    0.08,
    0.8
  ],
  "shelfDetailRowDuration": [
    0.16,
    1.6
  ],
  "shelfDetailIntroStrength": [
    0.0,
    1.8
  ],
  "shelfDetailParallax": [
    0.0,
    1.8
  ],
  "shelfSummonOpenDuration": [
    0.08,
    2.0
  ],
  "shelfSummonCloseDuration": [
    0.08,
    1.6
  ],
  "shelfSummonSlide": [
    0.0,
    4.0
  ],
  "shelfSummonStagger": [
    0.0,
    3.0
  ],
  "shelfSummonScale": [
    0.0,
    3.0
  ],
  "shelfSummonParallax": [
    0.0,
    2.5
  ],
  "shelfCameraEnterSpeed": [
    0.2,
    1.5
  ],
  "shelfCameraExitSpeed": [
    0.2,
    1.5
  ],
  "point": [
    0.2,
    3
  ],
  "speed": [
    0,
    3
  ],
  "twist": [
    0,
    2
  ],
  "color": [
    0.2,
    2
  ],
  "scatter": [
    0,
    2
  ],
  "bgFade": [
    0,
    1
  ],
  "bloomStrength": [
    0,
    2
  ],
  "bloomSize": [
    1,
    5
  ],
  "lyricTiltX": [
    -84,
    84
  ],
  "lyricTiltY": [
    -84,
    84
  ],
  "lyricTextureClarity": [
    0.75,
    2
  ],
  "sourceSchemaVersion": [
    1,
    2
  ],
  "visualScale": [
    0.55,
    1.65
  ],
  "lyricScale": [
    0.55,
    1.65
  ]
});
  const labels = Object.freeze({
  "cover": "Emily 专辑封面", "topography":"音域回响 · 原版"
});
  function normalize(input = {}) {
    const value = {...DEFAULTS};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return value;
    for (const key of Object.keys(value)) {
      const candidate = input[key];
      if (ENUMS[key]) {
        if (ENUMS[key].includes(candidate)) value[key] = candidate;
      } else if (NUMBERS[key]) {
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          value[key] = Math.max(NUMBERS[key][0], Math.min(NUMBERS[key][1], candidate));
        }
      } else if (typeof value[key] === 'boolean') {
        if (typeof candidate === 'boolean') value[key] = candidate;
      } else if (/^#[0-9a-f]{6}$/i.test(candidate || '')) value[key] = candidate.toLowerCase();
    }
    for (const key of ['lyricLines', 'fontWeight', 'coverResolution', 'libraryWidth', 'libraryRadius', 'fps']) {
      value[key] = Math.round(value[key]);
    }
    if (input.lyricMotionStyle === 'stable') value.lyricMotionStyle = 'smooth';
    if (input.libraryMode === 'sidebar') value.libraryMode = 'stage';
    // Version one used 27 as its untouched default. A version-two user can
    // explicitly select 27 again without the migration changing it on reopen.
    if ((Number(input.sourceSchemaVersion) || 1) < 2 && input.fontSize === 27) value.fontSize = 20;
    value.sourceSchemaVersion = 2;
    // Transport glass is a new setting. The old global glass value is removed.
    if (typeof input.transportGlass === 'number' && Number.isFinite(input.transportGlass)) {
      value.transportGlass = Math.max(.2, Math.min(1, input.transportGlass));
    }
    return value;
  }
  return {DEFAULTS, PRESETS, FIELDS, labels, normalize};
});
