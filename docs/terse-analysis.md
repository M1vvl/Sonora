# Terse AI 本地静态分析记录

分析日期：2026-10-28。范围：本机 Terse AI 1.4.2.0 的只读安装包检查、REA 静态识别、嵌入前端资源分析。以下将已观察事实、推断和未验证内容分开；没有修改目标程序、安装钩子、读取账户凭证或绕过授权。

## 目标与来源

- 运行进程：`Terse.exe`，检查时 PID 为 `2000`。
- MSIX 包：`luzgool.TerseAI_1.4.2.0_x64__xgss3z3s9297y`。
- 安装目录：`C:\Program Files\WindowsApps\luzgool.TerseAI_1.4.2.0_x64__xgss3z3s9297y`。
- 主程序：该目录中的 `Terse.exe`，50,341,376 字节，PE AMD64。
- SHA-256：`aa746b596565869c2eb57e5dec6c5f9462efb9cbe0e64fb3e96c3622c1a2bd22`。
- 本机下载的 REA 源码根目录实际为 `D:\Table\Codex\REA\rea-main\rea-main`，版本 `6.8.0`。

`AppxManifest.xml` 明确声明 Tauri v2 / WebView2 的系统要求、桌面 FullTrust 入口、`terse://` 协议和 UI Automation 用途。二进制同时包含 Rust 源路径、Tauri `2.11.5` 依赖路径和可解压的 HTML/CSS/JS 资源，支持“Rust + Tauri + WebView2”技术栈判断。

## 实际使用 REA 的结果

已读取下载项目的 `AGENTS.md`、`README.md` 和 `docs/cli.md`。下载源码没有 `node_modules` 或 `dist`，不能直接运行其入口；未执行会修改代理配置的 `setup`。

实际执行只读命令：

```powershell
npx -y rea-agents@6.8.0 inspect-rust-binary "C:\Program Files\WindowsApps\luzgool.TerseAI_1.4.2.0_x64__xgss3z3s9297y\Terse.exe" --json
```

该命令退出码为 `0`，REA 返回：

- `operation`: `inspect_rust_binary`
- `provider`: `rust-auditable` / `REA Rust dependency reader`
- `evidence_id`: `ev_c2e4dd1324ab16556046fb084c376a6a40ac26889d0e1928a6ef798213a030d1`
- 文件摘要与上列 SHA-256 一致。
- `auditable_metadata`: `null`；没有 `.dep-v0` 节。这个结果不能解释为“程序没有依赖”。
- 从只读数据中的 `/rustc/…` 路径推断出 commit `58cf8f9c35b355199727627d07ae34a4e2846d67`，文件偏移 `21140004`。REA 自身明确说明这不认证编译器身份。

运行环境为 Node `v26.5.0` / npm `11.17.0`，npm 给出 engine 警告，因为 REA 声明 `^22.23.4 || ^24.22.1 || >=26.12.1`。本次静态命令成功并不代表其他工作流在该工具链上获得支持。没有安装或升级 Node、Java、Ghidra、Hopper 或 IDA，也没有配置全局 REA MCP。

## Agent 识别与数据来源

### 已观察到的证据

主程序只读数据包含：

| 证据 | 文件偏移 | 含义 |
| --- | --- | --- |
| `src\agent_usage_scan.rs`、`.claude/projects`、`agent_usage_ledger.json`、`agent_attribution_ledger.json` | 约 `0x259a852` | Claude 会话扫描与用量账本相关实现 |
| `src\agent_monitor.rs`、`src\session_dock.rs` | 约 `0x25de0fd` | 监控与会话 dock 是原生后端模块 |
| `total_token_usage`、`input_tokens`、`cached_input_tokens`、`output_tokens` | 约 `0x25d88bc` | Codex 累积用量字段 |
| `turn_context`、`reasoning_output_tokens`、`model_context_window`、`model_provider` | 约 `0x25dee8a` | 模型上下文、推理和兼容用量解析字段 |
| `read_new_lines_multi`、`new session file`、`read_new_lines` | 约 `0x25def85` | 多日志文件增量读取的诊断文本 |
| `select id, rollout_path, cwd, title, … from threads where archived = 0 … limit 40` | `0x25df917` | Codex 会话索引中读取日志路径、项目、标题、模型和更新时间 |
| `codex://threads/`、`.claude/projects` | 约 `0x25dfa24` | 跳回 Codex 会话与 Claude 日志目录 |

