# Terse 灵动岛玻璃底层复核与 v0.2.1 修正依据

日期：2026-10-28。范围：本机 Terse AI 1.4.2.0 的只读制品分析。目标是解释透明胶囊、原生圆角与真实磨砂的区别，并纠正把整个 HWND 的系统 Acrylic 当作胶囊材质的实现路线。

## 结论

可确认 Terse 有专门的原生圆角区域路径：岛构造附近按 **360 × 44 DIP、22 DIP 半径**调用 helper，该 helper 最终调用 `CreateRoundRectRgn` 和 `SetWindowRgn`。这不是仅从 import 名称猜测。

可确认其安装制品包含 `window-vibrancy` 风格的 blur / acrylic 实现，且机器码分别构造了相应 Win32 参数。但目前**没有证明岛窗口实际选择了 blur 或 acrylic 分支**。最终岛 CSS 则明确覆盖为透明背景并禁用 backdrop-filter。

因此，不应将 Terse 的当前效果描述为“已证实启用系统 Acrylic 的磨砂胶囊”。独立实现中，应把胶囊区域、浏览器层颜色和桌面模糊当成三个分别验证的层。`setBackgroundMaterial('acrylic')` 不应继续作为解决本轮矩形背景问题的既定方案。

## 制品与工具边界

目标：`C:\Program Files\WindowsApps\luzgool.TerseAI_1.4.2.0_x64__xgss3z3s9297y\Terse.exe`。

- 字节数：50,341,376。
- SHA-256 再次核对为 `aa746b596565869c2eb57e5dec6c5f9462efb9cbe0e64fb3e96c3622c1a2bd22`。
- PE AMD64，首选 ImageBase 为 `0x140000000`。下文机器码地址为首选 VA；运行时 ASLR 地址可能不同。
- 未改写目标、未注入或挂钩目标、未读取登录/授权文件。

本轮实际请求了 REA 6.8.0 的 native string search：

```powershell
node "C:\Users\10707\AppData\Local\npm-cache\_npx\da7caeae9db9c589\node_modules\rea-agents\scripts\rea.mjs" search "C:\Program Files\WindowsApps\luzgool.TerseAI_1.4.2.0_x64__xgss3z3s9297y\Terse.exe" island --kind strings --provider ghidra --json
```

REA 明确返回 `provider_unavailable`：本机没有配置 Ghidra、IDA 或 Kuna，Hopper 不支持本机 Windows 环境。没有把这个失败描述为成功反编译，也没有安装大型反编译器或修改 REA 全局配置。

后续使用已有 LIEF 解析 PE 结构，并在自有临时目录安装 Capstone 5.0.6，做只读机器码交叉引用。检查包括 `.text` 指令、`.pdata` 函数范围、RIP 相对地址和 IAT 引用。这里不是 REA native provider 的完整反编译结果。静态调用图仅覆盖可解析的直接调用，不足以排除间接调用或运行时配置路径。

## 已确认的原生圆角路径

构造候选函数 `0x1402b5e50` 中，有对应 `island.html`、窗口标签 `island` 和标题 `Terse Island` 的 RIP 相对引用。例如：

| 位置 | 静态观察 |
| --- | --- |
| `0x1402b6c41` | 引用 `island.html` 资源名 |
| `0x1402b6c8b` | 引用窗口标签 `island`，随后传入长度 6 |
| `0x1402b6ca8` | 引用 `Terse Island`，随后传入长度 12 |
| `0x1402b6cd7` / `0x1402b6cdf` | 加载两个 double 常量 360.0 / 44.0 |
| `0x1402b77c3` | 再次按标签获取 `island` |
| `0x1402b7803` / `0x1402b780b` / `0x1402b7813` | 加载 360.0 / 44.0 / 22.0 |
| `0x1402b781e` | 调用圆角区域 helper `0x14009c620` |

helper 接收浮点尺寸参数并有显示缩放相关转换。其 Win32 路径在 `0x14009c78a` 实际调用 `CreateRoundRectRgn`，在 `0x14009c79c` 实际调用 `SetWindowRgn`；返回 region 交由窗口使用。这支持“胶囊有原生区域裁剪”的结论。

同一外层构造函数还会调用 `DwmSetWindowAttribute`，但该处传入的是属性 **33**、值 **2**，属于窗口角偏好，而不是系统 backdrop 类型。不能把此调用误认作 Acrylic。属性 33 的含义由 [Microsoft DWMWINDOWATTRIBUTE 文档](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute) 支持。

## blur / acrylic 实现：这次超过了 import 层，但仍有限制

有两段函数可通过错误文本、GetProcAddress 字符串和实际调用参数交叉定位：

