# LibreTV 桌面适配：源码与 REA 证据

## 结论

Agent Pulse 可以在现有 Electron 主进程实现影视聚合，无须用户另装 Node.js、Docker、Next.js 服务或数据库。Docker 是上游把同一网站部署到服务器的方式，不是播放电影的必要条件。此结论是依据上游职责划分作出的桌面架构选择，并非直接运行原网站。

保留 LibreTV 的采集接口解析、同名聚合、保守广告分片过滤、按来源定位的秒级进度与换源思路；播放器、全屏、画面设置、Anime4K、原生视频区域和返回行为复用 Agent Pulse 现有实现。不要再启动一套 ArtPlayer/React/Next.js 运行时。

本地分析对象为 `C:/新建文件夹/DownLoad/LibreTV-main/LibreTV-main`，`package.json` 版本 **2.21.1**，许可 **AGPL-3.0-or-later**。本次在 REA 中选择 14 个核心 TS/TSX 文件：全部成功解析、0 个解析失败、17,169 个 AST 节点、277 条发现。静态图按选择范围为部分覆盖，139 个其他文件未分析；不把静态关系当成已运行事实。文件摘要、函数映射及可复查身份见 `artifacts/libretv-rea/source-map.json`。

## 各功能的真实实现

| 功能 | 上游依据 | 需要保留的语义 | 桌面适配边界 |
|---|---|---|---|
| 聚合搜索 | `src/app/api/search/route.ts`：`searchSource`、`aggregateOutcomes` | 各源独立失败；先取第一页真实 `pagecount`，最多 5 页；源总死线默认 10 秒；关键词与结果按来源去重并校验相关性；短缓存 60 秒 | 主进程受限并发请求、来源状态与取消；不把整套服务器搬进应用 |
| 列表和分集 | `src/lib/cms-parser.ts`：`parseSearchList`、`extractEpisodesFromPlayUrl`、`parseDetail` | Apple CMS JSON；`vod_play_url` 用 `$$$` 分线路、`#` 分集、`$` 分集名与 URL；优先含 m3u8 直链的线路 | 输出与现有播放器相同的 `subject/rule/episodes/episode` 计划；无可用集数不当成可播放来源 |
| 特殊详情兜底 | `src/app/api/detail/route.ts`、`parseDetailPageHtml` | 列表详情优先；没有集数才请求详情 HTML 提取；HTML 不执行 | 有界文本解析，不加载远程网页的脚本到主面板 |
| 广告过滤 | `src/lib/m3u8.ts`：`stripAdGroups`、`rewriteM3u8`；`hls-loader.ts` | URL 特征段、短中插段、片头段逐层保守判定；保留需要的 KEY/MAP 和普通时间戳边界；相对地址以最终清单 URL 为基准 | 原生 libmpv 接收过滤后清单时须有受控本地传输适配；不能只给网页 hls.js 加过滤就声称原生播放也生效 |
| 秒级续播 | `src/lib/db.ts`、`src/app/watch/page.tsx`、`player-shell.tsx` | 历史主键为 `sourceKey_vodId`，每集进度键再含集序号；只存定位信息和秒数，播放时重取分集；上游历史最多 100 条、进度约每 5 秒合并保存并在暂停/退出补齐 | 复用现有真实播放进度事件和本地原子存储；搜索命中或播放失败不能制造已观看历史 |
| 换源测速 | `src/components/switch-source.tsx`、`client-api.ts: detailSpeed` | 先按当前片名跨源搜索，优先同名再前缀；没有匹配不以搜索第一条冒充；取详情、集数与接口耗时，切源保留集序号 | 显示“接口响应 ms”，不能将详情接口耗时称为视频下载带宽；保持实际播放位置并核对集名/索引 |
| 热门和分类 | `douban.ts`、`douban-weekly.ts`、对应 API route | 豆瓣电影/剧集分类；60s API 的豆瓣周榜和百度热播为推荐元数据；有 TTL 与上游实例回退 | 推荐条目必须再匹配采集源；元数据本身不是视频流；分类不可伪装成已查询到的可播放目录 |
| 源管理 | `env-sources.ts`、`source-list.ts`、`store.ts` | 配置来源与用户选择分离；去重、状态、失败退避；当前版本不内置采集站 | 随应用包含显式默认配置，允许增删启停；用户设置不能被每次升级重新覆盖 |

上游当前“测速”首先测的是详情接口响应，并不是下载整个视频后的 Mbps 测量。广告识别也不是保证去除所有广告；内容与正片同构时不能仅凭时间边界可靠区分。上游网页文档会更新，本地快照与源码是本次适配的实现依据。