还观察到机器码比较 `rollout-` 和 `.jsonl` 文件名的片段（约 `0x933e9e`）。二进制内没有完整的 `state_5.sqlite` 常量，不能据此声称它固定只支持某一数据库版本。

嵌入的 `tauri-bridge.js` 暴露 `get_agent_detections`、`get_agent_sessions`、`accept_agent`、`get_agent_analytics`、`get_agent_plan_info`、`get_session_timeline` 和 `export_session_replay` 等原生调用。主窗口通过 `agent-connected`、`agent-disconnected`、`agent-update` 更新列表。

### 可支持的结论

Terse 的 Codex / Claude 监控至少有一条“识别本机应用 + 读取本地会话索引/日志 + 增量解析 + 前端事件更新”的实现路径。实现类似监控不必拦截 TLS、获取 API key 或修改模型请求。

安装目录的 `hooks/terse-hook-codex.ps1` 是额外的工具输出压缩适配器：接收 `pre_tool_use` 的 shell/Bash 事件，针对部分命令将输出接到 `terse-compress.js`。这是可选优化能力，不是只读用量监控的必要条件。本次没有执行或安装这些脚本。

### 独立实现时应遵守的数据语义

- 以日志里明确提供的 token 字段为准。字符数估计不能标作真实 token。
- Codex 的 `total_token_usage` 是累计值；持续监控应计算增量并处理计数重置，不能将每次快照相加。
- 将缓存输入拆开计价，防止同一缓存 token 同时算普通输入。
- 模型、实际计费 tier 或某项字段缺失时保留“未知”，不要套一个近似模型而不提示。
- 进程正在运行与会话正在生成是不同事实；不能仅靠 Codex 进程存在就把全部历史会话标作运行中。

## 费用显示的关键发现

`dash.js` 的持久统计估值有可直接验证的默认价表，单位是美元 / 百万 token：

| 分类 | 输入 | 输出 |
| --- | ---: | ---: |
| agent | 3.0 | 15.0 |
| editor | 3.0 | 15.0 |
| manual | 3.0 | 15.0 |
| browser | 2.5 | 10.0 |

它允许从本地存储 `terse-rates` 覆盖；缓存读取乘输入单价 `0.1`，缓存写入乘 `1.25`。普通输入为 `max(0, tokensIn - cacheRead - cacheCreation)`，然后合计三类输入费用和输出费用。

**这是前端持久统计的通用估值逻辑，不是证据充分的“Codex 每个模型精确定价”。** 实时面板接收后端的 `estimatedCost`；Rust 后端估值算法尚未经过反编译核验，不能将上述价表推广成所有页面的算法。

新软件应按官方价表针对实际模型分别计算，并标注“API 单价等值估算”。ChatGPT Plus 的订阅费、套餐额度和另购 credits 应单独展示；不能将本地 token 的 API 等值金额当成 Plus 实际产生的逐 token 账单。官方来源与价表核验由本项目的计价模块另行记录。

## 灵动岛机制

### 截图中的 pill

`island.html`、`island.css` 和 `island.js` 是独立的灵动岛资源。观察到的行为：

- 收起胶囊高 `44px`、圆角 `22px`，透明窗口和本机圆角裁剪；前端负责深色玻璃、亮色描边、状态 glyph、Agent 名称、最新动作、节省量和上下文圆环。
- 可见性跟已连接 Agent 数量走：有连接调用 `show_island_window`，无连接调用 `hide_island_window`。
- 监听 `agent-connected` / `agent-update` / `agent-lost` / `agent-disconnected`；每 `4000ms` 重新调用 `getAgentSessions`，恢复漏事件导致的陈旧状态。
- 当前代码的常规 hover 主要调用 `open_dashboards` 打开独立浮动指标窗口，pill 尺寸保持固定；离开延迟 `200ms` 调用 `hide_dashboards`。存在 click pin / 强制关闭逻辑。
- 警报与授权请求可临时占据胶囊并通过 `island_resize` / `island_alert_size` 调整原生窗口，排队展示。授权能力不是本项目只读监控所必需。
- `tauri-bridge.js` 明确提供 `show_island_window`、`hide_island_window`、`island_set_expanded`、`island_resize`、`island_alert_size`、`focus_island` 和 dashboard 相关命令。