| 函数候选 | 机器码已确认行为 | 不能从中推出的事 |
| --- | --- | --- |
| `0x14106a6f0` | 匹配 `apply_blur`；旧 Windows 分支调用 `DwmEnableBlurBehindWindow`；新分支动态获取 `SetWindowCompositionAttribute`，构造 Attribute 19、16 字节 AccentPolicy，State 3、Flags 2 | 不证明本机岛窗口曾选中此函数 |
| `0x14106aac0` | 匹配 `apply_acrylic`；新 Windows 分支设置 DWM 属性 38、值 3；兼容分支构造 State 4 的 AccentPolicy | 不证明系统 Acrylic 在岛上启用，也不证明区域裁剪能限制其系统背景 |

上述分支与 Tauri 官方 `window-vibrancy` 的 Windows 实现相符：普通 blur 用 Accent blur，而新 Windows 的 acrylic 使用系统 transient backdrop，旧版本才走 Accent acrylic。[window-vibrancy 官方源码](https://raw.githubusercontent.com/tauri-apps/window-vibrancy/dev/src/windows.rs)

这两段函数的直接调用者都是一个通用材质 dispatcher `0x1401b46f0`，并存在上层通用窗口运行时调用者。已识别的岛构造路径直接连到圆角 helper；本轮没有建立“岛窗口配置 → dispatcher 选择某个材质 → 相应函数执行”的完整实参/条件证明。库能力存在与某个 HWND 实际采用它，仍是不同事实。

尤其需要区分：**State 3 的 Accent blur 路线，与 DWM 属性 38 的系统 Acrylic 路线并不等价。** 后者就是 Agent Pulse 前次尝试的全 HWND 系统背景路线，不能仅凭 Terse 也包含此库就认为它适合透明胶囊。

## 最终前端 CSS 是清玻璃边缘，不是有效的 backdrop blur

`/island.css` Brotli 起点为 `0x1de0f27`，解压 SHA-256 为 `6cb8aed2882e589636b82f28f936c1bf4386fcf0a41315e2d4a87ac860ba8637`。

文件较前位置确实写过 3px / 22px blur 和半透明深色渐变，但最终层叠规则对岛 body / root 使用透明背景及 `backdrop-filter: none !important`；文件更后面还对所有元素与伪元素禁用 backdrop-filter。前面的 blur 配方不能代表最终效果。

最终仍保留亮的顶部内边缘、约 15% 白色外轮廓、低强度底部内光、柔和外阴影与用于可读性的文本阴影。这些细节足以让清透明表面看起来像一片玻璃，但不等于已经把桌面细节做了磨砂。

## “白云”图标的来源也已确认

`island.js` 中，pill、hero 与多 Agent 标签均直接使用后端 `s.agentIcon` 字符串，缺失时回退机器人 glyph。没有专用白云 PNG 或必须提取的私有图形资产。

目标二进制的只读数据在文件偏移 `0x25dff78` 保存了 `Codex` 及聊天气泡 glyph `💬` 的相邻文本；这正是截图中看起来像白云的形状。Claude Code 附近的默认 glyph 是机器人。前端没有独立的“按 Codex 选白云”的判断：选择来自后端 Agent 检测数据。

因此，Agent Pulse 使用自主 SVG 的白色气泡/云形，及桃色 Claude 星形，是独立设计选择；不应描述成提取复用了 Terse 素材。

## 本轮动态检查的边界

尝试只读筛选 Terse 进程，以便针对其 HWND 查询 `GetWindowCompositionAttribute` 的 AccentPolicy、DWM 属性 38、窗口样式及 region。检查时 Terse 进程没有运行，返回目标 PID 集合为空，因此没有可查询 HWND。

没有为了获取数据擅自重新启动 Terse，也没有把空查询写成 Accent disabled 或把截图当作运行时 API 返回值。将来若目标本身处于运行状态，逐 HWND 的只读查询可以进一步收窄证据，但本报告没有这一层结果。

## Agent Pulse 修正与验收建议

本轮集成验收已反馈前次系统 Acrylic 在胶囊外形成灰色 HWND 矩形。结合以上证据，修复应首先撤回该系统背景路线，而不是继续叠加更高不透明度来遮住矩形。

独立实现应先清掉旧的系统 backdrop，保证窗口透明；然后分别验证自有 HWND 的 Accent blur 设置、原生圆角 region，以及 CSS 内层 tint/高光。若采用 State 3 / Flags 2，应读回策略并在桌面实测，不能仅以 API 返回成功认定视觉正确。

原生 region 与模糊/窗口内容的坐标要统一 DPI 缩放，收起/展开后同步更新；有效区域外不应留下半透明矩形，也不应让不可见阴影边距拦截输入。背景 tint 只承担前景文字可读性，桌面模糊由原生层承担；网页 backdrop-filter 不能冒充已经验证的跨窗桌面模糊。

验收至少包含：复杂桌面纹理是否真的模糊、浅/深背景是否仍可读、展开/收起后矩形是否消失、拖动是否留下残影、重启后位置与区域是否一致。减少透明度/高对比模式可切换实色回退，且应清楚区别实际启用的模式。