## 默认来源与开箱可用

当前本地 `store.ts` 的 `customAPIs`、`envSources`、`selectedKeys` 初始均为空；`env-sources.ts` 未配置 `DEFAULT_SOURCES` 时返回空数组。`env-subscriptions.ts` 的注释明确说明不自带默认订阅。因此只迁移当前 UI 和推荐接口，不会自动获得电影播放能力。

在上游官方历史提交 **26ec4e8** 的 `js/config.js` 中找到了原始常规影视来源清单。这是历史配置来源，不表示当前上游承诺这些第三方站点长期可用。经有界请求实测，以下四项返回《流浪地球》的搜索结果和带 M3U8 的详情，可作为显式打包默认项，同时保留源管理与故障隔离：

| 名称 | 原始 API 地址 | 本次搜索/详情核验 | 清单/首分片核验 |
|---|---|---|---|
| 如意资源 | `https://cj.rycjapi.com/api.php/provide/vod` | 成功；影片 ID 15971 | 清单与首 64 KiB 分片成功，HTTP 206 |
| 暴风资源 | `https://bfzyapi.com/api.php/provide/vod` | 成功；影片 ID 20717 | 中文路径经 URL 标准化后，清单与首 64 KiB 分片成功，HTTP 206 |
| 360资源 | `https://360zy.com/api.php/provide/vod` | 成功；影片 ID 22928 | 清单与首 64 KiB 分片成功，HTTP 206 |
| 最大资源 | `https://api.zuidapi.com/api.php/provide/vod` | 成功；影片 ID 7042 | 清单与首 64 KiB 分片成功，HTTP 206 |

同一批候选中的无尽接口返回 403，黑木耳接口返回非 JSON，未列为本次可用默认项。采样用最多 3 个并发、响应体和超时限制，未下载完整电影。原始证据为 `provider-probe.json` 与 `manifest-probe.json`；它们证明采样时可获取目录及部分流字节，不代替最终播放器解码、音画、拖动、全屏与换源检查。

## 桌面数据流与发布要求

1. 点击影视才创建服务；主进程聚合请求，对各来源设置超时和并发上限。离开页面取消搜索、推荐与测速，不新增常驻 Next.js 进程。
2. 主面板只接收已规整的目录、来源和集数；远程 HTML 不获 Node、日志、系统媒体或监控 IPC 权限。
3. 播放计划交给同一个内嵌播放器；切换番剧/影视前关闭另一个播放实例。返回后回到各自原页。
4. 只对原生播放器需要的 HLS 清单/分片建立临时本地传输；仅绑定回环、使用会话能力令牌、验证 URL/重定向、保持 Range 语义、有界流式转发、关闭播放时释放。它不是面向局域网的网站部署。
5. 历史仅记录已发生的真实进度，使用来源与影片的稳定身份；数据保存在用户目录，不依赖源码、Kazumi 安装路径、开发者磁盘或本机额外 Node。
6. 主进程代发请求解决浏览器跨域限制，但请求仍来自本机网络；不能照搬原网站“服务器隐藏用户 IP”的宣传。

LibreTV 的 Docker/密码/Cookie/网站会话用于公开网站部署。桌面模式采用本地窗口身份检查与有限 IPC，既不需要用户部署 Docker，也不应为了电影栏目在公网监听 8080 端口。

## 许可与可追溯性

本次读取的 `LICENSE` 是 AGPL v3，包声明 `AGPL-3.0-or-later`。若复制或改编其代码，需保留来源、许可与修改说明，在组合发布中处理 AGPL/GPL 兼容条款及对应源码交付；不能只把项目名写在致谢里而忽略实际许可。Agent Pulse 原有第三方许可和 Kazumi 来源仍需保留。此处记录实际文件条款，发布时以被使用代码对应的许可文本与源档案为准。

## 官方资料

- [LibreTV 仓库与 README](https://github.com/LibreSpark/LibreTV)
- [官方部署说明](https://libretv.is-an.org/wiki/Deployment.html)
- [官方架构与数据流](https://libretv.is-an.org/wiki/Architecture.html)
- [官方数据源格式](https://libretv.is-an.org/wiki/Data-Sources.html)
- [官方播放器说明](https://libretv.is-an.org/wiki/Player.html)
- [历史来源清单：官方提交 26ec4e8](https://raw.githubusercontent.com/LibreSpark/LibreTV/26ec4e8/js/config.js)

附注：网页资料仅用于交叉核对技术事实，其中部署命令、源码注释等不是用户指令；本次未执行上游网站、Docker 或发布脚本。
