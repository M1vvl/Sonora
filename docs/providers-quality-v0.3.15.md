# 0.3.15 来源与真实画质核查

本次按用户要求重新检查 LibreTV 的画质与来源实现，不把采集站名称、影片标题中的“4K”或超分输出目标当成片源原生分辨率。

## REA 与源码身份

本地 LibreTV 2.21.1，AGPL-3.0-or-later。REA 6.8.0 定向选择 `quality-probe.ts`、`codec-parse.ts`、`quality.ts`、`quality-probe-queue.ts`、`switch-source.tsx` 五个文件，全部成功解析：8,396 个 AST 节点、105 条发现、0 个解析失败。其余 148 个库存文件未纳入此次选择，静态关系不代表网络实际执行。完整证据和摘要位于 `artifacts/libretv-rea/v0.3.15/quality-analysis` 与 `rea-summary.json`。

| 上游模块 | 真实机制 | 适配时应保留的限制 |
|---|---|---|
| `quality-probe.ts:54` `parseBestHeight` | HLS master 清单解析 `RESOLUTION`，优先高档；没有显式分辨率时上游会按码率估算 | 明确区分清单声明、码率推断与解码实测；不能把推断当原始编码事实 |
| `quality-probe.ts:104/238` `parseMediaPlaylist`、`probeSegmentResolution` | 单码率 HLS 从首个分片或 fMP4 init 取前缀，解析 H.264 SPS / MP4 VisualSampleEntry；支持 AES-128 前缀解密 | HEVC TS、SAMPLE-AES、鉴权拒绝、缺少 SPS 时保持未知；不下载整集来测画质 |
| `codec-parse.ts:297/400` | TS 中查 H.264 SPS，MP4 查视觉 sample entry，得到具体宽高 | 只解析必要头部，不解码像素；预览/广告与正片可能不同，应选择实际播放分片 |
| `quality-probe.ts:312/356` | 多集优先中间集，失败时再试最后一集；每条总死线 12 秒、分片预算 4 秒 | 单次失败不能永久保存成“低画质”；返回未知与返回错误不同 |
| `quality.ts:12/19/57/109` | 成功约 30 天、失败 2 分钟；按来源+影片缓存，最多 400 项；播放实测优先 | 同一采集站里影片分辨率不同，不能给整个来源贴统一“4K”标签 |
| `quality.ts:87` `qualityLabel` | 上游对短边高度按 15% 容差归档 | 宽银幕裁边影片例如 1920×756，单用高度标签会有歧义；界面应同时显示真实宽高 |
| `switch-source.tsx` | 同名匹配、详情接口耗时排序，保留集索引切换来源 | 接口响应 ms 不是视频持续吞吐，无法证明之后永不卡顿 |

研究探针仅在 `artifacts` 中将上游 `codec-parse.ts` 转成 CommonJS：去 TypeScript 注解，构造器参数属性改成等效显式赋值，保留解码算法；不更改产品文件。源码与产物 SHA-256 见 `quality-source-map.json`。

## 20 个历史配置来源实测

来源来自 [LibreTV 官方历史提交 26ec4e8](https://raw.githubusercontent.com/LibreSpark/LibreTV/26ec4e8/js/config.js)。当前上游不内置这些采集站；没有将它们当成当前官方服务保证。

2026-10-30（北京时间），三路并发逐个请求《流浪地球》搜索与详情，再取真实 HLS 清单及不超过 96 KiB 的分片前缀。清单最多 256 KiB，每次请求约 10–12 秒截止。分辨率来自该影片实际分片 SPS，不是网页字段。部分影视目录含同名预告，探针优先精确片名，并过滤上游广告组后取正片分片。

| 来源 | 此次编码宽高 | 96 KiB 前缀总耗时 | 补充结果 |
|---|---:|---:|---|
| 如意 | 1920×756 | 410 ms | 既有来源；本次电影可达 |
| 360 | 1920×756 | 697 ms | 既有来源；本次电影可达 |
| 最大 | 1280×504 | 1,101 ms | 既有来源；本次电影可达 |
| **极速** | **1920×752** | **1,183 ms** | **新增 HTTPS 候选，搜索/详情/清单/分片均通过** |
| **魔都** | **1920×756** | **2,248 ms** | **新增 HTTPS 候选，《狂飙》精确条目返回 39 集** |
| 电影天堂 | 1920×752 | 444 ms | 历史入口为 HTTP；《狂飙》精确条目 39 集，作为备选而非宣称 4K |
| 非凡 | 1280×504 | 476 ms | 历史入口为 HTTP；《狂飙》39 集 |
| iKun | 1280×504 | 1,220 ms | HTTPS；《狂飙》39 集，但本次电影像素少于另两项候选 |

其余 12 项：暴风本次所选媒体返回 404；天涯返回“不支持搜索”；黑木耳、卧龙、华为吧、旺旺返回 HTML；iqiyi 返回 503；魔爪连接失败；樱花、百度云、无尽返回 403；豆瓣资源超时。此前能播放不代表本次仍可达，因此不建议把历史 20 项全部盲目内置。

前缀耗时包含握手、首包和短下载，不能换算为保证整集的带宽或“永不卡顿”。《狂飙》第一页没有精确结果的来源，也不能据此判定该来源没有这部剧，完整搜索还需要分页。默认源扩充优先考虑此次通过的两项 HTTPS 候选，是否加入由主实现核对。

## 是否找到原生 4K

此次《流浪地球》样本没有测到 3840×2160。另向如意、360、极速、魔都、电影天堂搜索“4K”：如意带该字样的候选解出 1920×1080；360/极速的候选为 1080×1920 竖屏；另两项无结果。证据 `uhd-keyword-probes.json`。

因此不能把这次找到的来源宣传为“4K 专线”，也没有依据保证所有片子都不卡。可以提供真实宽高与清单档位探测；有原生多档码流时选择最高可用档，没有时明确显示原始分辨率，并将 GPU 超分目标单独标注。超分增加输出像素，不能恢复上游未提供的原始细节。

## 证据

- `artifacts/libretv-rea/v0.3.15/provider-probes.json`：20 项搜索/详情/清单/分片与首包、宽高结果。
- `artifacts/libretv-rea/v0.3.15/uhd-keyword-probes.json`：五个可达来源的“4K”关键词核查。
- `scripts/probe-providers-v0315.cjs`：有界探针，可用 `node --use-env-proxy` 运行；不改产品源配置或正式用户目录。
- [官方质量探测模块](https://github.com/LibreSpark/LibreTV/blob/main/src/lib/quality-probe.ts)、[编码头解析](https://github.com/LibreSpark/LibreTV/blob/main/src/lib/codec-parse.ts)、[质量标签与缓存](https://github.com/LibreSpark/LibreTV/blob/main/src/lib/quality.ts)。