注意：源码注释残留了“hover 展开 resize”的旧描述，但当前 `scheduleResize` 为空并说明 dashboard 使用独立窗口。以上结论以可执行函数体为准，未照搬注释。

### 另一个会话 dock

安装包还包含 `session-dock.html/js`。这不是截图中同一个 DOM 实现，不能混为一谈：

- `sd_active` 获取有进程的会话及日志尾部状态，`sd_usage` 获取五小时用量窗口与会话拆分。
- 通过 `sd-state` / `sd-mouse` 事件收取原生后端的状态与全局鼠标位置。
- 前端有透明 canvas，引用 `pdock-engine.js`；注释明确提到不获取焦点的覆盖窗口在 macOS 的 hover 限制，因此通过原生侧光标轮询辅助。
- `sd_codex_open` 对应 Codex 会话跳转。

独立软件可以用“无边框透明置顶窗口 + 单一真实监控状态 + hover 详情 + 拖动 + 主面板入口”满足用户截图目标。无需复用 Terse 的前端、粒子引擎、授权系统或品牌资源。

## 嵌入资源的只读验证方法

在 PE 数据中定位精确资源路径，路径结束后是 Brotli 压缩流。使用本机已有 `brotlicffi.Decompressor` 在内存逐字节读取至 `is_finished()`，能够得到完整资源。未将这些专有资源保存进新项目，也未将源码用于新软件实现。

| 资源 | 压缩流文件偏移 | 压缩字节 | 解压字节 | 解压 SHA-256 |
| --- | --- | ---: | ---: | --- |
| `/island.js` | `0x159c0fd` | 19,984 | 73,814 | `efbab539aa8d1035eb9202f967a1f8d0edec070beb5d1ab91ccd681e31f64f7d` |
| `/island.css` | `0x1de0f27` | 14,190 | 61,920 | `6cb8aed2882e589636b82f28f936c1bf4386fcf0a41315e2d4a87ac860ba8637` |
| `/island.html` | `0x1dde5f4` | 6,594 | 27,123 | `799726af6c5b1a36522575c9fbcb45465ab9a5b0ca59a275237e39ed535effae` |
| `/tauri-bridge.js` | `0x1f96df3` | 10,957 | 34,796 | `19086d98ef9a5a049d062a654b1a8442da20b04ff1aed3adb31bc898383ba8be` |
| `/dash.js` | `0x1f90abc` | 14,295 | 53,594 | `59745c5ac6aba18901b1dfc3691ad1a66badaed95fd43207557bfcc68a1ec0e4` |
| `/session-dock.js` | `0x1738e65` | 30,800 | 103,177 | `1e0e6d3acee38501d15965dc2a9f03b57ce3f858a9ea42d0e3bcea759c039c3f` |
| `/session-dock.html` | `0x15532cb` | 1,431 | 2,956 | `7f9261c8398cedb952aea21bfb3a4e5040a920673032cf25f2618dcaa108720b` |

## 已知边界

- 没有把 Ghidra / IDA / Hopper 挂到运行中的 Terse；没有完整反编译 Rust 的 token 解析和窗口创建函数。
- Tauri 通用 `set_always_on_top`、`skipTaskbar`、`transparent` 等字符串存在，但仅有库字符串不能证明每个窗口创建时都设了这些选项。
- 本报告中的前端行为来自已安装制品里的代码路径，尚未通过自动化操作 Terse 逐项动态复现。
- 没有访问 `.terse/auth.json`、license 内容或 Codex/Claude 的凭证文件；安装包中的 hook 仅作为静态文本阅读。
- 所有偏移和 hash 只对应上列 1.4.2.0 制品；其他版本需重新核验。
